import type { CoreContext } from "../context.js";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../errors.js";
import { record } from "../audit/service.js";
import {
  ANONYMOUS,
  ROLE_NAMES,
  SELF_ASSIGNABLE_ROLES,
  isAdmin,
  isAuthenticated,
  type Actor,
  type RoleName,
  type UserStatus,
} from "./actor.js";
import { assertCanActOnUser } from "./policies.js";
import * as repo from "./repo.js";

/**
 * The role gate and the account lifecycle.
 *
 * This is the first of the two authorization layers. It answers "may this kind
 * of actor use this entry point at all" — never "is this actor a party to this
 * particular row", which is `policies.ts`. Both are required: a role check
 * alone lets any vendor read any other vendor's order by id.
 */

/**
 * Builds the actor for the current request.
 *
 * The provider tells us *who* the caller claims to be; everything that governs
 * what they may do — roles, status, and whether their session predates a
 * revocation — is re-read from the database here, on every request and on
 * every route. Checking only on admin routes is how a revoked role keeps
 * working everywhere else.
 */
export async function getActor(
  ctx: CoreContext,
  options: { activeRole?: RoleName | undefined } = {},
): Promise<Actor> {
  const authUser = await ctx.auth.getCurrentUser();
  if (!authUser) return ANONYMOUS;

  // The provider's subject is not this application's primary key. Resolving one
  // to the other is the whole job of this lookup; querying `users.id` with a
  // provider subject silently matches nothing and signs everybody out.
  let userId = await repo.findUserIdByProviderSub(ctx, authUser.id);

  if (!userId && authUser.email && authUser.emailVerified) {
    // First sign-in for a row that predates the provider knowing about it —
    // a seeded account, or one created before the provider account existed.
    // Requires a verified address: matching on an unverified one would let
    // anyone claim a seeded account by registering with its email.
    userId = await repo.bindProviderSub(ctx, authUser.email, authUser.id);
  }

  if (!userId) return ANONYMOUS;

  const identity = await repo.loadIdentity(ctx.db, userId);
  if (!identity) return ANONYMOUS;

  // A session issued before the account's cutoff is dead, whatever the token
  // says. Suspending an account or revoking a role moves that cutoff forward.
  //
  // A token with no issue time cannot be shown to postdate the cutoff, so it is
  // refused. Treating it as valid would turn every revocation into a no-op the
  // moment a provider stopped emitting the claim.
  if (!authUser.issuedAt || authUser.issuedAt < identity.sessionsValidAfter) {
    return ANONYMOUS;
  }

  // A second factor is optional to set up. Once set up it is not optional to
  // use: a session that has not cleared the challenge is refused here, so an
  // abandoned challenge cannot be walked around by navigating elsewhere.
  //
  // The requirement is this column rather than the provider's factor list,
  // because that list arrives inside a browser-held session object.
  if (identity.mfaEnrolledAt && !authUser.secondFactorVerified) {
    return ANONYMOUS;
  }

  const roles = identity.roles;
  const requested = options.activeRole;

  return {
    kind: "user",
    userId: identity.userId,
    email: identity.email,
    status: identity.status,
    roles,
    // A requested active role is honoured only if it is actually held. This is
    // presentation, not authority: selecting "customer" does not disarm an
    // admin, and selecting "admin" does not arm anyone else.
    activeRole:
      requested && roles.includes(requested)
        ? requested
        : (ROLE_NAMES.find((role) => roles.includes(role)) ?? "customer"),
    vendorIds: identity.vendorIds,
  };
}

/** Throws unless the actor is signed in and their account is usable. */
export function requireUser(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (!isAuthenticated(actor)) {
    throw new UnauthenticatedError();
  }

  if (actor.status === "suspended") {
    throw new ForbiddenError("This account is suspended.");
  }

  if (actor.status !== "active") {
    throw new ForbiddenError("This account is not active yet. Check your email to verify it.");
  }

  return actor;
}

/** Throws unless the actor holds the role. Authority is held, never active. */
export function requireRole(actor: Actor, role: RoleName): Extract<Actor, { kind: "user" }> {
  const user = requireUser(actor);

  if (!user.roles.includes(role)) {
    throw new ForbiddenError("Not permitted.");
  }

  return user;
}

/**
 * The gate on every admin entry point.
 *
 * Multi-factor authentication is available and is not required here. Anyone who
 * enrols a factor must clear it on every session — `getActor` sees to that —
 * but an administrator without one still passes. The decision to make it
 * optional rather than a gate is recorded in the plan's validation log along
 * with the compensating controls; if it is revisited, one `user.mfaEnrolled`
 * check in this function is the whole change.
 */
export function requireAdmin(actor: Actor): Extract<Actor, { kind: "user" }> {
  return requireRole(actor, "admin");
}

export type SignUpInput = {
  email: string;
  fullName: string;
  /** Whatever the client sent. Validated below, never trusted. */
  role: unknown;
  authProviderSub?: string | null;
  emailVerified?: boolean;
};

