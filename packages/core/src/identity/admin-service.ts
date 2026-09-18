import { record } from "../audit/service.js";
import type { CoreContext, DbExecutor } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Actor, RoleName, UserStatus } from "./actor.js";
import { assertCanActOnUser, assertCanReadUser } from "./policies.js";
import { requireAdmin } from "./service.js";
import * as repo from "./repo.js";
import * as adminRepo from "./admin-repo.js";

/**
 * Account management.
 *
 * Everything here is administrative: `requireAdmin()` first, then an object
 * policy for anything that names an account. The policies also refuse an
 * administrator acting on themselves, which is the first half of the lockout
 * guard — the second half is `assertStillAdministered`, which runs after the
 * write inside the same transaction and rolls it back.
 *
 * Money is read in cents and formatted here rather than in the browser. The
 * activity line on a row is display copy, and it is the one place a screen
 * could quietly start doing arithmetic on currency.
 */

export type AdminUserListItem = {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  roles: RoleName[];
  /** `Customer`, `Vendor staff` or `Administrator`. */
  roleLabel: string;
  /** The prototype's third column, line 2629. */
  activity: string;
  /** The one thing to do with an account in this state. */
  action: UserAction;
  lastSeenAt: Date | null;
};

/** A reason is free text, but it lands in a jsonb column and in front of people. */
const MAX_REASON = 500;

/** Source: the row buttons at lines 2629–2634, one per status. */
export type UserAction = "suspend" | "approve" | "resend-verification" | "reinstate";

export type AdminUserList = {
  rows: AdminUserListItem[];
  nextCursor?: string | undefined;
  total: number;
};

/**
 * Status decides the action, exactly as the prototype draws it.
 *
 * Active → Suspend, Pending → Approve, Unverified → Resend email,
 * Suspended → Reinstate. One button per row; everything else is in the record.
 */
export function actionFor(status: UserStatus): UserAction {
  switch (status) {
    case "active":
      return "suspend";
    case "pending":
      return "approve";
    case "unverified":
      return "resend-verification";
    case "suspended":
      return "reinstate";
  }
}

export async function listUsersForAdmin(
  ctx: CoreContext,
  actor: Actor,
  options: {
    filter?: adminRepo.UserFilter;
    search?: string | undefined;
    cursor?: string | undefined;
  } = {},
): Promise<AdminUserList> {
  requireAdmin(actor);

  const page = await adminRepo.listForAdmin(ctx, options);

  return {
    rows: page.rows.map(toListItem),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    total: page.total,
  };
}

export type UserDetail = {
  user: AdminUserListItem;
  createdAt: Date;
  memberships: adminRepo.MembershipRow[];
  events: adminRepo.EventRow[];
  orders: adminRepo.OrderRow[];
  /** Totals over every order, not just the ones on this page. */
  orderTotal: string;
  audit: adminRepo.AuditRow[];
  /** Which roles this administrator may still change on this account. */
  grantableRoles: RoleName[];
  revocableRoles: RoleName[];
};

/**
 * One account, in full.
 *
 * This is the answer to a support question, and the reason there is no
 * impersonation anywhere in this codebase (V-07): everything somebody would
 * sign in as another person to discover is on this screen instead.
 */
export async function getUserDetail(
  ctx: CoreContext,
  actor: Actor,
  userId: string,
): Promise<UserDetail> {
  requireAdmin(actor);
  assertCanReadUser(actor, { id: userId });
  assertUserId(userId);

  const row = await adminRepo.loadForAdmin(ctx, userId);
  if (!row) throw new NotFoundError("No such account.");

  const [memberships, events, orders, audit] = await Promise.all([
    adminRepo.listMemberships(ctx, userId),
    adminRepo.listEvents(ctx, userId),
    adminRepo.listOrders(ctx, userId),
    adminRepo.listAudit(ctx, userId),
  ]);

  // `vendor` and `admin` only. Nobody is granted `customer` by an
  // administrator — it is what a person gives themselves at signup, and
  // granting it would be a way to create an account that never agreed to one.
  const manageable: RoleName[] = ["vendor", "admin"];

  return {
    user: toListItem(row),
    createdAt: row.createdAt,
    memberships,
    events,
    orders,
    orderTotal: formatMoney(row.totalSpend),
    audit,
    grantableRoles: manageable.filter((role) => !row.roles.includes(role)),
    revocableRoles: manageable.filter((role) => row.roles.includes(role)),
  };
}

