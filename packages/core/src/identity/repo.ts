import { and, eq, isNull, sql } from "drizzle-orm";
import {
  communicationConsents,
  userRoles,
  users,
  vendorMembers,
  vendors,
} from "@occasion/db/schema";
import type { CoreContext, DbExecutor } from "../context.js";
import type { RoleName, UserStatus } from "./actor.js";

/**
 * Database access for identity.
 *
 * Kept apart from the service so the rules and the queries can be read
 * separately — and so the service's tests can describe behaviour rather than
 * SQL.
 */

export type IdentityRow = {
  userId: string;
  email: string;
  /** The auth provider's subject, once bound. Null until the first sign-in. */
  authProviderSub: string | null;
  status: UserStatus;
  sessionsValidAfter: Date;
  emailVerifiedAt: Date | null;
  /** Set while a second factor is enrolled; the requirement lives here. */
  mfaEnrolledAt: Date | null;
  roles: RoleName[];
  vendorIds: string[];
};

/**
 * Loads everything authorization needs about a person.
 *
 * Roles, status and `sessionsValidAfter` are read together because all three
 * are checked on every request: a role that was revoked, an account that was
 * suspended and a session issued before a revocation must each stop working
 * immediately, not whenever the token happens to expire.
 *
 * Three small indexed lookups rather than one query with correlated
 * subqueries. The joined version is a round trip cheaper and materially harder
 * to read; if this shows up in a performance pass, measure before collapsing
 * it.
 */
export async function loadIdentity(
  db: DbExecutor,
  userId: string,
): Promise<IdentityRow | undefined> {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      authProviderSub: users.authProviderSub,
      status: users.status,
      sessionsValidAfter: users.sessionsValidAfter,
      emailVerifiedAt: users.emailVerifiedAt,
      mfaEnrolledAt: users.mfaEnrolledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return undefined;

  const [roleRows, vendorRows] = await Promise.all([
    db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
    db
      .select({ vendorId: vendorMembers.vendorId })
      .from(vendorMembers)
      .where(eq(vendorMembers.userId, userId)),
  ]);

  return {
    ...row,
    roles: [...new Set(roleRows.map((entry) => entry.role))],
    vendorIds: [...new Set(vendorRows.map((entry) => entry.vendorId))],
  };
}

/** Looks a person up by the auth provider's subject claim. */
export async function findUserIdByProviderSub(
  ctx: CoreContext,
  providerSub: string,
): Promise<string | undefined> {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.authProviderSub, providerSub))
    .limit(1);

  return row?.id;
}

/**
 * Attaches a provider subject to an existing account, once.
 *
 * Seeded accounts and any row created before the provider knew about them have
 * no subject yet. The match is on a **verified** email and only fills a NULL,
 * so it cannot move an account from one provider identity to another.
 */
export async function bindProviderSub(
  ctx: CoreContext,
  email: string,
  providerSub: string,
): Promise<string | undefined> {
  const [row] = await ctx.db
    .update(users)
    .set({ authProviderSub: providerSub })
    .where(and(eq(users.email, email.toLowerCase()), isNull(users.authProviderSub)))
    .returning({ id: users.id });

  return row?.id;
}

export async function findUserIdByEmail(
  ctx: CoreContext,
  email: string,
): Promise<string | undefined> {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  return row?.id;
}

/**
 * Finds an account by email, saying whether a provider account backs it.
 *
 * An unclaimed row — no provider subject, still unverified — is the debris of
 * a signup that failed after the domain write. It is safe to reuse: nobody has
 * ever signed in as it, because there is nothing to sign in with.
 */
export async function findUnclaimedUserByEmail(
  ctx: CoreContext,
  email: string,
): Promise<{ id: string; claimed: boolean } | undefined> {
  const [row] = await ctx.db
    .select({
      id: users.id,
      authProviderSub: users.authProviderSub,
      status: users.status,
    })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!row) return undefined;

  return {
    id: row.id,
    claimed: row.authProviderSub !== null || row.status !== "unverified",
  };
}

/** Rewrites an unclaimed row for a fresh signup attempt. */
export async function adoptUnclaimedUser(
  ctx: CoreContext,
  userId: string,
  input: {
    fullName: string;
    authProviderSub: string | null;
    role: RoleName;
    status: UserStatus;
    emailVerifiedAt: Date | null;
    now: Date;
  },
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        fullName: input.fullName,
        authProviderSub: input.authProviderSub,
        status: input.status,
        emailVerifiedAt: input.emailVerifiedAt,
        // Nothing can be enrolled on a row nobody has ever signed in as, but
        // the requirement and the row are set in the same place so they cannot
        // drift apart.
        mfaEnrolledAt: null,
        sessionsValidAfter: input.now,
        updatedAt: input.now,
      })
      .where(eq(users.id, userId));

    // The role may differ from the abandoned attempt, so replace rather than add.
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values({ userId, role: input.role });
  });
}

