import { describe, expect, it } from "vitest";
import { IDLE, canPay, onDeclined, type PayFormState } from "./can-pay";

/**
 * Pay is disabled until the agreement is ticked, and a decline is survivable.
 *
 * Both are criteria of the screen rather than of the domain, and both are
 * decisions rather than markup, so they are asserted here instead of through a
 * render that would need a payment SDK to mount.
 */

const CONSENTED: PayFormState = { ...IDLE, consented: true };

describe("the pay button", () => {
  it("is dead until the agreement is ticked", () => {
    expect(canPay(IDLE, true)).toBe(false);
    expect(canPay(CONSENTED, true)).toBe(true);
  });

  it("stays dead while the payment SDK is still loading", () => {
    // Otherwise the button is live before the card fields can accept anything,
    // and pressing it fails with something no customer can act on.
    expect(canPay(CONSENTED, false)).toBe(false);
  });

  it("stays dead while a payment is in flight", () => {
    expect(canPay({ ...CONSENTED, submitting: true }, true)).toBe(false);
  });
});

describe("a declined card", () => {
  const declined = onDeclined({ ...CONSENTED, submitting: true }, "Your card was declined.");

  it("says what the provider said", () => {
    // "declined" and "insufficient funds" are different problems with different
    // fixes; one flattened message makes the screen useless to the person who
    // can act on it.
    expect(declined.error).toBe("Your card was declined.");
  });

  it("keeps the agreement ticked", () => {
    // The terms did not change. Making somebody agree again because their card
    // failed is a second reading of something they already read.
    expect(declined.consented).toBe(true);
  });

  it("lets them try again", () => {
    expect(declined.submitting).toBe(false);
    expect(canPay(declined, true)).toBe(true);
  });

  it("still says something when the provider says nothing", () => {
    for (const empty of [null, undefined, "   "]) {
      const state = onDeclined(CONSENTED, empty);
      expect(state.error).not.toBeNull();
      expect((state.error as string).length).toBeGreaterThan(0);
    }
  });

  it("does not claim the booking is gone", () => {
    // It is not: the order is still `pending_payment` and still holding the
    // date, and the same screen resumes it.
    expect(onDeclined(CONSENTED, null).error).toContain("still held");
  });
});
