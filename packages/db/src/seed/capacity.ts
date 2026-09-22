import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { capacityBlocks, events, orderItems, orders } from "../schema/index.js";
import type { orderState } from "../schema/enums.js";
import { seedId } from "./ids.js";

/**
 * The dates the seeded bookings are holding.
 *
 * `capacity_blocks` is the table whose exclusion constraint actually prevents a
 * double booking — `createCheckout` does not pre-check availability, it inserts
 * and lets the constraint refuse. Nothing seeded it, so on every reset demo
 * database the constraint had nothing to collide with: the service page said a
 * date was free while the event hub showed it booked, and booking it again
 * succeeded, producing a second confirmed order against a date the business was
 * already committed to.
 *
 * Written from the rows that already exist rather than from a second copy of
 * the demo data: the order, its line, and the event's own date, time and zone.
 * The range is computed by Postgres from that event row, which is what keeps it
 * identical to the one a real checkout writes — and means no calendar
 * arithmetic is repeated here to drift from `ordering/schedule.ts` across a
 * daylight-saving boundary.
 */

type OrderStateName = (typeof orderState.enumValues)[number];

/**
 * Whether an order in this state is still holding the date it took.
 *
 * The domain answers this with `capacityIn(state) !== "released"`, and this
 * package may not import the domain — the dependency runs the other way. So the
 * classification is repeated here, typed against the enum this package owns, so
 * that a tenth order state does not compile until somebody says what its slot
 * is doing. That a new state compiles is not the same as it being right, which
 * is why `@occasion/db/testing` exports this for one caller: the parity test in
 * `packages/core` that holds it against the lifecycle's own answer.
 *
 * A released block is written all the same, and written inactive. The schema
 * asks for exactly that — only active blocks take part in the overlap
 * constraint, so a cancellation frees the slot without deleting the record that
 * it was ever held — and it is what makes the demo exercise both sides of the
 * flag: the date of a cancelled booking has to be bookable again.
 */
export const HOLDS_CAPACITY: Record<OrderStateName, boolean> = {
  pending_payment: true,
  confirmed: true,
  balance_due: true,
  action_required: true,
  issue: true,
  fulfilled: true,
  completed: true,
  cancelled: false,
  refunded: false,
};

/**
 * The half-open range a booking commits, `[local start, next local midnight)`.
 *
 * The same shape `createCheckout` writes: an event carries a date, an optional
 * start time and a zone but no duration, so the last instant it could still be
 * in progress is midnight at the end of its day. Computed in the event's own
 * zone, because a Toronto day is twenty-three hours long twice a year and a
 * range built from a fixed twenty-four would hold the wrong hour on those days.
 *
 * Rendered as text and handed straight back to a `tstzrange` column: Postgres
 * parses what Postgres printed, so nothing about the range is reconstructed in
 * JavaScript.
 */
const EVENT_RANGE = sql<string>`tstzrange(
  (${events.eventDate} + coalesce(${events.startTime}, '00:00'::time)) at time zone ${events.timezone},
  (${events.eventDate} + 1)::timestamp at time zone ${events.timezone},
  '[)'
)::text`;

export async function seedCapacityBlocks(db: Db): Promise<Record<string, number>> {
  const booked = await db
    .select({
      orderId: orders.id,
      reference: orders.reference,
      state: orders.state,
      serviceId: orderItems.serviceId,
      during: EVENT_RANGE,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(events, eq(events.id, orders.eventId))
    // `order_items.service_id` is nullable — retiring a listing keeps the
    // receipt and drops the link — and a block is a hold on a service, so a
    // line with none has nothing to hold.
    .where(and(eq(orders.isDemo, true), isNotNull(orderItems.serviceId)));

  if (booked.length === 0) return { capacity_blocks: 0 };

  const blockRows = booked.map((line) => ({
    id: seedId(`capacity_block:${line.reference}`),
    serviceId: line.serviceId as string,
    // A plain column, not a reference: `capacity_blocks.order_id` carries no
    // foreign key in the schema — it is declared in the roles migration, to
    // keep `ordering` and `catalog` from importing each other.
    orderId: line.orderId,
    during: line.during,
    active: HOLDS_CAPACITY[line.state],
  }));

  await db
    .insert(capacityBlocks)
    .values(blockRows)
    .onConflictDoUpdate({
      target: capacityBlocks.id,
      set: { during: sql`excluded.during`, active: sql`excluded.active` },
    });

  return { capacity_blocks: blockRows.length };
}
