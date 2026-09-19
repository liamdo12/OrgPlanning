import { and, asc, desc, eq, exists, ilike, inArray, like, or, sql } from "drizzle-orm";
import {
  auditLog,
  categories,
  jobs,
  orders,
  services,
  transfers,
  users,
  vendorMembers,
  vendors,
} from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";
import { STANDING_HOLD, type VendorStatus } from "./transitions.js";

/**
 * Database access for the vendor queue.
 *
 * Every function takes an executor rather than the context, because the writes
 * below have to compose into one transaction — see `DbExecutor`. The reads take
 * one too, so a caller inside a transaction sees its own uncommitted work.
 */

/**
 * A vendor's category is not a column: it is what their services sell.
 *
 * Aggregated over a join rather than read from a correlated subquery. Drizzle
 * renders a column inside a raw `sql` fragment without its table prefix, so the
 * subquery form compiles to `where "vendor_id" = "id"` — which Postgres rejects
 * as ambiguous, and which would silently mean the wrong thing if it did not.
 */
const categoryNames = sql<string | null>`string_agg(distinct ${categories.name}, ', ')`;
const serviceCount = sql<number>`count(distinct ${services.id})::int`;
// Counts services, not distinct publication instants: two services published in
// the same second are two services.
const publishedServiceCount = sql<number>`count(distinct ${services.id}) filter (
  where ${services.publishedAt} is not null
)::int`;

/** Vendors with their services and those services' categories attached. */
function vendorsWithCatalogue(db: DbExecutor) {
  return db
    .select({
      id: vendors.id,
      name: vendors.name,
      slug: vendors.slug,
      status: vendors.status,
      baseArea: vendors.baseArea,
      stripeStatus: vendors.stripeStatus,
      stripePayoutsEnabled: vendors.stripePayoutsEnabled,
      categoryName: categoryNames,
      serviceCount,
      updatedAt: vendors.updatedAt,
    })
    .from(vendors)
    .leftJoin(services, eq(services.vendorId, vendors.id))
    .leftJoin(categories, eq(categories.id, services.categoryId))
    .groupBy(vendors.id);
}

export type VendorRow = {
  id: string;
  name: string;
  slug: string;
  status: VendorStatus;
  baseArea: string | null;
  stripeStatus: string | null;
  stripePayoutsEnabled: Date | null;
  categoryName: string | null;
  serviceCount: number;
  updatedAt: Date;
};

export type VendorListFilter = {
  /** `undefined` means every status. */
  status?: VendorStatus | undefined;
  /** Matched against the business name and the categories it sells. */
  search?: string | undefined;
};

/**
 * The queue.
 *
 * Ordered by name rather than by how urgent a row is: the prototype's list is
 * alphabetical (lines 2715–2720), and an order that moves rows as their status
 * changes makes the screen hard to work down. Pending rows are found with the
 * filter chip, not by sorting.
 */
export async function listForAdmin(
  db: DbExecutor,
  filter: VendorListFilter = {},
): Promise<VendorRow[]> {
  const conditions = [];

  if (filter.status) {
    conditions.push(eq(vendors.status, filter.status));
  }

  const search = filter.search?.trim();
  if (search) {
    // `%` and `_` in the term are escaped by `ilike`'s parameter binding only
    // as values, not as pattern syntax — a search for "50%" would otherwise
    // match everything. Escaping them here keeps the term literal.
    const term = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    conditions.push(
      or(
        ilike(vendors.name, term),
        ilike(vendors.baseArea, term),
        // The category lives on the vendor's services, so it is asked for as a
        // question about those rows rather than matched against the aggregate —
        // an aggregate cannot be filtered in `where`, and pushing this into
        // `having` would drop vendors with no services from the queue entirely.
        exists(
          db
            .select({ matched: sql`1` })
            .from(services)
            .innerJoin(categories, eq(categories.id, services.categoryId))
            .where(and(eq(services.vendorId, vendors.id), ilike(categories.name, term))),
        ),
      )!,
    );
  }

  const query = vendorsWithCatalogue(db);

  const rows =
    conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(asc(vendors.name))
      : await query.orderBy(asc(vendors.name));

  return rows;
}

