/**
 * The day of the event, in the order things happen.
 *
 * A projection over the event and its items, not a table. Nothing here is
 * stored, and nothing here is a time zone conversion: every value is a local
 * clock time read on the event's own date in the event's own timezone, which is
 * exactly why `events.start_time` and `event_items.arrival_time` are `time`
 * columns rather than instants.
 */

/** An item as the schedule needs to see it. */
export type ScheduleItem = {
  /** `HH:MM:SS` as the database renders a `time`, or nothing if none is set. */
  arrivalTime: string | null;
  categoryName: string;
  vendorName: string | null;
};

/**
 * One line of the day.
 *
 * Structured rather than a sentence: the wording belongs to the screen, and a
 * domain that returned "Flowers arrive · Bloom & Co" would have to be edited to
 * change a separator.
 */
export type ScheduleEntry =
  | { kind: "venue"; time: string; venueName: string }
  | { kind: "arrival"; time: string; categoryName: string; vendorName: string | null };

/**
 * The day-of schedule: getting in, then everything that turns up.
 *
 * **Venue access leads when there is a venue**, whatever time it carries,
 * because being let in precedes everything that arrives — including a delivery
 * timed before the event begins. The rest are ordered ascending by arrival
 * time, which sorts correctly as text because the database renders a `time`
 * zero-padded and fixed-width.
 *
 * **An item without an arrival time is not on the schedule.** There is nothing
 * to place it by, and guessing one would put a vendor on a customer's running
 * order at a time nobody agreed to. Having an arrival time is the condition
 * rather than being booked: the time exists only because somebody set one, and
 * a delivery arranged before checkout is still part of the day.
 *
 * The ordering is stable for items sharing a time — a caller that hands them
 * over by category keeps that order, rather than having two vendors swap places
 * between renders.
 */
export function dayOfSchedule(input: {
  /** The event's own start time, `HH:MM:SS` or nothing. */
  startTime: string | null;
  venueName: string | null;
  items: readonly ScheduleItem[];
}): readonly ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];

  if (input.venueName !== null && input.startTime !== null) {
    entries.push({ kind: "venue", time: input.startTime, venueName: input.venueName });
  }

  const arrivals = input.items
    .filter((item): item is ScheduleItem & { arrivalTime: string } => item.arrivalTime !== null)
    .map((item): ScheduleEntry => ({
      kind: "arrival",
      time: item.arrivalTime,
      categoryName: item.categoryName,
      vendorName: item.vendorName,
    }))
    .sort((left, right) => left.time.localeCompare(right.time));

  return [...entries, ...arrivals];
}
