import { and, asc, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  auditLog,
  events,
  orders,
  payments,
  policyTemplates,
  refunds,
  users,
  vendors,
} from "@occasion/db/schema";
import { PAGE_SIZE, SORTS, decodeCursor, encodeCursor } from "../paging.js";
import type { CoreContext, DbExecutor } from "../context.js";
import type { CursorKey } from "../paging.js";
import type { PaymentLabelKind } from "./payment-label.js";
import type { OrderState } from "./transitions.js";

/**
 * Database access for the admin order list.
 *
 * The shape of one query again, and the same trap as the account list: an order
 * row shows a payment position, and the rows that hold it are in two tables.
 * Joining `payments` **and** `refunds` to `orders` multiplies them together —
 * two payments and one refund give six rows, and the refund is then counted
 * twice in a sum that decides whether a customer has their money back.
 *
 * So each side is aggregated to one row per order before it is joined, and the
 * main query joins one-to-one and cannot fan out whatever the data does.
 */

export { PAGE_SIZE };

/**
 * Which payment positions to show, named after the labels they produce.
 *
 * The conditions below are a second expression of `paymentLabel`'s if-chain,
 * in SQL, and there is no version of this where there is only one: the label is
 * computed per row in TypeScript and the filter has to run in the database over
 * rows that are never fetched. What holds them together is
 * `admin-orders.test.ts`, which asks for each filter in turn and asserts every
 * row that comes back carries the matching label.
 */
export type PaymentFilter = "unpaid" | "deposit" | "paid" | "balance-failed" | "refunded";

export const PAYMENT_FILTERS = [
  "unpaid",
  "deposit",
  "paid",
  "balance-failed",
  "refunded",
] as const satisfies readonly PaymentFilter[];

/** The label kind each filter is supposed to select. */
export const KIND_FOR_FILTER: Record<PaymentFilter, PaymentLabelKind> = {
  unpaid: "unpaid",
  deposit: "deposit",
  paid: "paid_in_full",
  "balance-failed": "balance_failed",
  refunded: "refunded",
};

export type AdminOrderRow = {
  id: string;
  reference: string;
  state: OrderState;
  total: bigint;
  currency: string;
  createdAt: Date;
  /**
   * The same instant as `createdAt`, rendered by Postgres and never parsed.
   *
   * The page's cursor is built from this rather than from the `Date`, which
   * loses the microseconds that distinguish orders written in one transaction.
   * It is on the row because the cursor is made from the last row of a page.
   */
  cursorAt: string;
  vendorId: string;
  vendorName: string;
  vendorStatus: string;
  vendorPayoutsEnabledAt: Date | null;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  customerId: string;
  customerName: string;
  customerEmail: string;
  /** Everything a charge ever held, refunded charges included. */
  captured: bigint;
  /** What has gone back to the customer. */
  returned: bigint;
  balanceFailed: boolean;
};

export type OrderPage = {
  rows: AdminOrderRow[];
  nextCursor?: string | undefined;
  /** Every order matching the filters, not just this page. */
  total: number;
};

export type OrderListOptions = {
  state?: OrderState | undefined;
  payment?: PaymentFilter | undefined;
  vendorId?: string | undefined;
  /** Placed at or after this instant. */
  from?: Date | undefined;
  /** Placed strictly before this instant, so a day range is half-open. */
  to?: Date | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
};

/**
 * What every charge on an order came to, for one order.
 *
 * Correlated, and joined `LATERAL` rather than grouped over the whole table.
 * The difference is the whole performance story of this screen: a
 * `group by order_id` subquery is computed for every order that has ever been
 * paid before anything is joined, and because its columns are selected the
 * planner can neither drop it nor push the page's cursor into it — so every
 * page sorts the entire orders table and `orders_created_idx` goes unused. A
 * lateral is evaluated per row of the driving scan, which lets that scan walk
 * the index and stop at twenty-six rows.
 *
 * `succeeded` and `refunded` both count as captured, matching `netCaptured`: a
 * refunded payment *was* taken, and the refund row is what gives it back.
 *
 * `balanceFailed` is "a balance attempt failed and none has settled" — which is
 * "the latest one failed" for every order the lifecycle can produce, since a
 * balance that settles returns the order to `confirmed` and nothing charges it
 * again. Expressing it without an ordering means a successful retry clears the
 * flag by existing; nothing has to remember to.
 */
