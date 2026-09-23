import { asc, eq, sql } from "drizzle-orm";
import { events, orderItems, orders, policyTemplates, vendors } from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";
import { formatMoney } from "../payments/money.js";
import { DEFAULT_TIMEZONE } from "../ordering/schedule.js";

/**
 * The words an order's emails are written from.
 *
 * One query, run inside the transaction that is moving the order, so the
 * message describes the order as it was when the move happened. Reading these
 * later — in the job, against the live row — is how a cancellation email ends
 * up quoting a refund that a subsequent action has already changed.
 *
 * Only the open fields are here. Anything secret (a payment link) is minted by
 * the caller and passed alongside; it is deliberately not something a read can
 * reproduce.
 */

export type OrderEmailFacts = {
  orderId: string;
  userId: string;
  isDemo: boolean;
  /** Values keyed by merge-field name, already formatted for a reader. */
  values: Record<string, string>;
};

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: DEFAULT_TIMEZONE,
});

const shortFormat = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: DEFAULT_TIMEZONE,
});

export function formatDay(instant: Date): string {
  return dayFormat.format(instant);
}

export function formatShortDay(instant: Date): string {
  return shortFormat.format(instant);
}

export async function orderEmailFacts(
  db: DbExecutor,
  orderId: string,
): Promise<OrderEmailFacts | undefined> {
  const [row] = await db
    .select({
      orderId: orders.id,
      reference: orders.reference,
      userId: orders.userId,
      isDemo: orders.isDemo,
      currency: orders.currency,
      total: orders.total,
      depositAmount: orders.depositAmount,
      balanceAmount: orders.balanceAmount,
      balanceDueAt: orders.balanceDueAt,
      graceExpiresAt: orders.graceExpiresAt,
      vendorName: vendors.name,
      vendorArea: vendors.baseArea,
      eventName: events.name,
      eventDate: events.eventDate,
      policyName: policyTemplates.name,
      // The first line of the order, which is what a customer calls the thing
      // they booked. The description is the copy taken at purchase, so it still
      // reads correctly after the catalogue has moved on.
      serviceName: sql<
        string | null
      >`(select i.description from ${orderItems} i where i.order_id = ${orders.id} order by i.created_at asc, i.id asc limit 1)`,
    })
    .from(orders)
    .leftJoin(vendors, eq(vendors.id, orders.vendorId))
    .leftJoin(events, eq(events.id, orders.eventId))
    .leftJoin(policyTemplates, eq(policyTemplates.id, orders.policyTemplateId))
    .where(eq(orders.id, orderId))
    .orderBy(asc(orders.id))
    .limit(1);

  if (!row) return undefined;

  const values: Record<string, string> = {
    order_reference: row.reference,
    vendor_name: row.vendorName ?? "the business",
    service_name: row.serviceName ?? "your booking",
    event_name: row.eventName ?? row.reference,
    city: row.vendorArea ?? "Toronto",
    deposit_amount: formatMoney(row.depositAmount, row.currency),
    balance_amount: formatMoney(row.balanceAmount, row.currency),
    // Always present, and zero where nothing is going back. A cancellation
    // email is read specifically to find out what happens to the money, and a
    // missing value here would refuse the send — which would roll back the
    // cancellation, because the message is queued in its transaction.
    refund_amount: formatMoney(0n, row.currency),
    // Always set, like every other field here. An order carries no template
    // when its lines were sold under none — the platform's own deposit rate
    // then applies — and a missing value would refuse the render *inside the
    // transaction moving the order*, so the deposit would be captured at the
    // provider and the booking would stay `pending_payment` for ever.
    policy_name: row.policyName ?? "standard",
  };

  // `event_date` is a calendar date, not an instant: an event is on a day in
  // Toronto whatever timezone the reader is in. Parsed as noon UTC so that
  // formatting it back in Toronto cannot land on the day before.
  //
  // Always set, like every other field here, because `orders.event_id` is
  // `on delete set null` and four automatic templates reference it. An order
  // whose event row has gone would otherwise refuse to render — inside the
  // transaction moving the order, so the deposit would be captured at the
  // provider and the order would stay `pending_payment` for ever.
  values["event_date"] = row.eventDate
    ? formatDay(new Date(`${row.eventDate}T12:00:00.000Z`))
    : "a date still to be confirmed";
  if (row.balanceDueAt) {
    values["balance_date"] = formatShortDay(row.balanceDueAt);
  }
  if (row.graceExpiresAt) {
    values["grace_deadline"] = formatShortDay(row.graceExpiresAt);
  }

  return { orderId: row.orderId, userId: row.userId, isDemo: row.isDemo, values };
}