/**
 * Creates an account with exactly one self-assignable role.
 *
 * The role arrives as `unknown` on purpose. A signup form is client-controlled
 * input, and the only safe shape for it is a closed enum that does not contain
 * `admin`: administrators come from the seed or from `grantRole`, which itself
 * requires an administrator.
 */
export async function signUp(ctx: CoreContext, input: SignUpInput): Promise<string> {
  const role = parseSelfAssignableRole(input.role);
  const email = normaliseEmail(input.email);
  const now = ctx.clock.now();

  if (!email) {
    throw new ValidationError("Enter a valid email address.", { email: "invalid" });
  }

  if (input.fullName.trim().length === 0) {
    throw new ValidationError("Enter your name.", { fullName: "required" });
  }

  const existing = await repo.findUnclaimedUserByEmail(ctx, email);
  if (existing) {
    // An earlier attempt created the row and then failed before the provider
    // account existed. Without this the address is bricked: every retry sees
    // the orphan and refuses, and only a manual DELETE frees it.
    if (existing.claimed) {
      throw new ValidationError("An account with this email already exists.", { email: "taken" });
    }

    await repo.adoptUnclaimedUser(ctx, existing.id, {
      fullName: input.fullName.trim(),
      authProviderSub: input.authProviderSub ?? null,
      role,
      status: input.emailVerified ? "active" : "unverified",
      emailVerifiedAt: input.emailVerified ? now : null,
      now,
    });

    return existing.id;
  }

  return repo.createUserWithRole(ctx, {
    email,
    fullName: input.fullName.trim(),
    authProviderSub: input.authProviderSub ?? null,
    role,
    // An unverified account exists but cannot act until the address is proven.
    status: input.emailVerified ? "active" : "unverified",
    emailVerifiedAt: input.emailVerified ? now : null,
    now,
  });
}

/**
 * Records that the provider has confirmed an address.
 *
 * Without this an account stays `unverified` forever and `requireUser` refuses
 * it on every route — a signup that completes and then cannot be used.
 */
export async function markEmailVerified(ctx: CoreContext, userId: string): Promise<void> {
  await repo.markEmailVerified(ctx, userId, ctx.clock.now());
}

/**
 * Records that a second factor was enrolled, or that the last one was removed.
 *
 * Enrolling is the account holder's own choice — nothing here requires an
 * administrator to have one, which is the accepted risk recorded in the plan's
 * validation log. What this column buys is the other half: once a factor
 * exists, every later session has to clear the challenge.
 *
 * Call it only after the provider has actually verified the factor. Setting it
 * first would lock the person out of the very session they are enrolling from.
 */
export async function setSecondFactorEnrolled(
  ctx: CoreContext,
  actor: Actor,
  enrolled: boolean,
): Promise<void> {
  const user = requireUser(actor);
  const now = ctx.clock.now();

  await repo.setMfaEnrolledAt(ctx, user.userId, enrolled ? now : null, now);

  await record(ctx, actor, {
    action: enrolled ? "identity.mfa.enrol" : "identity.mfa.remove",
    entityType: "user",
    entityId: user.userId,
    before: { secondFactor: !enrolled },
    after: { secondFactor: enrolled },
  });
}

/**
 * Removes the second-factor requirement from someone else's account.
 *
 * The way back in for a person who has lost their authenticator. Without it,
 * enrolling a factor and then losing the phone would be permanent — the account
 * holder cannot turn the factor off, because an unanswered challenge makes them
 * anonymous, which is the whole point of the requirement.
 *
 * Clearing the flag alone is not enough: the provider still believes a factor
 * is enrolled and would send them back to a challenge they cannot answer, so
 * the caller deletes the provider's factor too. That is why the subject is
 * returned.
 */
export async function clearSecondFactor(
  ctx: CoreContext,
  actor: Actor,
  targetUserId: string,
): Promise<{ authProviderSub: string | null }> {
  requireAdmin(actor);
  const now = ctx.clock.now();

  const target = await repo.loadIdentity(ctx.db, targetUserId);
  if (!target) {
    throw new NotFoundError("No such account.");
  }

  // Refuses an administrator doing this to themselves — self-service lives at
  // /mfa, where the challenge has already been answered.
  assertCanActOnUser(actor, { id: target.userId });

  await repo.setMfaEnrolledAt(ctx, targetUserId, null, now);
  // Whoever is holding a session for this account loses it: if the factor was
  // removed because the account may be compromised, leaving live sessions alone
  // would make the removal pointless.
  await repo.bumpSessionsValidAfter(ctx.db, targetUserId, ctx.clock.realNow());

  await record(ctx, actor, {
    action: "identity.mfa.clear",
    entityType: "user",
    entityId: targetUserId,
    before: { secondFactor: target.mfaEnrolledAt !== null },
    after: { secondFactor: false },
  });

  return { authProviderSub: target.authProviderSub };
}