/** `pending → active`: the application is accepted. */
export async function approveUser(ctx: CoreContext, actor: Actor, userId: string): Promise<void> {
  requireAdmin(actor);
  assertCanActOnUser(actor, { id: userId });
  assertUserId(userId);

  const before = await repo.loadIdentity(ctx.db, userId);
  if (!before) throw new NotFoundError("No such account.");

  if (before.status !== "pending") {
    throw new ValidationError(
      `Only a pending account can be approved. This one is ${before.status}.`,
      {
        status: "illegal",
      },
    );
  }

  await repo.setUserStatus(ctx.db, userId, "active", ctx.clock.now());

  await record(ctx, actor, {
    action: "identity.user.approve",
    entityType: "user",
    entityId: userId,
    before: { status: before.status },
    after: { status: "active" },
  });
}

/**
 * Asks the provider to send the verification email again.
 *
 * The domain does not send it — it has no provider — so this validates that
 * asking makes sense and returns the address to send to. The caller does the
 * sending, the same split as clearing a lost second factor.
 *
 * No status changes. The account becomes active when the address is proven,
 * not when an email is posted.
 */
export async function resendVerification(
  ctx: CoreContext,
  actor: Actor,
  userId: string,
): Promise<{ email: string }> {
  requireAdmin(actor);
  assertCanActOnUser(actor, { id: userId });
  assertUserId(userId);

  const target = await repo.loadIdentity(ctx.db, userId);
  if (!target) throw new NotFoundError("No such account.");

  if (target.status !== "unverified") {
    throw new ValidationError(
      `Only an unverified account needs a verification email. This one is ${target.status}.`,
      { status: "illegal" },
    );
  }

  await record(ctx, actor, {
    action: "identity.user.resend_verification",
    entityType: "user",
    entityId: userId,
    after: { email: target.email },
  });

  return { email: target.email };
}

/**
 * Refuses a change that would leave nobody able to administer the platform.
 *
 * Called **after** the write, inside the same transaction, and it throws to
 * roll that write back. Asking beforehand whether somebody else is an
 * administrator cannot work: the person asking is one, and they cannot be the
 * target, so the answer is always yes and the guard never fires.
 *
 * The transaction also has to be serialised — see `lockAdminRoles`. Two
 * administrators demoting each other simultaneously would otherwise each look
 * at a platform that still contains the other.
 */
async function assertStillAdministered(db: DbExecutor, what: string): Promise<void> {
  if ((await adminRepo.countActiveAdmins(db)) === 0) {
    throw new ValidationError(
      `${what} would leave the platform with no administrator who can sign in.`,
      { role: "last-admin" },
    );
  }
}

/**
 * Suspends an account, ending its sessions.
 *
 * The session cutoff is what makes this bite on **every** route rather than
 * only the admin ones: `getActor` checks it on each request, wherever the
 * request is going.
 *
 * One transaction, so the status, the cutoff and the audit row cannot disagree
 * — and so the last-administrator check can undo the whole thing.
 */
export async function suspendAccount(
  ctx: CoreContext,
  actor: Actor,
  userId: string,
  reason: string,
): Promise<void> {
  requireAdmin(actor);
  assertCanActOnUser(actor, { id: userId });
  assertUserId(userId);

  const trimmed = reason.trim();
  if (!trimmed) {
    throw new ValidationError("Say why. The next administrator to open this account reads it.", {
      reason: "required",
    });
  }

  if (trimmed.length > MAX_REASON) {
    throw new ValidationError(`Keep the reason under ${MAX_REASON} characters.`, {
      reason: "too-long",
    });
  }

  await ctx.db.transaction(async (tx) => {
    await adminRepo.lockAdminRoles(tx);

    const before = await repo.loadIdentity(tx, userId);
    if (!before) throw new NotFoundError("No such account.");

    if (before.status === "suspended") {
      throw new ValidationError("This account is already suspended.", { status: "unchanged" });
    }

    await repo.setUserStatus(tx, userId, "suspended", ctx.clock.now());
    await repo.bumpSessionsValidAfter(tx, userId, ctx.clock.realNow());

    await assertStillAdministered(tx, "Suspending this account");

    await record(
      ctx,
      actor,
      {
        action: "identity.user.suspend",
        entityType: "user",
        entityId: userId,
        before: { status: before.status },
        after: { status: "suspended", reason: trimmed },
      },
      tx,
    );
  });
}