/** How many vendors sit in each status, for the filter chips' counts. */
export async function countByStatus(db: DbExecutor): Promise<Record<VendorStatus, number>> {
  const rows = await db
    .select({ status: vendors.status, total: sql<number>`count(*)::int` })
    .from(vendors)
    .groupBy(vendors.status);

  const counts: Record<VendorStatus, number> = {
    pending: 0,
    approved: 0,
    suspended: 0,
    blocked: 0,
  };

  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

export type VendorCore = {
  id: string;
  name: string;
  status: VendorStatus;
  /** Where the business works, which its approval email names. */
  baseArea: string | null;
  /** Whether it is demo data, which decides who may deliver its email. */
  isDemo: boolean;
};

/**
 * The status a decision is made against, read for update.
 *
 * `for update` is what makes the transition check mean anything: without the
 * lock, two administrators reading `pending` at the same moment both pass
 * `assertTransition` and both write, and the second one's effects run against a
 * status that is no longer there.
 */
export async function loadForUpdate(
  db: DbExecutor,
  vendorId: string,
): Promise<VendorCore | undefined> {
  const [row] = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      status: vendors.status,
      baseArea: vendors.baseArea,
      isDemo: vendors.isDemo,
    })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1)
    .for("update");

  return row;
}

/** The same row without the lock, for the screens that only read. */
export async function load(db: DbExecutor, vendorId: string): Promise<VendorRow | undefined> {
  const [row] = await vendorsWithCatalogue(db).where(eq(vendors.id, vendorId)).limit(1);

  return row;
}

/** Everything the drawer's onboarding checklist is decided from. */
export type VendorOnboarding = {
  tagline: string | null;
  baseArea: string | null;
  stripeAccountId: string | null;
  stripeStatus: string | null;
  stripeChargesEnabled: Date | null;
  stripePayoutsEnabled: Date | null;
  hstNumber: string | null;
  hstRegistered: Date | null;
  onboardingPercent: string | null;
  approvedAt: Date | null;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  serviceCount: number;
  publishedServiceCount: number;
};

export async function loadOnboarding(
  db: DbExecutor,
  vendorId: string,
): Promise<VendorOnboarding | undefined> {
  const [row] = await db
    .select({
      tagline: vendors.tagline,
      baseArea: vendors.baseArea,
      stripeAccountId: vendors.stripeAccountId,
      stripeStatus: vendors.stripeStatus,
      stripeChargesEnabled: vendors.stripeChargesEnabled,
      stripePayoutsEnabled: vendors.stripePayoutsEnabled,
      hstNumber: vendors.hstNumber,
      hstRegistered: vendors.hstRegistered,
      onboardingPercent: vendors.onboardingPercent,
      approvedAt: vendors.approvedAt,
      suspendedAt: vendors.suspendedAt,
      suspendedReason: vendors.suspendedReason,
      serviceCount,
      publishedServiceCount,
    })
    .from(vendors)
    .leftJoin(services, eq(services.vendorId, vendors.id))
    .where(eq(vendors.id, vendorId))
    .groupBy(vendors.id)
    .limit(1);

  return row;
}

export type VendorMemberRow = {
  userId: string;
  fullName: string;
  email: string;
  memberRole: string;
  userStatus: string;
};

export async function listMembers(db: DbExecutor, vendorId: string): Promise<VendorMemberRow[]> {
  return db
    .select({
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      memberRole: vendorMembers.role,
      userStatus: users.status,
    })
    .from(vendorMembers)
    .innerJoin(users, eq(users.id, vendorMembers.userId))
    .where(eq(vendorMembers.vendorId, vendorId))
    .orderBy(asc(vendorMembers.role), asc(users.fullName));
}

