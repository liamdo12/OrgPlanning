import { and, asc, desc, eq, exists, gt, ilike, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  auditLog,
  events,
  orders,
  userRoles,
  users,
  vendorMembers,
  vendors,
} from "@occasion/db/schema";
import { PAGE_SIZE, SORTS, decodeCursor, encodeCursor } from "../paging.js";
import type { CoreContext, DbExecutor } from "../context.js";
import type { RoleName, UserStatus } from "./actor.js";

/**
 * Database access for the account list.
 *
 * The whole point of this module is the shape of one query. An admin screen
 * that shows "3 events · 5 orders · C$1,039" per row is the classic place an
 * N+1 gets written, and the classic place a naive fix gets it wrong instead:
 * joining events *and* orders to users multiplies the rows, and the order total
 * comes back multiplied by the event count.
 *
 * So each dimension is aggregated to one row per user **before** it is joined.
 * The main query then joins one-to-one and cannot fan out, whatever the data
 * does.
 */

/** Source: the prototype's chips, line 2624 — the four it actually renders. */
export type UserFilter = "all" | "customers" | "vendor-staff" | "suspended";

export type AdminUserRow = {
  id: string;
  fullName: string;
  email: string;
  status: UserStatus;
  roles: RoleName[];
  /** The business this person works for, when they work for one. */
  vendorId: string | null;
  vendorName: string | null;
  vendorMemberRole: string | null;
  vendorStatus: string | null;
  vendorPayoutsEnabledAt: Date | null;
  vendorOnboardingPercent: string | null;
  eventCount: number;
  orderCount: number;
  /**
   * What the platform kept, in cents — cancelled and refunded orders excluded.
   *
   * Never divided here: the service formats it, and no screen does arithmetic
   * on currency.
   */
  totalSpend: bigint;
  lastSeenAt: Date | null;
  createdAt: Date;
};

/** One page, and where the next one starts. */
export type UserPage = {
  rows: AdminUserRow[];
  /** Absent when this is the last page. */
  nextCursor?: string | undefined;
  /** Every account matching the filter, not just this page. */
  total: number;
};

export { PAGE_SIZE };

/**
 * Roles as an array, one row per user.
 *
 * A join to `user_roles` would duplicate a person who holds two.
 */
function rolesFor(db: DbExecutor) {
  return db
    .select({
      userId: userRoles.userId,
      roles: sql<RoleName[]>`array_agg(distinct ${userRoles.role})`.as("roles"),
    })
    .from(userRoles)
    .groupBy(userRoles.userId)
    .as("role_agg");
}

/**
 * Orders and spend, one row per user.
 *
 * Aggregated before the join rather than after. `sum(total)` across a join that
 * has already fanned out on events returns the spend multiplied by the number
 * of events, which looks plausible and is wrong.
 *
 * The count and the money answer two different questions and are scoped
 * differently on purpose. The count is how many orders somebody placed, which
 * includes the ones that fell through. The money is what the platform actually
 * took, so a cancelled or refunded order contributes nothing — counting it
 * would describe a customer as having spent money that has been given back.
 */
function ordersFor(db: DbExecutor) {
  return db
    .select({
      userId: orders.userId,
      orderCount: sql<number>`count(*)::int`.as("order_count"),
      // `sum(bigint)` is `numeric`, and a raw fragment carries no mapping, so the
      // driver would hand back a string typed as `bigint` — and the first caller
      // to do `> 0n` on it would throw. Cents stay integers.
      totalSpend: sql<bigint>`coalesce(
        sum(${orders.total}) filter (where ${orders.state} not in ('cancelled', 'refunded')),
        0
      )`
        .mapWith(BigInt)
        .as("total_spend"),
    })
    .from(orders)
    .groupBy(orders.userId)
    .as("order_agg");
}

function eventsFor(db: DbExecutor) {
  return db
    .select({
      ownerUserId: events.ownerUserId,
      eventCount: sql<number>`count(*)::int`.as("event_count"),
    })
    .from(events)
    .groupBy(events.ownerUserId)
    .as("event_agg");
}

/**
 * The one business a row shows, for someone who works for more than one.
 *
 * `array_agg(… order by name)[1]` rather than a join, for the same reason as
 * the rest: the row must not duplicate. Ordering by name makes the choice
 * stable, so the list does not reshuffle between requests.
 */