/** `suspended → active`. */
export async function reinstateAccount(
  ctx: CoreContext,
  actor: Actor,
  userId: string,
): Promise<void> {
  requireAdmin(actor);
  assertCanActOnUser(actor, { id: userId });
  assertUserId(userId);

  await ctx.db.transaction(async (tx) => {
    const before = await repo.loadIdentity(tx, userId);
    if (!before) throw new NotFoundError("No such account.");

    if (before.status !== "suspended") {
      throw new ValidationError("Only a suspended account can be reinstated.", {
        status: "illegal",
      });
    }

    await repo.setUserStatus(tx, userId, "active", ctx.clock.now());
    // Raised rather than lowered, so a reinstatement cannot hand back a session
    // some other revocation had already killed.
    await repo.bumpSessionsValidAfter(tx, userId, ctx.clock.realNow());

    await record(
      ctx,
      actor,
      {
        action: "identity.user.reinstate",
        entityType: "user",
        entityId: userId,
        before: { status: "suspended" },
        after: { status: "active" },
      },
      tx,
    );
  });
}

/**
 * Grants a role.
 *
 * Granting `admin` is the one action on this screen that creates authority
 * rather than removing it, which is why the caller has to type the account's
 * address to confirm. That check is here rather than in the browser: a typed
 * confirmation enforced only by a form is a confirmation a direct POST skips.
 */
export async function grantRoleToUser(
  ctx: CoreContext,
  actor: Actor,
  userId: string,
  role: RoleName,
  confirmation?: string,
): Promise<void> {
  const admin = requireAdmin(actor);
  assertCanActOnUser(actor, { id: userId });
  assertUserId(userId);
  assertManageableRole(role);

  await ctx.db.transaction(async (tx) => {
    const before = await repo.loadIdentity(tx, userId);
    if (!before) throw new NotFoundError("No such account.");

    if (before.roles.includes(role)) {
      throw new ValidationError(`This account already holds ${role}.`, { role: "unchanged" });
    }

    if (role === "admin" && confirmation?.trim().toLowerCase() !== before.email.toLowerCase()) {
      throw new ValidationError("Type the account's email address to confirm an admin grant.", {
        confirmation: "mismatch",
      });
    }

    await repo.insertRole(tx, userId, role, admin.userId, ctx.clock.now());
    // New authority rather than less, but the same rule holds: anything that
    // changes what a person may do takes effect on their next request.
    await repo.bumpSessionsValidAfter(tx, userId, ctx.clock.realNow());

    await record(
      ctx,
      actor,
      {
        action: "identity.role.grant",
        entityType: "user",
        entityId: userId,
        before: { roles: before.roles },
        after: { roles: [...before.roles, role].sort() },
      },
      tx,
    );
  });
}

export async function revokeRoleFromUser(
  ctx: CoreContext,
  actor: Actor,
  userId: string,
  role: RoleName,
): Promise<void> {
  requireAdmin(actor);
  assertCanActOnUser(actor, { id: userId });
  assertUserId(userId);
  assertManageableRole(role);

  await ctx.db.transaction(async (tx) => {
    await adminRepo.lockAdminRoles(tx);

    const before = await repo.loadIdentity(tx, userId);
    if (!before) throw new NotFoundError("No such account.");

    if (!before.roles.includes(role)) {
      throw new ValidationError(`This account does not hold ${role}.`, { role: "unchanged" });
    }

    await repo.deleteRole(tx, userId, role);
    // Without this the revoked role keeps working until the token expires.
    await repo.bumpSessionsValidAfter(tx, userId, ctx.clock.realNow());

    await assertStillAdministered(tx, "Revoking this role");

    await record(
      ctx,
      actor,
      {
        action: "identity.role.revoke",
        entityType: "user",
        entityId: userId,
        before: { roles: before.roles },
        after: { roles: before.roles.filter((held) => held !== role) },
      },
      tx,
    );
  });
}

