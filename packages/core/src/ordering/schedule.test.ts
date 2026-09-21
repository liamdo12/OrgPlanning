import { describe, expect, it } from "vitest";
import { calendarDaysBetween, eventStartInstant, shiftCalendarDays } from "./schedule.js";

/**
 * Calendar arithmetic, which is not elapsed-time arithmetic.
 *
 * Every claim here is about a span that contains a daylight-saving transition,
 * because that is the only case where the two disagree — and they disagree by
 * exactly one day, in a way that moves a charge or a label onto the wrong date
 * for events either side of one March or one November weekend a year.
 */

const TIMEZONE = "America/Toronto";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("calendarDaysBetween", () => {
  it("counts days on the calendar, not multiples of twenty-four hours", () => {
    // Toronto leaves daylight time on 1 November 2026, so the span from
    // 25 October to 8 November is fourteen calendar days and 337 hours.
    const from = eventStartInstant("2026-10-25", "18:00", TIMEZONE);
    const to = eventStartInstant("2026-11-08", "18:00", TIMEZONE);

    expect(calendarDaysBetween(from, to, TIMEZONE)).toBe(14);
    // The measurement the naive version would make, kept here so the
    // disagreement is visible rather than asserted about in the abstract.
    expect((to.getTime() - from.getTime()) / DAY_MS).toBeCloseTo(14 + 1 / 24, 5);
  });

  it("counts a spring-forward span the same way", () => {
    // Toronto enters daylight time on 8 March 2026: this span is 335 hours.
    const from = eventStartInstant("2026-03-01", "18:00", TIMEZONE);
    const to = eventStartInstant("2026-03-15", "18:00", TIMEZONE);

    expect(calendarDaysBetween(from, to, TIMEZONE)).toBe(14);
    expect((to.getTime() - from.getTime()) / DAY_MS).toBeCloseTo(14 - 1 / 24, 5);
  });

  it("inverts shiftCalendarDays for every offset it is given", () => {
    // The property the label on the demo clock rests on: an instant produced by
    // shifting can be described by the shift that produced it, without anybody
    // restating the number.
    const anchor = eventStartInstant("2026-11-08", "18:00", TIMEZONE);

    for (const days of [0, 1, 7, 14, 21, 30, 180, 365, -1, -14, -21, -365]) {
      const shifted = shiftCalendarDays(anchor, days, TIMEZONE);
      expect([days, calendarDaysBetween(anchor, shifted, TIMEZONE)]).toEqual([days, days]);
    }
  });

  it("is signed, and zero within one local day", () => {
    const morning = eventStartInstant("2026-11-08", "01:00", TIMEZONE);
    const evening = eventStartInstant("2026-11-08", "23:00", TIMEZONE);

    // The same local date however many hours apart — and 8 November is a
    // twenty-five hour day in Toronto, so these two are twenty-two hours apart
    // across the transition itself.
    expect(calendarDaysBetween(morning, evening, TIMEZONE)).toBe(0);
    expect(calendarDaysBetween(evening, morning, TIMEZONE)).toBe(0);

    const next = eventStartInstant("2026-11-09", "01:00", TIMEZONE);
    expect(calendarDaysBetween(evening, next, TIMEZONE)).toBe(1);
    expect(calendarDaysBetween(next, evening, TIMEZONE)).toBe(-1);
  });

  it("counts in the zone it is given, not the one the process runs in", () => {
    // 23:30 in Toronto on the 8th is already the 9th in UTC. A count that read
    // the instant's UTC date would be a day out for every evening event, which
    // is most of them.
    const late = eventStartInstant("2026-11-08", "23:30", TIMEZONE);
    const noonNext = eventStartInstant("2026-11-09", "12:00", TIMEZONE);

    expect(calendarDaysBetween(late, noonNext, TIMEZONE)).toBe(1);
    expect(calendarDaysBetween(late, noonNext, "UTC")).toBe(0);
  });
});
