import { and, desc, eq, sql } from "drizzle-orm";
import { events, orderItems, orders, policyTemplates, vendors } from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";
import type { OrderState } from "./transitions.js";

/**
 * What a customer's own bookings look like to them.
 *
 * Separate from `admin-repo` rather than a filter over it, because the two
 * screens are about different things. An administrator's list is a queue —
 * every order on the platform, with the customer and the payment state on each
 * row. A customer's list is a receipt: their own bookings, what was paid, and
 * what is still coming. Projecting the admin shape and hiding columns would
 * put the vendor's commission and payout one refactor away from a customer's
 * screen.
 *
 * Nothing here decides anything. The policies are in `customer-service.ts`.
 */

export type CustomerOrderRow = {
  id: string;
  reference: string;
  state: OrderState;
  vendorId: string;
  vendorName: string;
  /** The first line of the booking, as it was described at purchase. */
  summary: string;
  /** How many lines there are, so a row can say "and two more". */
  itemCount: number;
  eventId: string | null;
  eventName: string | null;
  /** `YYYY-MM-DD` in the event's own zone, or nothing when the event has gone. */
  eventDate: string | null;
  total: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  currency: string;
  balanceDueAt: Date | null;
  coolingWindowEndsAt: Date | null;
  placedAt: Date;
};

const rowColumns = {
  id: orders.id,
  reference: orders.reference,
  state: orders.state,
  vendorId: orders.vendorId,
  vendorName: vendors.name,
  eventId: orders.eventId,
  eventName: events.name,
  eventDate: events.eventDate,
  total: orders.total,
  depositAmount: orders.depositAmount,
  balanceAmount: orders.balanceAmount,
  currency: orders.currency,
  balanceDueAt: orders.balanceDueAt,
  coolingWindowEndsAt: orders.coolingWindowEndsAt,
  placedAt: orders.createdAt,
  /**
   * The first line and the number of them, as correlated subqueries.
   *
   * A join to `order_items` would multiply each order by its lines, so a
   * two-item booking would appear twice in a list whose whole job is to say how
   * many bookings somebody has. Both are `::text` and `::int`: a raw fragment
   * carries no column type, so the driver hands back whatever it decides, and a
   * `bigint` that arrives as a string throws the first time anything multiplies
   * it.
   */
  summary: sql<
    string | null
  >`(select i.description from ${orderItems} i where i.order_id = ${orders.id} order by i.created_at asc, i.id asc limit 1)`,
  itemCount: sql<number>`(select count(*)::int from ${orderItems} i where i.order_id = ${orders.id})`,
};

/** The row as the join hands it over, before the two absences are answered. */
type JoinedRow = Omit<CustomerOrderRow, "vendorName" | "summary"> & {
  vendorName: string | null;
  summary: string | null;
};

function present(row: JoinedRow): CustomerOrderRow {
  return {
    ...row,
    // Both joins are outer ones: an order outlives the event it was for, which
    // is `on delete set null`, and a vendor row can be restricted away from
    // under a very old booking. Neither is a reason to fail to show a receipt.
    vendorName: row.vendorName ?? "the business",
    summary: row.summary ?? "Your booking",
  };
}

/**
 * The caller's own bookings, newest first.
 *
 * Bounded rather than paged. The list is one person's own orders, the booked
 * strip in the shell asks for three, and a customer with more than a limit's
 * worth is a case this milestone does not have — a cursor here would be a
 * contract nothing yet needs and every screen would have to carry.
 */
export async function listForCustomer(
  db: DbExecutor,
  userId: string,
  limit: number,
): Promise<CustomerOrderRow[]> {
  const rows = await db
    .select(rowColumns)
    .from(orders)
    .leftJoin(vendors, eq(vendors.id, orders.vendorId))
    .leftJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);

  return rows.map(present);
}

/** The three most recent bookings for one event — the planner's own strip. */
export async function listForCustomerEvent(
  db: DbExecutor,
  userId: string,
  eventId: string,
  limit: number,
): Promise<CustomerOrderRow[]> {
  const rows = await db
    .select(rowColumns)
    .from(orders)
    .leftJoin(vendors, eq(vendors.id, orders.vendorId))
    .leftJoin(events, eq(events.id, orders.eventId))
    .where(and(eq(orders.userId, userId), eq(orders.eventId, eventId)))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit);

  return rows.map(present);
}

/** What the customer agreed to, as they were shown it. */
export type RecordedAgreement = {
  at: Date;
  total: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  balanceDueAt: Date | null;
};

export type CustomerOrderHead = CustomerOrderRow & {
  subtotal: bigint;
  tax: bigint;
  /** The event's local start, for the calendar file. Null when it has none. */
  eventStartTime: string | null;
  eventTimezone: string | null;
  eventVenue: string | null;
  /** The terms the booking was made under, named as the customer saw them. */
  policyName: string | null;
  policyTier: string | null;
  freeCancellationHours: number | null;
  /** Absent on a booking made before a consent record was kept, or without one. */
  agreement: RecordedAgreement | null;
};

export async function loadForCustomer(
  db: DbExecutor,
  orderId: string,
): Promise<CustomerOrderHead | undefined> {
  const [row] = await db
    .select({
      ...rowColumns,
      subtotal: orders.subtotal,
      tax: orders.tax,
      eventStartTime: events.startTime,
      eventTimezone: events.timezone,
      eventVenue: events.venueName,
      policyName: policyTemplates.name,
      policyTier: policyTemplates.tier,
      freeCancellationHours: policyTemplates.freeCancellationHours,
      agreedAt: orders.agreedAt,
      agreedTotal: orders.agreedTotal,
      agreedDepositAmount: orders.agreedDepositAmount,
      agreedBalanceAmount: orders.agreedBalanceAmount,
      agreedBalanceDueAt: orders.agreedBalanceDueAt,
    })
    .from(orders)
    .leftJoin(vendors, eq(vendors.id, orders.vendorId))
    .leftJoin(events, eq(events.id, orders.eventId))
    .leftJoin(policyTemplates, eq(policyTemplates.id, orders.policyTemplateId))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) return undefined;

  return {
    ...present(row),
    subtotal: row.subtotal,
    tax: row.tax,
    eventStartTime: row.eventStartTime,
    eventTimezone: row.eventTimezone,
    eventVenue: row.eventVenue,
    policyName: row.policyName,
    policyTier: row.policyTier,
    freeCancellationHours: row.freeCancellationHours,
    // Read as a whole or not at all: the five columns are written in one
    // statement, so a half-present agreement would mean a defect rather than a
    // booking whose consent is partly known.
    agreement:
      row.agreedAt === null || row.agreedTotal === null
        ? null
        : {
            at: row.agreedAt,
            total: row.agreedTotal,
            depositAmount: row.agreedDepositAmount ?? 0n,
            balanceAmount: row.agreedBalanceAmount ?? 0n,
            balanceDueAt: row.agreedBalanceDueAt,
          },
  };
}