export type HeldTransferRow = {
  id: string;
  orderReference: string;
  kind: string;
  amount: bigint;
  currency: string;
  heldReason: string | null;
  updatedAt: Date;
};

/** What is sitting still because of this vendor's standing. */
export async function listHeldTransfers(
  db: DbExecutor,
  vendorId: string,
): Promise<HeldTransferRow[]> {
  return db
    .select({
      id: transfers.id,
      orderReference: orders.reference,
      kind: transfers.kind,
      amount: transfers.amount,
      currency: transfers.currency,
      heldReason: transfers.heldReason,
      updatedAt: transfers.updatedAt,
    })
    .from(transfers)
    .innerJoin(orders, eq(orders.id, transfers.orderId))
    .where(and(eq(transfers.vendorId, vendorId), eq(transfers.state, "held")))
    .orderBy(desc(transfers.updatedAt));
}

export type HeldJobRow = {
  id: string;
  type: string;
  runAfter: Date;
  heldReason: string | null;
};

/** Payout work that was parked rather than run. */
export async function listHeldJobs(db: DbExecutor, vendorId: string): Promise<HeldJobRow[]> {
  return db
    .select({
      id: jobs.id,
      type: jobs.type,
      runAfter: jobs.runAfter,
      heldReason: jobs.heldReason,
    })
    .from(jobs)
    .where(
      and(
        // The payout job specifically. Without this the drawer would list
        // anything held for any reason that happens to name one of this
        // vendor's orders.
        eq(jobs.type, "cooling_window_transfer"),
        eq(jobs.status, "held"),
        belongsToVendorsOrders(vendorId),
      ),
    )
    .orderBy(asc(jobs.runAfter));
}

export type StatusHistoryRow = {
  id: string;
  action: string;
  actingRole: string | null;
  actorEmail: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
};

/**
 * What has happened to this vendor, from the audit trail.
 *
 * Read from `audit_log` rather than kept as a second history table: two records
 * of the same events drift, and the audit row is the one that has to be right.
 */