/**
 * `customer` is not an administrator's to give or take.
 *
 * It is what somebody chooses for themselves at signup. Granting it would
 * create a customer account that never agreed to be one; revoking it would
 * orphan the orders and events hanging off it.
 */
function assertManageableRole(role: RoleName): void {
  if (role !== "vendor" && role !== "admin") {
    throw new ValidationError("Only the vendor and admin roles are managed here.", {
      role: "unmanageable",
    });
  }
}

/**
 * Refuses an id that is not one before it reaches the driver.
 *
 * These arrive from query parameters and form fields, so "no such account" and
 * "not a uuid" are both things a person can type. Letting the second through
 * turns a wrong guess into an error page.
 */
function assertUserId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new NotFoundError("No such account.");
  }
}

function toListItem(row: adminRepo.AdminUserRow): AdminUserListItem {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    status: row.status,
    roles: row.roles,
    roleLabel: roleLabelFor(row),
    activity: activityFor(row),
    action: actionFor(row.status),
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * Which of the three labels a row carries.
 *
 * The prototype has two — `Customer` and `Vendor staff`, lines 2629–2634 — and
 * no administrator row at all, because its admin is the person looking at the
 * screen. A real list contains them, so there is a third.
 *
 * Membership decides `Vendor staff`, not the vendor *role*: the label is about
 * which business somebody works for, and that is what a membership records.
 */
function roleLabelFor(row: adminRepo.AdminUserRow): string {
  if (row.roles.includes("admin")) return "Administrator";
  if (row.vendorId) return "Vendor staff";
  return "Customer";
}

/**
 * The prototype's third column.
 *
 * Two shapes, because the prototype has two: a customer gets counts and spend
 * (`3 events · 5 orders · C$1,039`, line 2629), and vendor staff get the
 * business they work for and how far along it is (`Bloom & Co · owner · payouts
 * enabled`, line 2631).
 *
 * Every figure is computed. The prototype's own strings do not reconcile with
 * its own data — Ada Okafor is described as having 11 orders beside a list
 * showing two — so they are display copy rather than facts, and this counts the
 * rows instead. Recorded in `docs/design-gaps.md`.
 */
function activityFor(row: adminRepo.AdminUserRow): string {
  if (row.vendorId && row.vendorName) {
    return [row.vendorName, row.vendorMemberRole, vendorProgress(row)]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  }

  const events = `${row.eventCount} ${row.eventCount === 1 ? "event" : "events"}`;
  const orders = `${row.orderCount} ${row.orderCount === 1 ? "order" : "orders"}`;
  return `${events} · ${orders} · ${formatMoney(row.totalSpend)}`;
}

/**
 * How far a vendor has got, in the prototype's words where it has them.
 *
 * `payouts enabled` and `onboarding 80%` are both its own (lines 2631, 2632).
 * The third case it renders — `flagged for 2 chargebacks` — is describing data
 * this platform does not have, so a blocked or suspended business says so
 * instead. Recorded in `docs/design-gaps.md`.
 */
function vendorProgress(row: adminRepo.AdminUserRow): string | null {
  if (row.vendorStatus && row.vendorStatus !== "approved" && row.vendorStatus !== "pending") {
    return row.vendorStatus;
  }
  if (row.vendorPayoutsEnabledAt) return "payouts enabled";
  if (row.vendorOnboardingPercent) return `onboarding ${row.vendorOnboardingPercent}%`;
  return row.vendorStatus;
}

/**
 * Cents to `C$1,039.00`.
 *
 * Formatted here so no screen ever divides a currency amount. `Number` is safe
 * on the way out because the value is only being displayed — the arithmetic
 * that has to reconcile happens in the database, in integers.
 */
function formatMoney(cents: bigint): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    currencyDisplay: "narrowSymbol",
  })
    .format(Number(cents) / 100)
    .replace("$", "C$");
}
