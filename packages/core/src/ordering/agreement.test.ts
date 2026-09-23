import { describe, expect, it } from "vitest";
import { AgreementMismatchError } from "../errors.js";
import { assertAgreement, type CheckoutExpectation } from "./agreement.js";

/**
 * Which figures a consent record is about.
 *
 * The interesting case is not the mismatch — it is the field that must *not* be
 * compared. An expectation that included the cooling-window end would abort
 * every checkout on the platform, because that instant is `now + hours` and the
 * two `now`s are the screen's and the transaction's.
 */

const SHOWN: CheckoutExpectation = {
  total: 32_770n,
  depositAmount: 6_554n,
  balanceAmount: 26_216n,
  balanceDueAt: new Date("2027-03-06T05:00:00.000Z"),
};

describe("the agreement", () => {
  it("passes when the four figures are the ones that were shown", () => {
    expect(() => assertAgreement(SHOWN, { ...SHOWN })).not.toThrow();
  });

  it("compares the balance date by value, not by identity", () => {
    // A `Date` is never `===` another, so an identity comparison would refuse
    // every checkout while looking like it compared something.
    expect(() =>
      assertAgreement(SHOWN, { ...SHOWN, balanceDueAt: new Date(SHOWN.balanceDueAt as Date) }),
    ).not.toThrow();
  });

  it("ignores anything that is not one of the four", () => {
    // The cooling-window end is the one that matters: it is computed from the
    // clock at the moment the plan is built, so the screen's copy and the
    // transaction's differ by however long the customer took to tick the box.
    expect(() =>
      assertAgreement(SHOWN, {
        ...SHOWN,
        ...({ coolingWindowEndsAt: new Date("2030-01-01T00:00:00.000Z") } as object),
      }),
    ).not.toThrow();
  });

  for (const [field, changed] of [
    ["total", { total: 32_771n }],
    ["depositAmount", { depositAmount: 6_555n }],
    ["balanceAmount", { balanceAmount: 26_215n }],
    ["balanceDueAt", { balanceDueAt: new Date("2027-03-07T05:00:00.000Z") }],
  ] as const) {
    it(`refuses when ${field} is not what was shown`, () => {
      expect(() => assertAgreement(SHOWN, { ...SHOWN, ...changed })).toThrow(
        AgreementMismatchError,
      );
    });
  }

  it("refuses a balance that has appeared or vanished", () => {
    // A rate change can turn a deposit-and-balance booking into one paid in
    // full, which is a different agreement even when the total is identical.
    expect(() =>
      assertAgreement(SHOWN, {
        total: SHOWN.total,
        depositAmount: SHOWN.total,
        balanceAmount: 0n,
        balanceDueAt: null,
      }),
    ).toThrow(AgreementMismatchError);
  });

  it("carries the figures that would actually be charged", () => {
    const actual = { ...SHOWN, depositAmount: 9_831n, balanceAmount: 22_939n };

    try {
      assertAgreement(SHOWN, actual);
      expect.unreachable("a changed deposit has to be refused");
    } catch (error) {
      // The only useful thing a screen can do is show these and ask again.
      // Re-quoting would be a third reading of the rates.
      expect((error as AgreementMismatchError).terms).toEqual(actual);
    }
  });
});
