import { describe, expect, it } from "vitest";
import { ORDER_STATES, releasesCapacity, type OrderState } from "../ordering/transitions.js";
import { slotState, type QuoteState, type SlotFacts } from "./slots.js";

const EMPTY: SlotFacts = { hasService: false, offerCount: 0 };

describe("slot state", () => {
  it("is empty when nothing has been chosen", () => {
    expect(slotState(EMPTY)).toEqual({ kind: "empty" });
  });

  it("is in plan once a service is chosen", () => {
    expect(slotState({ ...EMPTY, hasService: true })).toEqual({ kind: "in_plan" });
  });

  it("does not require a package to be in plan", () => {
    // A package is optional in the schema and absent on one of the seeded
    // orders, so requiring one would make a package-less service unrepresentable
    // — the slot would read Empty while the customer is looking at their choice.
    expect(slotState({ ...EMPTY, hasService: true })).toEqual({ kind: "in_plan" });
  });

  it("carries the offer count while a request is open", () => {
    expect(slotState({ ...EMPTY, quoteState: "open", offerCount: 3 })).toEqual({
      kind: "quotes",
      count: 3,
    });
  });

  it("is a quotes slot with no offers yet", () => {
    // Zero is a count, not a different state: a request that has been sent and
    // answered by nobody is still the thing the customer is waiting on.
    expect(slotState({ ...EMPTY, quoteState: "open", offerCount: 0 })).toEqual({
      kind: "quotes",
      count: 0,
    });
  });

  it("stops being a quotes slot once the request is no longer open", () => {
    for (const state of ["closed", "expired", "booked"] satisfies QuoteState[]) {
      expect(slotState({ ...EMPTY, quoteState: state, offerCount: 3 })).toEqual({ kind: "empty" });
    }
  });
});

describe("what counts as booked", () => {
  /**
   * The whole lifecycle, so a state added later is classified here rather than
   * discovered on a customer's planner. The expectation is not a second list of
   * states: it asks the lifecycle the same question the derivation asks, which
   * is what makes the pairing hold as the lifecycle grows.
   */
  it("treats every order state that still holds the date as booked", () => {
    for (const state of ORDER_STATES) {
      const held = !releasesCapacity(state);
      expect([state, slotState({ ...EMPTY, orderState: state }).kind]).toEqual([
        state,
        held ? "booked" : "empty",
      ]);
    }
  });

  it("counts a checkout in flight as booked", () => {
    // `pending_payment` holds the date, and a second attempt would collide with
    // the first's capacity block. Drawing "Check out" over it invites exactly
    // that collision.
    expect(slotState({ ...EMPTY, orderState: "pending_payment" })).toEqual({ kind: "booked" });
  });

  it("counts a balance that is due as booked", () => {
    // The state an order enters ahead of the event. It is the deposit already
    // paid and the date already blocked; reverting the slot to In plan here is
    // the failure a hand-written list of booked states produces first.
    expect(slotState({ ...EMPTY, orderState: "balance_due" })).toEqual({ kind: "booked" });
  });

  it("counts a delivered and a finished booking as booked", () => {
    // The date was used, not freed. There is no "past" slot state to move to.
    expect(slotState({ ...EMPTY, orderState: "fulfilled" })).toEqual({ kind: "booked" });
    expect(slotState({ ...EMPTY, orderState: "completed" })).toEqual({ kind: "booked" });
  });

  it("releases the slot when the booking is cancelled or refunded", () => {
    for (const state of ["cancelled", "refunded"] satisfies OrderState[]) {
      expect(slotState({ ...EMPTY, orderState: state, hasService: true })).toEqual({
        kind: "in_plan",
      });
    }
  });

  it("falls back to what the slot still holds, with nothing written", () => {
    // Why nothing clears `order_id`: liveness comes from the order's state, so
    // a cancelled booking reverts the slot by derivation. A clearing write would
    // be a second source of truth that can disagree with the order.
    expect(slotState({ ...EMPTY, orderState: "cancelled" })).toEqual({ kind: "empty" });
    expect(
      slotState({ ...EMPTY, orderState: "refunded", quoteState: "open", offerCount: 2 }),
    ).toEqual({ kind: "quotes", count: 2 });
  });
});

describe("precedence", () => {
  it("puts a held booking above everything else", () => {
    expect(
      slotState({
        orderState: "confirmed",
        hasService: true,
        quoteState: "open",
        offerCount: 4,
      }),
    ).toEqual({ kind: "booked" });
  });

  it("puts a chosen service above an open request", () => {
    // The more definite decision, and the one with a checkout behind it. The
    // other ordering hides that button behind Compare.
    expect(slotState({ hasService: true, quoteState: "open", offerCount: 4 })).toEqual({
      kind: "in_plan",
    });
  });

  it("puts an open request above nothing", () => {
    expect(slotState({ hasService: false, quoteState: "open", offerCount: 1 })).toEqual({
      kind: "quotes",
      count: 1,
    });
  });
});
