import { and, eq, isNotNull, sql } from "drizzle-orm";
import { blackoutDates, capacityBlocks, services, vendors } from "@occasion/db/schema";
import type { CoreContext } from "../context.js";
import { NotFoundError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import { DEFAULT_TIMEZONE, eventEndInstant, eventStartInstant } from "../ordering/schedule.js";

/**
 * Whether one service looks free on one day.
 *
 * **The answer is advisory.** What actually decides a double booking is the
 * exclusion constraint `capacity_blocks_no_overlap`, inside the transaction
 * `createCheckout` runs: two requests that both read "free" here still cannot
 * both commit, and the second is refused by the database. This read exists so a
 * screen can grey out a date rather than let somebody fill in a booking and be
 * told at the end — not so the booking path can skip the constraint.
 *
 * Two sources and no third. A vendor's `blackout_dates` is the business saying
 * it is closed; an active `capacity_blocks` row is the date already being held
 * by an order. `daily_capacity` is deliberately **not** read: its `remaining`
 * column is decremented by no code path, and `createCheckout` takes an
 * exclusive hold for every line whatever the service's `booking_mode` — so
 * every service is already one booking per day and a "partly full" answer would
 * be a screen state nothing in the system can produce. The vendor's calendar is
 * where that limitation is fixed.
 *
 * The blackout is advisory in a second, weaker sense as well: nothing in the
 * booking path reads it, so a vendor's closed day refuses nobody yet. Saying so
 * here is the point — a caller that believed otherwise would be trusting a
 * check that does not exist.
 */

/**
 * Every answer this read can give, as a value.
 *
 * A list rather than a bare union so the absent one is assertable: there is no
 * "full", and no test could say so about a type that exists only at compile
 * time. See `availability.test.ts`.
 */
export const SERVICE_DAY_STATES = ["free", "booked", "blacked_out"] as const;

export type ServiceDayState = (typeof SERVICE_DAY_STATES)[number];

export type ServiceDayAvailability = {
  serviceId: string;
  /** The day asked about, `YYYY-MM-DD`, as read in the service's own zone. */
  day: string;
  state: ServiceDayState;
};

export async function serviceAvailability(
  ctx: CoreContext,
  _actor: Actor,
  serviceId: string,
  day: string,
): Promise<ServiceDayAvailability> {
  // The same conditions the catalogue is read under. A draft listing, or one
  // belonging to a business that is not approved, is not a thing whose calendar
  // a stranger may ask about — and answering would confirm the row exists.
  const [service] = await ctx.db
    .select({ id: services.id, vendorId: services.vendorId })
    .from(services)
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .where(
      and(
        eq(services.id, serviceId),
        eq(vendors.status, "approved"),
        isNotNull(services.publishedAt),
      ),
    )
    .limit(1);

  if (!service) throw new NotFoundError("No such service.");

  // The same half-open range a booking writes: local midnight to the next local
  // midnight. Computed in the zone rather than in UTC, because a day in Toronto
  // is twenty-three hours long twice a year and a range built from a fixed
  // twenty-four would answer about the wrong hour on those two days.
  const from = eventStartInstant(day, "00:00", DEFAULT_TIMEZONE);
  const until = eventEndInstant(day, DEFAULT_TIMEZONE);

  const [closed] = await ctx.db
    .select({ id: blackoutDates.id })
    .from(blackoutDates)
    .where(and(eq(blackoutDates.vendorId, service.vendorId), eq(blackoutDates.day, day)))
    .limit(1);

  if (closed) {
    return { serviceId: service.id, day, state: "blacked_out" };
  }

  // Only active blocks. A cancelled order's row stays for history and takes
  // part in neither the constraint nor this answer — which is what makes a
  // cancellation give the date back rather than lose it.
  const [held] = await ctx.db
    .select({ id: capacityBlocks.id })
    .from(capacityBlocks)
    .where(
      and(
        eq(capacityBlocks.serviceId, service.id),
        eq(capacityBlocks.active, true),
        sql`${capacityBlocks.during} && tstzrange(${from.toISOString()}, ${until.toISOString()}, '[)')`,
      ),
    )
    .limit(1);

  return { serviceId: service.id, day, state: held ? "booked" : "free" };
}