function membershipFor(db: DbExecutor) {
  return db
    .select({
      userId: vendorMembers.userId,
      vendorId:
        sql<string>`(array_agg(${vendors.id} order by ${vendors.name}, ${vendors.id}))[1]`.as(
          "vendor_id",
        ),
      vendorName:
        sql<string>`(array_agg(${vendors.name} order by ${vendors.name}, ${vendors.id}))[1]`.as(
          "vendor_name",
        ),
      memberRole:
        sql<string>`(array_agg(${vendorMembers.role} order by ${vendors.name}, ${vendors.id}))[1]`.as(
          "member_role",
        ),
      vendorStatus:
        sql<string>`(array_agg(${vendors.status}::text order by ${vendors.name}, ${vendors.id}))[1]`.as(
          "vendor_status",
        ),
      payoutsEnabledAt:
        sql<Date | null>`(array_agg(${vendors.stripePayoutsEnabled} order by ${vendors.name}, ${vendors.id}))[1]`.as(
          "payouts_enabled_at",
        ),
      onboardingPercent: sql<
        string | null
      >`(array_agg(${vendors.onboardingPercent} order by ${vendors.name}, ${vendors.id}))[1]`.as(
        "onboarding_percent",
      ),
    })
    .from(vendorMembers)
    .innerJoin(vendors, eq(vendors.id, vendorMembers.vendorId))
    .groupBy(vendorMembers.userId)
    .as("membership_agg");
}

/**
 * The filter, as a condition on `users`.
 *
 * `vendor-staff` is membership rather than the vendor *role*, because those are
 * different facts: a role says what someone may do, a membership says which
 * business they do it for, and the prototype's label is about the business.
 */
function conditionFor(db: DbExecutor, filter: UserFilter) {
  switch (filter) {
    case "customers":
      return exists(
        db
          .select({ matched: sql`1` })
          .from(userRoles)
          .where(and(eq(userRoles.userId, users.id), eq(userRoles.role, "customer"))),
      );
    case "vendor-staff":
      return exists(
        db
          .select({ matched: sql`1` })
          .from(vendorMembers)
          .where(eq(vendorMembers.userId, users.id)),
      );
    case "suspended":
      return eq(users.status, "suspended");
    case "all":
      return undefined;
  }
}

/** Matched against the name and the address, both literally. */
function searchCondition(term: string) {
  // `%` and `_` are pattern syntax, so a search for one has to be escaped or it
  // matches every account on the platform.
  const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return or(ilike(users.fullName, pattern), ilike(users.email, pattern));
}

/**
 * The cursor: `(fullName, id)`, encoded by `paging.ts`.
 *
 * A composite key rather than an offset: an offset skips or repeats rows when
 * somebody is suspended between one page and the next, and the id breaks ties
 * so two people with the same name cannot hide each other. The leading half is
 * a name rather than an instant, which is why the shared encoder has to be told
 * what it is comparing — a name is not required to parse as anything.
 */
const SORT = SORTS.usersByName;

export async function listForAdmin(
  ctx: CoreContext,
  options: { filter?: UserFilter; search?: string | undefined; cursor?: string | undefined } = {},
): Promise<UserPage> {
  const db = ctx.db;
  const filter = options.filter ?? "all";

  const conditions = [];
  const filterCondition = conditionFor(db, filter);
  if (filterCondition) conditions.push(filterCondition);

  const term = options.search?.trim();
  if (term) conditions.push(searchCondition(term)!);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  const total = counted?.total ?? 0;

  const after = options.cursor ? decodeCursor(SORT, options.cursor) : undefined;
  if (after) {
    conditions.push(
      or(
        gt(users.fullName, after.value),
        and(eq(users.fullName, after.value), gt(users.id, after.id)),
      )!,
    );
  }

  const roleAgg = rolesFor(db);
  const orderAgg = ordersFor(db);
  const eventAgg = eventsFor(db);
  const membershipAgg = membershipFor(db);

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      status: users.status,
      roles: sql<RoleName[]>`coalesce(${roleAgg.roles}, '{}')`,
      vendorId: membershipAgg.vendorId,
      vendorName: membershipAgg.vendorName,
      vendorMemberRole: membershipAgg.memberRole,
      vendorStatus: membershipAgg.vendorStatus,
      vendorPayoutsEnabledAt: membershipAgg.payoutsEnabledAt,
      vendorOnboardingPercent: membershipAgg.onboardingPercent,
      eventCount: sql<number>`coalesce(${eventAgg.eventCount}, 0)`,
      orderCount: sql<number>`coalesce(${orderAgg.orderCount}, 0)`,
      totalSpend: sql<bigint>`coalesce(${orderAgg.totalSpend}, 0)`.mapWith(BigInt),
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(roleAgg, eq(roleAgg.userId, users.id))
    .leftJoin(orderAgg, eq(orderAgg.userId, users.id))
    .leftJoin(eventAgg, eq(eventAgg.ownerUserId, users.id))
    .leftJoin(membershipAgg, eq(membershipAgg.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(users.fullName), asc(users.id))
    // One more than the page, so "is there a next page" is answered without a
    // second count against a list that may have changed underneath.
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE) as AdminUserRow[];
  const hasMore = rows.length > PAGE_SIZE;
  const last = page[page.length - 1];

  return {
    rows: page,
    ...(hasMore && last
      ? { nextCursor: encodeCursor(SORT, { value: last.fullName, id: last.id }) }
      : {}),
    total,
  };
}

