import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors.js";
import { eventEndInstant, eventStartInstant, shiftCalendarDays } from "../ordering/schedule.js";
import { buildPaymentPlan } from "./plan.js";

/**
 * The payment plan, and the two boundaries it turns on.
 *
 * Both are off-by-one traps with money on the other side: at exactly the lead
 * time the balance would be due the instant the deposit is taken, and at
 * exactly the threshold amount a customer reading "under C$250 is paid in
 * full" expects a split.
 */

const TIMEZONE = "America/Toronto";
const NOW = new Date("2026-09-15T16:00:00.000Z");

const BASE = {
  now: NOW,
  depositBps: 2000,
  balanceLeadDays: 14,
  coolingWindowHours: 48,
  fullPaymentBelow: 25_000n,
  timeZone: TIMEZONE,
};

/** An event `days` calendar days after `NOW`, at the same wall-clock time. */
function eventIn(days: number): Date {
  return shiftCalendarDays(NOW, days, TIMEZONE);
}

describe("buildPaymentPlan", () => {
  it("splits a normal booking into a deposit and a balance", () => {
    const plan = buildPaymentPlan({ ...BASE, total: 32_770n, eventStart: eventIn(180) });

    expect(plan.kind).toBe("deposit_then_balance");
    expect(plan.reason).toBe("standard");
    // 20% of C$327.70, the prototype's own deposit (lines 1177–1178).
    expect(plan.depositAmount).toBe(6_554n);
    expect(plan.balanceAmount).toBe(26_216n);
    expect(plan.depositAmount + plan.balanceAmount).toBe(32_770n);
  });

  it("charges the balance fourteen calendar days before the event", () => {
    const eventStart = eventIn(180);
    const plan = buildPaymentPlan({ ...BASE, total: 32_770n, eventStart });

    expect(plan.balanceDueAt).toEqual(shiftCalendarDays(eventStart, -14, TIMEZONE));
  });

  it("keeps the balance date on the same wall clock across a daylight-saving boundary", () => {
    // Toronto leaves daylight time on 1 November 2026. An event at 18:00 on the
    // 8th is fourteen days after 18:00 on 25 October — but 336 hours earlier is
    // 19:00, an hour into the previous day's evening, and on a date boundary
    // that would charge a day late.
    const eventStart = eventStartInstant("2026-11-08", "18:00", TIMEZONE);
    const plan = buildPaymentPlan({
      ...BASE,
      total: 100_000n,
      now: new Date("2026-09-01T12:00:00.000Z"),
      eventStart,
    });

    const elapsed = new Date(eventStart.getTime() - 14 * 24 * 60 * 60 * 1000);
    expect(plan.balanceDueAt).not.toEqual(elapsed);
    expect(plan.balanceDueAt?.toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });

  it("ends free cancellation 48 hours after the deposit", () => {
    const plan = buildPaymentPlan({ ...BASE, total: 32_770n, eventStart: eventIn(180) });
    expect(plan.coolingWindowEndsAt).toEqual(new Date(NOW.getTime() + 48 * 60 * 60 * 1000));
  });

  it("takes the whole total when the event is inside the lead time", () => {
    const plan = buildPaymentPlan({ ...BASE, total: 100_000n, eventStart: eventIn(10) });

    expect(plan.kind).toBe("full");
    expect(plan.reason).toBe("short_notice");
    expect(plan.depositAmount).toBe(100_000n);
    expect(plan.balanceAmount).toBe(0n);
    expect(plan.balanceDueAt).toBeNull();
  });

  it("treats the lead-time boundary as short notice, and a day past it as normal", () => {
    // Exactly fourteen days: the balance would be due now, which is not a plan.
    expect(buildPaymentPlan({ ...BASE, total: 100_000n, eventStart: eventIn(14) }).kind).toBe(
      "full",
    );
    expect(buildPaymentPlan({ ...BASE, total: 100_000n, eventStart: eventIn(15) }).kind).toBe(
      "deposit_then_balance",
    );
  });

  it("takes the whole total for a small booking, and splits at the threshold", () => {
    const small = buildPaymentPlan({ ...BASE, total: 24_999n, eventStart: eventIn(180) });
    expect(small.kind).toBe("full");
    expect(small.reason).toBe("small_total");

    // C$250 exactly reads as "not under C$250" to a customer, so it splits.
    const atThreshold = buildPaymentPlan({ ...BASE, total: 25_000n, eventStart: eventIn(180) });
    expect(atThreshold.kind).toBe("deposit_then_balance");
    expect(atThreshold.depositAmount).toBe(5_000n);
  });

  it("applies the policy's own deposit rate", () => {
    const rates: Array<[number, bigint]> = [
      [1000, 10_000n],
      [2000, 20_000n],
      [3000, 30_000n],
    ];

    for (const [depositBps, expected] of rates) {
      const plan = buildPaymentPlan({
        ...BASE,
        depositBps,
        total: 100_000n,
        eventStart: eventIn(180),
      });
      expect([depositBps, plan.depositAmount]).toEqual([depositBps, expected]);
    }
  });

  it("does not leave a balance step that charges nothing", () => {
    // A deposit rate of 100% leaves no balance; a rate that rounds to zero
    // leaves no deposit. Both are the whole amount, taken now.
    expect(
      buildPaymentPlan({ ...BASE, depositBps: 10_000, total: 100_000n, eventStart: eventIn(180) })
        .kind,
    ).toBe("full");
    expect(
      buildPaymentPlan({ ...BASE, depositBps: 0, total: 100_000n, eventStart: eventIn(180) }).kind,
    ).toBe("full");
  });

  it("refuses an order that charges nothing", () => {
    expect(() => buildPaymentPlan({ ...BASE, total: 0n, eventStart: eventIn(180) })).toThrow(
      ValidationError,
    );
  });
});

describe("event anchors", () => {
  it("starts an event with no stated time when its day starts", () => {
    expect(eventStartInstant("2026-09-20", null, TIMEZONE).toISOString()).toBe(
      "2026-09-20T04:00:00.000Z",
    );
    expect(eventStartInstant("2026-09-20", "17:00", TIMEZONE).toISOString()).toBe(
      "2026-09-20T21:00:00.000Z",
    );
  });

  it("ends an event at local midnight after its day, not 24 hours after it started", () => {
    expect(eventEndInstant("2026-09-20", TIMEZONE).toISOString()).toBe("2026-09-21T04:00:00.000Z");
    // The day daylight time ends is 25 hours long in Toronto, and the end of it
    // is still local midnight.
    expect(eventEndInstant("2026-11-01", TIMEZONE).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});