export async function markEmailVerified(
  ctx: CoreContext,
  userId: string,
  now: Date,
): Promise<void> {
  await ctx.db
    .update(users)
    .set({ emailVerifiedAt: now, status: "active", updatedAt: now })
    .where(and(eq(users.id, userId), eq(users.status, "unverified")));
}

/**
 * Records whether a second factor is enrolled.
 *
 * The provider owns the factor itself; this column owns the *requirement*, so
 * that a session which has not cleared the challenge is refused by the same
 * per-request read that already refuses a revoked role.
 */
export async function setMfaEnrolledAt(
  ctx: CoreContext,
  userId: string,
  enrolledAt: Date | null,
  now: Date,
): Promise<void> {
  await ctx.db
    .update(users)
    .set({ mfaEnrolledAt: enrolledAt, updatedAt: now })
    .where(eq(users.id, userId));
}

export type CreateUserInput = {
  email: string;
  fullName: string;
  authProviderSub: string | null;
  role: RoleName;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  now: Date;
};

/**
 * Creates the account and its single starting role together.
 *
 * One transaction on purpose: an account that exists with no role is a person
 * who can sign in and then be told they are nobody, and the repair is manual.
 */
export async function createUserWithRole(
  ctx: CoreContext,
  input: CreateUserInput,
): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        authProviderSub: input.authProviderSub,
        status: input.status,
        emailVerifiedAt: input.emailVerifiedAt,
        sessionsValidAfter: input.now,
      })
      .returning({ id: users.id });

    const userId = row?.id as string;

    await tx.insert(userRoles).values({ userId, role: input.role });

    // Implied consent, which lapses. Express consent is only ever captured by
    // someone actively opting in.
    await tx.insert(communicationConsents).values({
      userId,
      channel: "product_email",
      basis: "implied",
      source: "signup",
      capturedAt: input.now,
    });

    return userId;
  });
}

export async function insertRole(
  db: DbExecutor,
  userId: string,
  role: RoleName,
  grantedBy: string,
  now: Date,
): Promise<void> {
  await db
    .insert(userRoles)
    .values({ userId, role, grantedBy, grantedAt: now })
    .onConflictDoNothing();
}

export async function deleteRole(db: DbExecutor, userId: string, role: RoleName): Promise<void> {
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));
}

/**
 * Invalidates every session issued before `validAfter`.
 *
 * This is the revocation mechanism. Asking the auth provider to drop its own
 * sessions is done on top of this and is best effort; this row is what
 * `getActor` checks, so it is the guarantee.
 *
 * **`validAfter` must come from `ctx.clock.realNow()`, never `now()`.** The
 * value it is compared against is the token's issue time, stamped by the auth
 * provider on a clock nothing here can move. Writing a shifted instant into a
 * column that is compared against a real one is a category error: under a
 * backdated clock override it writes a cutoff in the past, every existing token
 * still postdates it, and the revocation quietly does nothing.
 *
 * `greatest` rather than assignment, so the column can only ever move forward.
 * A plain `set` lets a later write with an earlier instant *lower* a cutoff an
 * earlier revocation raised — which brings sessions that were already dead back
 * to life.
 */
export async function bumpSessionsValidAfter(
  db: DbExecutor,
  userId: string,
  validAfter: Date,
): Promise<void> {
  await db
    .update(users)
    .set({
      // An ISO string rather than the `Date`: a raw `sql` fragment bypasses
      // Drizzle's column mapping, so the driver would receive a `Date` it does
      // not know how to bind. The cast gives the plain string its type back.
      sessionsValidAfter: sql`greatest(${users.sessionsValidAfter}, ${validAfter.toISOString()}::timestamptz)`,
      updatedAt: validAfter,
    })
    .where(eq(users.id, userId));
}

export async function setUserStatus(
  db: DbExecutor,
  userId: string,
  status: UserStatus,
  now: Date,
): Promise<void> {
  await db.update(users).set({ status, updatedAt: now }).where(eq(users.id, userId));
}

/** Vendor organisations whose payouts must stop when the vendor is suspended. */
export async function loadVendorStatus(
  ctx: CoreContext,
  vendorId: string,
): Promise<{ id: string; status: string } | undefined> {
  const [row] = await ctx.db
    .select({ id: vendors.id, status: vendors.status })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1);

  return row;
}

/** Everyone attached to a vendor, so suspending it can end their sessions. */
export async function loadVendorMemberIds(ctx: CoreContext, vendorId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ userId: vendorMembers.userId })
    .from(vendorMembers)
    .where(eq(vendorMembers.vendorId, vendorId));

  return rows.map((row) => row.userId);
}