/** One account, with the same shape a row has. */
export async function loadForAdmin(
  ctx: CoreContext,
  userId: string,
): Promise<AdminUserRow | undefined> {
  const db = ctx.db;
  const roleAgg = rolesFor(db);
  const orderAgg = ordersFor(db);
  const eventAgg = eventsFor(db);
  const membershipAgg = membershipFor(db);

  const [row] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      status: users.status,
      roles: sql<RoleName[]>`coalesce(${roleAgg.roles}, '{}')`,
      vendorId: membershipAgg.vendorId,
      vendorName: membershipAgg.vendorName,
      vendorMemberRole: membershipAgg.memberRole,
      vendorStatus: membershipAgg.vendorStatus,
      vendorPayoutsEnabledAt: membershipAgg.payoutsEnabledAt,
      vendorOnboardingPercent: membershipAgg.onboardingPercent,
      eventCount: sql<number>`coalesce(${eventAgg.eventCount}, 0)`,
      orderCount: sql<number>`coalesce(${orderAgg.orderCount}, 0)`,
      totalSpend: sql<bigint>`coalesce(${orderAgg.totalSpend}, 0)`.mapWith(BigInt),
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(roleAgg, eq(roleAgg.userId, users.id))
    .leftJoin(orderAgg, eq(orderAgg.userId, users.id))
    .leftJoin(eventAgg, eq(eventAgg.ownerUserId, users.id))
    .leftJoin(membershipAgg, eq(membershipAgg.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  return row;
}

export type MembershipRow = {
  vendorId: string;
  vendorName: string;
  vendorStatus: string;
  memberRole: string;
};

/** Every business this person works for, not just the one the row shows. */
export async function listMemberships(ctx: CoreContext, userId: string): Promise<MembershipRow[]> {
  return ctx.db
    .select({
      vendorId: vendors.id,
      vendorName: vendors.name,
      vendorStatus: sql<string>`${vendors.status}::text`,
      memberRole: vendorMembers.role,
    })
    .from(vendorMembers)
    .innerJoin(vendors, eq(vendors.id, vendorMembers.vendorId))
    .where(eq(vendorMembers.userId, userId))
    .orderBy(asc(vendors.name));
}

export type EventRow = { id: string; name: string; eventDate: string; guestCount: number | null };

export async function listEvents(ctx: CoreContext, userId: string): Promise<EventRow[]> {
  return ctx.db
    .select({
      id: events.id,
      name: events.name,
      eventDate: events.eventDate,
      guestCount: events.guestCount,
    })
    .from(events)
    .where(eq(events.ownerUserId, userId))
    .orderBy(desc(events.eventDate));
}

export type OrderRow = {
  id: string;
  reference: string;
  state: string;
  total: bigint;
  currency: string;
  vendorName: string;
  createdAt: Date;
};

export async function listOrders(ctx: CoreContext, userId: string): Promise<OrderRow[]> {
  return ctx.db
    .select({
      id: orders.id,
      reference: orders.reference,
      state: sql<string>`${orders.state}::text`,
      total: orders.total,
      currency: orders.currency,
      vendorName: vendors.name,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .innerJoin(vendors, eq(vendors.id, orders.vendorId))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt));
}

export type AuditRow = {
  id: string;
  action: string;
  actingRole: string | null;
  actorEmail: string | null;
  after: unknown;
  createdAt: Date;
};

/**
 * What has been done to this account, and by whom.
 *
 * Both directions would be wrong here: this is the record of actions *on* the
 * account, which is what a support question is about. What the person did
 * themselves is a different screen.
 */
export async function listAudit(ctx: CoreContext, userId: string, limit = 20): Promise<AuditRow[]> {
  // Aliased, because this query already has `users` in it as the subject of the
  // audit rows; without a second name the join condition is ambiguous.
  const actor = alias(users, "audit_actor");

  return ctx.db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actingRole: sql<string | null>`${auditLog.actingRole}::text`,
      actorEmail: actor.email,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.actorUserId))
    .where(and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, userId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/**
 * Serialises every change that could remove an administrator.
 *
 * Taken before the write, and held until the transaction ends. Without it two
 * administrators demoting each other at the same moment both look at a platform
 * that still has the other one in it, both commit, and nobody is left: under
 * READ COMMITTED neither transaction can see the other's uncommitted delete, so
 * counting afterwards is not enough on its own.
 *
 * Locking the `admin` role rows rather than the accounts, because that is the
 * set whose size is the invariant. Suspension takes the same lock, since
 * suspending an administrator removes one just as surely as demoting them.
 */
export async function lockAdminRoles(db: DbExecutor): Promise<void> {
  await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.role, "admin"))
    .for("update");
}

/**
 * How many administrators could still sign in.
 *
 * Counted **after** the change, inside the same transaction, so the question is
 * "did that leave anybody" rather than "is there somebody else right now" —
 * the second is always yes, because the person asking is one.
 *
 * `active` and a bound provider subject are both required: an account that
 * cannot sign in is not an administrator who can undo this.
 */
export async function countActiveAdmins(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(
      and(
        eq(userRoles.role, "admin"),
        eq(users.status, "active"),
        isNotNull(users.authProviderSub),
      ),
    );

  return row?.total ?? 0;
}