/** Finds an account by address. Administrators only — it answers whether one exists. */
export async function findUserIdByEmail(
  ctx: CoreContext,
  actor: Actor,
  email: string,
): Promise<string | undefined> {
  requireAdmin(actor);
  return repo.findUserIdByEmail(ctx, email.trim().toLowerCase());
}

/**
 * Narrows client input to a role a person may give themselves.
 *
 * Exported because the signup server action validates before it ever reaches
 * the provider, and the negative case — a request carrying `role=admin` — is
 * worth testing directly.
 */
export function parseSelfAssignableRole(value: unknown): RoleName {
  if (typeof value !== "string") {
    throw new ValidationError("Choose how you want to use Occasion.", { role: "required" });
  }

  const match = SELF_ASSIGNABLE_ROLES.find((role) => role === value);
  if (!match) {
    throw new ValidationError("Choose how you want to use Occasion.", { role: "invalid" });
  }

  return match;
}

function normaliseEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  // Deliberately permissive: the verification email is the real check, and a
  // stricter pattern rejects addresses that are perfectly valid.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Grants a role. The only path by which anyone becomes an administrator.
 *
 * Bumping the session cutoff on a grant looks unnecessary — new authority, not
 * less — but it keeps one rule rather than two: any change to what a person may
 * do takes effect on their next request.
 */
export async function grantRole(
  ctx: CoreContext,
  actor: Actor,
  targetUserId: string,
  role: RoleName,
): Promise<void> {
  const admin = requireAdmin(actor);
  const now = ctx.clock.now();

  const before = await repo.loadIdentity(ctx.db, targetUserId);
  if (!before) {
    throw new ValidationError("No such account.", { userId: "unknown" });
  }

  await repo.insertRole(ctx.db, targetUserId, role, admin.userId, now);
  await repo.bumpSessionsValidAfter(ctx.db, targetUserId, ctx.clock.realNow());

  await record(ctx, actor, {
    action: "identity.role.grant",
    entityType: "user",
    entityId: targetUserId,
    before: { roles: before.roles },
    after: { roles: [...new Set([...before.roles, role])] },
  });
}

export async function revokeRole(
  ctx: CoreContext,
  actor: Actor,
  targetUserId: string,
  role: RoleName,
): Promise<void> {
  requireAdmin(actor);

  const before = await repo.loadIdentity(ctx.db, targetUserId);
  if (!before) {
    throw new ValidationError("No such account.", { userId: "unknown" });
  }

  await repo.deleteRole(ctx.db, targetUserId, role);
  // Without this the revoked role keeps working until the token expires.
  await repo.bumpSessionsValidAfter(ctx.db, targetUserId, ctx.clock.realNow());

  await record(ctx, actor, {
    action: "identity.role.revoke",
    entityType: "user",
    entityId: targetUserId,
    before: { roles: before.roles },
    after: { roles: before.roles.filter((held) => held !== role) },
  });
}

/** Suspends an account and ends its sessions in the same breath. */
export async function suspendUser(
  ctx: CoreContext,
  actor: Actor,
  targetUserId: string,
  reason?: string,
): Promise<void> {
  await setStatus(ctx, actor, targetUserId, "suspended", "identity.user.suspend", reason);
}

export async function reinstateUser(
  ctx: CoreContext,
  actor: Actor,
  targetUserId: string,
): Promise<void> {
  await setStatus(ctx, actor, targetUserId, "active", "identity.user.reinstate");
}

async function setStatus(
  ctx: CoreContext,
  actor: Actor,
  targetUserId: string,
  status: UserStatus,
  action: string,
  reason?: string,
): Promise<void> {
  requireAdmin(actor);
  const now = ctx.clock.now();

  const before = await repo.loadIdentity(ctx.db, targetUserId);
  if (!before) {
    throw new ValidationError("No such account.", { userId: "unknown" });
  }

  await repo.setUserStatus(ctx.db, targetUserId, status, now);
  await repo.bumpSessionsValidAfter(ctx.db, targetUserId, ctx.clock.realNow());

  await record(ctx, actor, {
    action,
    entityType: "user",
    entityId: targetUserId,
    before: { status: before.status },
    after: { status, ...(reason ? { reason } : {}) },
  });
}

/**
 * Ends the sessions of everyone attached to a vendor.
 *
 * Called when a vendor is suspended. Hiding the vendor from search is not
 * enough — their staff keep valid sessions, and those sessions can still reach
 * vendor endpoints.
 */
export async function endVendorStaffSessions(
  ctx: CoreContext,
  vendorId: string,
): Promise<string[]> {
  // The real clock, not the domain one: this is compared against a token issue
  // time the auth provider stamped, which no override can move.
  const cutoff = ctx.clock.realNow();
  const memberIds = await repo.loadVendorMemberIds(ctx, vendorId);

  for (const memberId of memberIds) {
    await repo.bumpSessionsValidAfter(ctx.db, memberId, cutoff);
  }

  return memberIds;
}

export { isAdmin };