export async function listStatusHistory(
  db: DbExecutor,
  vendorId: string,
  limit = 20,
): Promise<StatusHistoryRow[]> {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actingRole: auditLog.actingRole,
      actorEmail: users.email,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(eq(auditLog.entityType, "vendor"), eq(auditLog.entityId, vendorId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/** Moves the status, and the timestamps that go with it. */
export async function setStatus(
  db: DbExecutor,
  vendorId: string,
  status: VendorStatus,
  options: { reason?: string | undefined; now: Date },
): Promise<void> {
  await db
    .update(vendors)
    .set({
      status,
      updatedAt: options.now,
      ...(status === "approved" ? { approvedAt: options.now } : {}),
      // Cleared on the way out of suspension so the drawer does not keep
      // showing the reason a vendor was suspended after they were reinstated.
      ...(status === "suspended"
        ? { suspendedAt: options.now, suspendedReason: options.reason ?? null }
        : { suspendedAt: null, suspendedReason: null }),
    })
    .where(eq(vendors.id, vendorId));
}

/**
 * Parks the money owed to this vendor that has not left yet.
 *
 * `pending` **and** `failed`. A failed transfer is not a settled one — it is a
 * payout waiting to be retried, and leaving it alone means the retry pays a
 * suspended vendor. `paid` and `reversed` are deliberately untouched: that
 * money has moved and cannot be recalled by an `UPDATE`, so writing `held` over
 * it would make the ledger describe money that is not where it says.
 */
export async function holdUnpaidTransfers(
  db: DbExecutor,
  vendorId: string,
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(transfers)
    .set({ state: "held", heldReason: reason, updatedAt: now })
    .where(and(eq(transfers.vendorId, vendorId), inArray(transfers.state, ["pending", "failed"])))
    .returning({ id: transfers.id });

  return rows.length;
}

/**
 * Parks the payout work that has not run yet.
 *
 * `cooling_window_transfer` is the job that moves a deposit share to a vendor.
 * Holding the transfer rows alone would not be enough: this job creates the
 * transfer, so a suspension that left it queued would mint a fresh payout
 * minutes later.
 *
 * The job carries an order id in its payload rather than a vendor id, so the
 * match goes through the order.
 */
export async function holdQueuedTransferJobs(
  db: DbExecutor,
  vendorId: string,
  reason: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({ status: "held", heldReason: reason, updatedAt: now })
    .where(
      and(
        eq(jobs.type, "cooling_window_transfer"),
        eq(jobs.status, "queued"),
        belongsToVendorsOrders(vendorId),
      ),
    )
    .returning({ id: jobs.id });

  return rows.length;
}

/**
 * Releases what a suspension parked.
 *
 * Reinstatement has to undo both halves or the vendor is approved and still
 * not paid, with nothing on the screen saying why. Only rows this vendor's
 * standing put on hold are released — the held reason is matched — so a job
 * parked for some other cause stays parked.
 */
export async function releaseHeldForVendor(
  db: DbExecutor,
  vendorId: string,
  now: Date,
): Promise<{ transfers: number; jobs: number }> {
  const releasedTransfers = await db
    .update(transfers)
    .set({ state: "pending", heldReason: null, updatedAt: now })
    .where(
      and(
        eq(transfers.vendorId, vendorId),
        eq(transfers.state, "held"),
        like(transfers.heldReason, `${STANDING_HOLD}%`),
      ),
    )
    .returning({ id: transfers.id });

  const releasedJobs = await db
    .update(jobs)
    .set({ status: "queued", heldReason: null, updatedAt: now })
    .where(
      and(
        eq(jobs.type, "cooling_window_transfer"),
        eq(jobs.status, "held"),
        like(jobs.heldReason, `${STANDING_HOLD}%`),
        belongsToVendorsOrders(vendorId),
      ),
    )
    .returning({ id: jobs.id });

  return { transfers: releasedTransfers.length, jobs: releasedJobs.length };
}

/** The user ids of everyone attached to this vendor. */
export async function listMemberUserIds(db: DbExecutor, vendorId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: vendorMembers.userId })
    .from(vendorMembers)
    .where(eq(vendorMembers.vendorId, vendorId));

  return rows.map((row) => row.userId);
}

/**
 * Ends the sessions of this vendor's staff.
 *
 * The same cutoff `getActor` checks on every request, so a suspension takes
 * effect on their next page rather than when their token would have expired.
 *
 * `validAfter` must be `ctx.clock.realNow()`, and the write takes the later of
 * the two values — for both reasons set out on
 * `identity/repo.ts`'s `bumpSessionsValidAfter`, which this is the bulk form of.
 */
export async function bumpMemberSessions(
  db: DbExecutor,
  userIds: readonly string[],
  validAfter: Date,
): Promise<void> {
  if (userIds.length === 0) return;

  await db
    .update(users)
    .set({
      sessionsValidAfter: sql`greatest(${users.sessionsValidAfter}, ${validAfter.toISOString()}::timestamptz)`,
      updatedAt: validAfter,
    })
    .where(inArray(users.id, [...userIds]));
}

/**
 * Whether a job's order belongs to this vendor.
 *
 * A job names its order in its JSON payload, not in a column, so the match goes
 * through that extraction.
 *
 * The shape is checked before the cast rather than trusted. Postgres does not
 * promise to evaluate the `type` conjunct first, so one job whose payload
 * carries something that is not a uuid under `orderId` would abort the whole
 * statement — and this runs inside the suspension transaction, so a single bad
 * row would make *every* suspension of *every* vendor fail. Comparing as text
 * avoids the cast entirely.
 */
function belongsToVendorsOrders(vendorId: string) {
  return sql`${jobs.payload} ->> 'orderId' in (
    select ${orders.id}::text from ${orders} where ${orders.vendorId} = ${vendorId}
  )`;
}
