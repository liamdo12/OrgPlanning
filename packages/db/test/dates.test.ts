import { describe, expect, it } from "vitest";
import { daysBeforeLocal } from "../src/seed/index.js";

/**
 * "Fourteen days before the event" is a date on a calendar, not 336 hours.
 *
 * Fixed instants, no database and no wall clock: the suite that covers this
 * through the seed uses `new Date()` as its anchor, so it only crosses a
 * daylight-saving boundary on some days of the year — it passed while the bug
 * was live on roughly two thirds of them.
 */

const TZ = "America/Toronto";

/** The calendar date of an instant, in the zone events are scheduled in. */
function localDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function localTime(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

describe("daysBeforeLocal", () => {
  it("keeps the wall-clock time across a spring-forward", () => {
    // 2027-03-14 is the transition; the event sits after it, the due date before.
    const event = new Date("2027-03-20T22:00:00.000Z"); // 18:00 EDT
    const due = daysBeforeLocal(event, 14, TZ);

    expect(localDate(event)).toBe("2027-03-20");
    expect(localDate(due)).toBe("2027-03-06");
    expect(localTime(due)).toBe(localTime(event));
    // The naive subtraction is an hour and a calendar day out.
    expect(due.getTime()).not.toBe(event.getTime() - 14 * 24 * 60 * 60 * 1000);
  });

  it("keeps the wall-clock time across a fall-back", () => {
    // 2026-11-01 is the transition; the event sits after it.
    const event = new Date("2026-11-07T23:00:00.000Z"); // 18:00 EST
    const due = daysBeforeLocal(event, 14, TZ);

    expect(localDate(event)).toBe("2026-11-07");
    expect(localDate(due)).toBe("2026-10-24");
    expect(localTime(due)).toBe(localTime(event));
  });

  it("is a plain subtraction when no transition intervenes", () => {
    const event = new Date("2027-06-19T22:00:00.000Z");
    const due = daysBeforeLocal(event, 14, TZ);

    expect(due.getTime()).toBe(event.getTime() - 14 * 24 * 60 * 60 * 1000);
    expect(localDate(due)).toBe("2027-06-05");
  });

  it("holds for every event hour on the day either side of a transition", () => {
    // The old code failed only for some hours; this walks all of them.
    for (let hour = 0; hour < 24; hour += 1) {
      const event = new Date(Date.UTC(2027, 2, 20, hour));
      const due = daysBeforeLocal(event, 14, TZ);
      const diff =
        (Date.parse(`${localDate(event)}T00:00:00Z`) - Date.parse(`${localDate(due)}T00:00:00Z`)) /
        (24 * 60 * 60 * 1000);
      expect(diff, `hour ${hour}`).toBe(14);
    }
  });
});
