import { describe, expect, it } from "vitest";
import { ORDER_STATES } from "@occasion/core";
import { toneFor } from "./order-state-tone";

/**
 * One mapping, and it answers for every state there is.
 *
 * The enum has nine values. The admin queue and the customer's own list both
 * draw a badge from this, and the spine reaches `action_required`,
 * `balance_due`, `issue`, `fulfilled` and `refunded` in ordinary use — a
 * mapping that had quietly stopped covering one of them would render a bare
 * badge on the state somebody most needs to act on.
 *
 * Read off the enum rather than from a list repeated here: a hardcoded nine
 * would pass on the day a tenth state is added, which is the day this test
 * exists for.
 */
describe("the order badge", () => {
  it("has a tone for every state the enum carries", () => {
    expect(ORDER_STATES.length).toBeGreaterThan(5);

    const missing = ORDER_STATES.filter((state) => !toneFor(state));
    expect(missing).toEqual([]);
  });

  it("reserves the danger tone for the one state that is actually wrong", () => {
    // `issue` is a booking somebody has complained about. Everything else is
    // either fine or unfinished, and an ended booking is not an alarm whichever
    // way it ended.
    const danger = ORDER_STATES.filter((state) => toneFor(state) === "danger");
    expect(danger).toEqual(["issue"]);
  });

  it("does not sound the same for a confirmed booking and a declined balance", () => {
    expect(toneFor("confirmed")).not.toBe(toneFor("action_required"));
  });
});