function paymentsFor(db: DbExecutor) {
  return db
    .select({
      // `sum(bigint)` is `numeric`, which the driver returns as a string. A raw
      // fragment carries no mapping, so a caller comparing it with `0n` would
      // throw; the conversion is explicit here rather than left to whoever
      // touches it first.
      captured: sql<bigint>`coalesce(sum(${payments.amount}) filter (
        where ${payments.state} in ('succeeded', 'refunded')
      ), 0)`
        .mapWith(BigInt)
        .as("captured"),
      balanceFailed: sql<boolean>`coalesce(
        bool_or(${payments.kind} = 'balance' and ${payments.state} = 'failed'), false
      ) and not coalesce(
        bool_or(${payments.kind} = 'balance' and ${payments.state} in ('succeeded', 'refunded')),
        false
      )`.as("balance_failed"),
    })
    .from(payments)
    .where(eq(payments.orderId, orders.id))
    .as("payment_agg");
}

/**
 * What has gone back, for one order.
 *
 * `needs_attention` counts as returned. That state is set *after* the refund
 * settles — it flags that the vendor's share was already transferred and
 * somebody has to reverse it — so the customer has their money whatever the
 * row is called. Treating it as outstanding would tell an administrator the
 * order still holds funds it has given back.
 */
function refundsFor(db: DbExecutor) {
  return db
    .select({
      returned: sql<bigint>`coalesce(sum(${refunds.amount}) filter (
        where ${refunds.state} in ('settled', 'needs_attention')
      ), 0)`
        .mapWith(BigInt)
        .as("returned"),
    })
    .from(refunds)
    .where(eq(refunds.orderId, orders.id))
    .as("refund_agg");
}

type Aggregates = {
  payment: ReturnType<typeof paymentsFor>;
  refund: ReturnType<typeof refundsFor>;
};

/**
 * The aggregates as they read once the left joins may have missed.
 *
 * `mapWith(BigInt)` again on the outside: the mapping belongs to the expression
 * that is selected, and wrapping an aggregate in `coalesce` produces a new one
 * that carries none. Without it these come back as ordinary numbers under a
 * `bigint` type, and the first subtraction against a real `bigint` throws.
 */
function position(aggregates: Aggregates) {
  return {
    captured: sql<bigint>`coalesce(${aggregates.payment.captured}, 0)`.mapWith(BigInt),
    returned: sql<bigint>`coalesce(${aggregates.refund.returned}, 0)`.mapWith(BigInt),
    balanceFailed: sql<boolean>`coalesce(${aggregates.payment.balanceFailed}, false)`,
  };
}

/**
 * The payment filter, as a condition.
 *
 * A direct transcription of `paymentLabel`'s branches, guards included: each
 * one repeats the conditions the branches above it failed, because a chain of
 * `if`s and a set of independent predicates are only the same thing when the
 * later predicates exclude the earlier cases themselves.
 */
function paymentCondition(filter: PaymentFilter, aggregates: Aggregates) {
  const { captured, returned, balanceFailed } = position(aggregates);
  const settled = sql`${returned} = 0 and not ${balanceFailed}`;

  switch (filter) {
    case "refunded":
      return sql`${returned} > 0`;
    case "balance-failed":
      return sql`${returned} = 0 and ${balanceFailed}`;
    case "paid":
      return sql`${settled} and ${captured} >= ${orders.total}`;
    case "deposit":
      return sql`${settled} and ${captured} > 0 and ${captured} < ${orders.total}`;
    case "unpaid":
      return sql`${settled} and ${captured} <= 0`;
  }
}

/**
 * Matched against the reference, the business, the event and the customer.
 *
 * Those are the four things an administrator has in front of them when somebody
 * writes in — an order number off an email, a business name, "the Okafor
 * wedding", or the address the message came from.
 */
