import { describe, expect, it } from "vitest";
import { eventBudget, lineSubtotal } from "./budget.js";

/** Sarah's 30th: C$4,000, and the two confirmed bookings against it. */
const BUDGET = 400_000n;
const FLOWERS_SUBTOTAL = 29_000n;
const PHOTOGRAPHY_SUBTOTAL = 45_000n;

describe("a line's subtotal", () => {
  it("multiplies the unit price by the quantity", () => {
    expect(lineSubtotal({ unitPrice: 14_500n, quantity: 2 })).toBe(29_000n);
  });

  it("stays exact at quantities a float would round", () => {
    // Cents as `bigint` is the rule the whole money layer is built on. This is
    // the product that stops being exact the moment somebody reaches for a
    // `number` here.
    expect(lineSubtotal({ unitPrice: 333_333_333_333_333_333n, quantity: 3 })).toBe(
      999_999_999_999_999_999n,
    );
  });
});

describe("committed", () => {
  it("sums the pre-tax subtotals of the bookings that still hold their dates", () => {
    // The two live orders on the event: C$290.00 and C$450.00, pre-tax.
    const result = eventBudget({
      budget: BUDGET,
      orders: [
        { state: "confirmed", subtotal: FLOWERS_SUBTOTAL },
        { state: "confirmed", subtotal: PHOTOGRAPHY_SUBTOTAL },
      ],
      inPlan: [],
    });

    expect(result.committed).toBe(74_000n);
    expect(result.remaining).toBe(326_000n);
  });

  it("never counts tax", () => {
    // Commission is charged on the subtotal and HST follows the vendor as
    // supplier, so a total is the subtotal plus tax the customer would pay on
    // any equivalent booking. Counting it tells them they overspent on tax.
    const totals = eventBudget({
      budget: BUDGET,
      // What the same two orders total *with* HST: C$327.70 and C$508.50.
      orders: [
        { state: "confirmed", subtotal: 32_770n },
        { state: "confirmed", subtotal: 50_850n },
      ],
      inPlan: [],
    });

    expect(totals.committed).not.toBe(74_000n);
    expect(totals.committed).toBe(83_620n);
  });

  it("leaves cancelled and refunded bookings out", () => {
    const result = eventBudget({
      budget: BUDGET,
      orders: [
        { state: "confirmed", subtotal: FLOWERS_SUBTOTAL },
        { state: "cancelled", subtotal: 500_000n },
        { state: "refunded", subtotal: 500_000n },
      ],
      inPlan: [],
    });

    expect(result.committed).toBe(FLOWERS_SUBTOTAL);
  });

  it("counts a booking that is merely unpaid, delivered or finished", () => {
    // Everything that still holds the date is money the customer has committed.
    for (const state of ["pending_payment", "balance_due", "fulfilled", "completed"] as const) {
      expect([
        state,
        eventBudget({ budget: null, orders: [{ state, subtotal: 100n }], inPlan: [] }).committed,
      ]).toEqual([state, 100n]);
    }
  });

  it("adds the subtotals of what is chosen but not yet bought", () => {
    const result = eventBudget({
      budget: BUDGET,
      orders: [{ state: "confirmed", subtotal: FLOWERS_SUBTOTAL }],
      inPlan: [
        { unitPrice: 20_000n, quantity: 2 },
        { unitPrice: 5_000n, quantity: 1 },
      ],
    });

    expect(result.committed).toBe(29_000n + 45_000n);
  });
});

describe("remaining", () => {
  it("is what is left of the budget", () => {
    const result = eventBudget({
      budget: BUDGET,
      orders: [{ state: "confirmed", subtotal: 100_000n }],
      inPlan: [],
    });

    expect(result).toEqual({ budget: BUDGET, committed: 100_000n, remaining: 300_000n });
  });

  it("goes negative rather than clamping", () => {
    // Somebody who has committed past their budget has done so, and a floor at
    // zero hides the one number they need.
    const result = eventBudget({
      budget: BUDGET,
      orders: [{ state: "confirmed", subtotal: 450_000n }],
      inPlan: [],
    });

    expect(result.remaining).toBe(-50_000n);
  });

  it("is nothing at all when no budget was set", () => {
    // Not zero: "nothing left" and "nothing to measure against" are different
    // answers, and only one of them should colour a bar red.
    const result = eventBudget({
      budget: null,
      orders: [{ state: "confirmed", subtotal: 100_000n }],
      inPlan: [],
    });

    expect(result).toEqual({ budget: null, committed: 100_000n, remaining: null });
  });

  it("is the whole budget when nothing is committed", () => {
    expect(eventBudget({ budget: BUDGET, orders: [], inPlan: [] })).toEqual({
      budget: BUDGET,
      committed: 0n,
      remaining: BUDGET,
    });
  });
});
