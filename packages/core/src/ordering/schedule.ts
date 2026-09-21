import { ValidationError } from "../errors.js";
import type { ScheduledJob } from "./transitions.js";

/**
 * When the lifecycle's scheduled work becomes due.
 *
 * Three of the five offsets in `lifecycle.md` are not measured from now, and
 * two of those are calendar offsets rather than elapsed time. "Fourteen days
 * before the event" is a date somebody reads off a calendar: across a
 * daylight-saving boundary a fixed 336 hours lands on the day before or the day
 * after the intended one, and the failure only appears for events either side
 * of a March or November weekend. So the arithmetic is done in the event's own
 * timezone, and this module is where that lives.
 *
 * Pure: instants and zone names in, instants out. No context, no clock — the
 * caller supplies `now` from `ctx.clock`, because a domain module that reaches
 * for the time itself cannot be moved by the demo override.
 */

export const DEFAULT_TIMEZONE = "America/Toronto";

/** A zone's offset from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return (
    Date.UTC(
      field("year"),
      field("month") - 1,
      field("day"),
      // `hour12: false` renders midnight as 24 in some engines.
      field("hour") % 24,
      field("minute"),
      field("second"),
    ) - instant.getTime()
  );
}

/**
 * The instant at which a wall-clock time occurs in a zone.
 *
 * Guess, measure the offset at the guess, correct, and measure once more in
 * case the correction stepped across a transition. Not a loop: a wall-clock
 * time that a transition skips outright has no instant at all, and quietly
 * iterating towards one would invent an answer rather than land on the nearest
 * real time, which is what the second measurement does.
 */
function instantFromLocal(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  const offset = zoneOffsetMs(firstGuess, timeZone);
  return new Date(naive - offset);
}

/** Splits `YYYY-MM-DD` into numbers, or throws. */
function parseDay(day: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) {
    throw new ValidationError(`An event date must be YYYY-MM-DD, got ${day}.`, { day: "invalid" });
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * The same wall-clock time, a whole number of calendar days away.
 *
 * Negative counts move backwards, which is how the balance date is expressed:
 * a number of days before the event, not a number of hours before it.
 */
export function shiftCalendarDays(instant: Date, days: number, timeZone: string): Date {
  const naive = new Date(instant.getTime() + days * 24 * 60 * 60 * 1000);
  return new Date(
    naive.getTime() + (zoneOffsetMs(instant, timeZone) - zoneOffsetMs(naive, timeZone)),
  );
}

/**
 * How many calendar days apart two instants are, counted in a zone.
 *
 * The inverse of `shiftCalendarDays`, and the same kind of number: days on a
 * calendar, not elapsed time divided by twenty-four. Each instant is reduced to
 * the local date it fell on and those dates are subtracted, so a span
 * containing a daylight-saving transition — twenty-three hours long, or
 * twenty-five — still counts as the one day it was. Dividing milliseconds is
 * out by one twice a year, and only for spans that happen to straddle a March
 * or November weekend, which is the kind of defect that ships.
 *
 * Positive when `to` falls on the later day. Round-trips with the function
 * above: `calendarDaysBetween(t, shiftCalendarDays(t, n, zone), zone)` is `n`.
 * That is what makes it safe to describe an instant by the offset that produced
 * it, rather than restating a number the instant was derived from and hoping
 * the two stay in step.
 */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  return localDayNumber(to, timeZone) - localDayNumber(from, timeZone);
}

/**
 * Which calendar day a zone was on at an instant, counted from the epoch.
 *
 * Shifting by the zone's offset moves the instant's UTC fields onto the local
 * ones, so flooring to whole days leaves the local date and nothing else — no
 * hour, and therefore nothing for a transition to push across a boundary.
 */
function localDayNumber(instant: Date, timeZone: string): number {
  return Math.floor((instant.getTime() + zoneOffsetMs(instant, timeZone)) / 86_400_000);
}

/**
 * When an event starts.
 *
 * `startTime` is optional on the row, and an event with no stated time starts
 * when its day does. Using noon or "now" instead would move every derived date
 * for the events that have not set one.
 */
export function eventStartInstant(
  eventDate: string,
  startTime: string | null,
  timeZone: string,
): Date {
  const day = parseDay(eventDate);
  const [hour = 0, minute = 0] = (startTime ?? "00:00").split(":").map(Number);
  return instantFromLocal({ ...day, hour, minute }, timeZone);
}

/**
 * When an event ends.
 *
 * Nothing on the row says: events carry a date, an optional start time and a
 * timezone, and no duration. The last instant the event could still be in
 * progress is local midnight at the end of its day, so that is what `event_end`
 * means — stated here once rather than assumed differently by each caller.
 */
export function eventEndInstant(eventDate: string, timeZone: string): Date {
  const day = parseDay(eventDate);
  const midnight = instantFromLocal({ ...day, hour: 0, minute: 0 }, timeZone);
  return shiftCalendarDays(midnight, 1, timeZone);
}

/** The anchors every scheduled job measures from. */
export type ScheduleAnchors = {
  now: Date;
  eventStart: Date;
  eventEnd: Date;
  timeZone: string;
};

/**
 * When a job the lifecycle scheduled becomes due.
 *
 * The offsets come from `transitions.ts`, which reads them off the lifecycle
 * table; this turns one into an instant. Keeping the two apart is what lets the
 * table be asserted without a calendar and the calendar without a lifecycle.
 */
export function dueAt(job: ScheduledJob, anchors: ScheduleAnchors): Date {
  const anchor =
    job.anchor === "now"
      ? anchors.now
      : job.anchor === "event_start"
        ? anchors.eventStart
        : anchors.eventEnd;

  if (job.offsetDays !== undefined) {
    return shiftCalendarDays(anchor, job.offsetDays, anchors.timeZone);
  }

  return new Date(anchor.getTime() + (job.offsetMinutes ?? 0) * 60 * 1000);
}