function searchCondition(term: string) {
  // `%` and `_` are pattern syntax. Unescaped, a search for one matches every
  // order on the platform rather than none.
  const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return or(
    ilike(orders.reference, pattern),
    ilike(vendors.name, pattern),
    ilike(events.name, pattern),
    ilike(users.fullName, pattern),
    ilike(users.email, pattern),
  );
}

/**
 * The cursor: `(placed at, id)`, newest first. Encoded by `paging.ts`, which
 * documents why the instant is the database's own rendering and not a `Date`.
 *
 * The microsecond trap it describes is not hypothetical here: a multi-vendor
 * checkout writes its orders in one transaction, sharing `now()` to the
 * microsecond, which is exactly the case the id tiebreak exists for.
 */
const SORT = SORTS.ordersNewest;

/**
 * Everything after the cursor row, in the list's own order.
 *
 * A row comparison rather than two branches joined by `or`: `(a, b) < (c, d)`
 * is one expression with the same meaning and no way to get the tiebreak's
 * polarity wrong.
 */
function afterCursor(after: CursorKey) {
  return sql`(${orders.createdAt}, ${orders.id}) < (${after.value}::timestamptz, ${after.id}::uuid)`;
}

/** Conditions shared by the count and the page, so the two cannot disagree. */
function filterConditions(options: OrderListOptions, aggregates: Aggregates) {
  const conditions = [];

  if (options.state) conditions.push(eq(orders.state, options.state));
  if (options.payment) conditions.push(paymentCondition(options.payment, aggregates));
  if (options.vendorId) conditions.push(eq(orders.vendorId, options.vendorId));
  if (options.from) conditions.push(gte(orders.createdAt, options.from));
  if (options.to) conditions.push(lt(orders.createdAt, options.to));

  const term = options.search?.trim();
  if (term) conditions.push(searchCondition(term)!);

  return conditions;
}

const selection = (aggregates: Aggregates) => ({
  id: orders.id,
  reference: orders.reference,
  state: sql<OrderState>`${orders.state}::text`,
  total: orders.total,
  currency: orders.currency,
  createdAt: orders.createdAt,
  cursorAt: sql<string>`${orders.createdAt}::text`,
  vendorId: orders.vendorId,
  vendorName: vendors.name,
  // The vendor's standing rides along because a held payout is explained by it
  // and by nothing on the order: a transfer parked against a suspended
  // business reads as a platform fault until the reason is beside it.
  vendorStatus: sql<string>`${vendors.status}::text`,
  vendorPayoutsEnabledAt: vendors.stripePayoutsEnabled,
  eventId: orders.eventId,
  eventName: events.name,
  eventDate: events.eventDate,
  customerId: orders.userId,
  customerName: users.fullName,
  customerEmail: users.email,
  ...position(aggregates),
});

/**
 * One page of orders, newest first.
 *
 * Two queries: the count behind "132 orders", and the page. The rest of the
 * screen — the payment label, the money breakdown — is computed from what these
 * return rather than fetched per row, which is the property
 * `admin-orders.test.ts` asserts by counting the statements.
 */
export async function listForAdmin(
  ctx: CoreContext,
  options: OrderListOptions = {},
): Promise<OrderPage> {
  const db = ctx.db;
  const aggregates = { payment: paymentsFor(db), refund: refundsFor(db) };
  const conditions = filterConditions(options, aggregates);

  // The count carries the aggregates only when something is filtering on them.
  // A lateral returns exactly one row per order, so joining it cannot change a
  // count — but evaluating it for every order on the platform to answer "how
  // many" would cost the whole table for a number nothing reads off it.
  const counting = db
    .select({ total: sql<number>`count(*)::int` })
    .from(orders)
    // `events` is left-joined in both, because the search reads its name and an
    // inner join would silently drop every order with no event.
    .innerJoin(vendors, eq(vendors.id, orders.vendorId))
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(events, eq(events.id, orders.eventId))
    .$dynamic();

  if (options.payment) {
    counting.leftJoinLateral(aggregates.payment, sql`true`);
    counting.leftJoinLateral(aggregates.refund, sql`true`);
  }

  const [counted] = await counting.where(conditions.length > 0 ? and(...conditions) : undefined);

  const after = options.cursor ? decodeCursor(SORT, options.cursor) : undefined;
  const paged = after ? [...conditions, afterCursor(after)] : conditions;

  const rows = await db
    .select(selection(aggregates))
    .from(orders)
    .innerJoin(vendors, eq(vendors.id, orders.vendorId))
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(events, eq(events.id, orders.eventId))
    .leftJoinLateral(aggregates.payment, sql`true`)
    .leftJoinLateral(aggregates.refund, sql`true`)
    .where(paged.length > 0 ? and(...paged) : undefined)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    // One more than the page, so "is there another page" is answered without a
    // second count against a list that may have changed underneath.
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE) as AdminOrderRow[];
  const hasMore = rows.length > PAGE_SIZE;
  const last = page[page.length - 1];

  return {
    rows: page,
    ...(hasMore && last
      ? { nextCursor: encodeCursor(SORT, { value: last.cursorAt, id: last.id }) }
      : {}),
    total: counted?.total ?? 0,
  };
}

/** One order, with the same shape a row has. */
export async function loadForAdmin(
  ctx: CoreContext,
  orderId: string,
): Promise<AdminOrderRow | undefined> {
  const db = ctx.db;
  const aggregates = { payment: paymentsFor(db), refund: refundsFor(db) };

  const [row] = await db
    .select(selection(aggregates))
    .from(orders)
    .innerJoin(vendors, eq(vendors.id, orders.vendorId))
    .innerJoin(users, eq(users.id, orders.userId))
    .leftJoin(events, eq(events.id, orders.eventId))
    .leftJoinLateral(aggregates.payment, sql`true`)
    .leftJoinLateral(aggregates.refund, sql`true`)
    .where(eq(orders.id, orderId))
    .limit(1);

  return row;
}

export type VendorOption = { id: string; name: string };

/**
 * The businesses the vendor filter offers.
 *
 * Every vendor, not only those with orders: a filter that hides a business
 * because it has sold nothing yet answers "why is this vendor missing" with
 * silence, and "no orders" is a useful thing for an administrator to see
 * confirmed.
 */
export function listVendorOptions(ctx: CoreContext): Promise<VendorOption[]> {
  return ctx.db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .orderBy(asc(vendors.name));
}

export type PolicyRow = {
  tier: string;
  name: string;
  summary: string;
  depositBps: number;
  freeCancellationHours: number;
  lateRefundBps: number;
};

/** The cancellation terms the booking was made under, if it names any. */
export async function loadPolicy(
  ctx: CoreContext,
  orderId: string,
): Promise<PolicyRow | undefined> {
  const [row] = await ctx.db
    .select({
      tier: sql<string>`${policyTemplates.tier}::text`,
      name: policyTemplates.name,
      summary: policyTemplates.summary,
      depositBps: policyTemplates.depositBps,
      freeCancellationHours: policyTemplates.freeCancellationHours,
      lateRefundBps: policyTemplates.lateRefundBps,
    })
    .from(orders)
    .innerJoin(policyTemplates, eq(policyTemplates.id, orders.policyTemplateId))
    .where(eq(orders.id, orderId))
    .limit(1);

  return row;
}

export type AuditRow = {
  id: string;
  action: string;
  actingRole: string | null;
  actorEmail: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
};

/**
 * What has been done to this order, and by whom.
 *
 * Newest first, and bounded: an order that has been retried for a week has a
 * long history and the last few entries are the ones a question is about.
 */
export async function listAudit(
  ctx: CoreContext,
  orderId: string,
  limit = 20,
): Promise<AuditRow[]> {
  // Aliased because the order query already names `users` as the customer;
  // without a second name the join condition would be ambiguous.
  const actor = alias(users, "audit_actor");

  return ctx.db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      actingRole: sql<string | null>`${auditLog.actingRole}::text`,
      actorEmail: actor.email,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.actorUserId))
    .where(and(eq(auditLog.entityType, "order"), eq(auditLog.entityId, orderId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
