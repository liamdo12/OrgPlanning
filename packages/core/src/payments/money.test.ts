import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors.js";
import { allocate, applyBps, computeOrderMoney, sliceOrderMoney } from "./money.js";

/**
 * The money rule, asserted as identities rather than as expected numbers.
 *
 * A test that says "the commission is 2,900 cents" only proves the function
 * still does what it did. The claims worth making are the ones a marketplace's
 * books depend on: that what the customer paid is exactly what the platform
 * kept plus what the vendor received, and that splitting either across
 * instalments does not lose or invent a cent.
 */

const COMMISSION_BPS = 1000;
const HST_BPS = 1300;

/** Subtotals chosen to land on both sides of every rounding boundary. */
const SUBTOTALS = [
  1n,
  7n,
  99n,
  100n,
  333n,
  1_234n,
  20_340n,
  29_000n,
  32_770n,
  45_000n,
  132_000n,
  148_000n,
  185_000n,
  999_999n,
  1_000_000_00n,
];

describe("applyBps", () => {
  it("rounds half away from zero", () => {
    // 50 at 50 bps is exactly 0.25 → 0; 150 at 50 bps is exactly 0.75 → 1.
    expect(applyBps(50n, 50)).toBe(0n);
    expect(applyBps(150n, 50)).toBe(1n);
    // The half itself: 100 at 50 bps is 0.5 → 1, not 0.
    expect(applyBps(100n, 50)).toBe(1n);
  });

  it("refuses a rate that is not integer basis points", () => {
    expect(() => applyBps(100n, 13.5)).toThrow(ValidationError);
    expect(() => applyBps(100n, -1)).toThrow(ValidationError);
    expect(() => applyBps(100n, 10_001)).toThrow(ValidationError);
  });
});

describe("computeOrderMoney", () => {
  it("reconciles for a registered vendor", () => {
    for (const subtotal of SUBTOTALS) {
      const money = computeOrderMoney({
        subtotal,
        vendorHstRegistered: true,
        commissionBps: COMMISSION_BPS,
        hstBps: HST_BPS,
      });

      // What the customer paid is what the platform kept plus what the vendor got.
      expect(money.commission + money.commissionTax + money.vendorShare).toBe(money.total);
      expect(money.subtotal + money.tax).toBe(money.total);
      // The vendor's own HST is theirs: it is inside their share, not the cut.
      expect(money.vendorShare).toBeGreaterThanOrEqual(money.tax);
    }
  });

  it("reconciles for an unregistered vendor, who charges no tax", () => {
    for (const subtotal of SUBTOTALS) {
      const money = computeOrderMoney({
        subtotal,
        vendorHstRegistered: false,
        commissionBps: COMMISSION_BPS,
        hstBps: HST_BPS,
      });

      expect(money.tax).toBe(0n);
      expect(money.total).toBe(subtotal);
      expect(money.commission + money.commissionTax + money.vendorShare).toBe(money.total);
    }
  });

  it("charges commission on the pre-tax subtotal, never on the tax", () => {
    const registered = computeOrderMoney({
      subtotal: 29_000n,
      vendorHstRegistered: true,
      commissionBps: COMMISSION_BPS,
      hstBps: HST_BPS,
    });
    const unregistered = computeOrderMoney({
      subtotal: 29_000n,
      vendorHstRegistered: false,
      commissionBps: COMMISSION_BPS,
      hstBps: HST_BPS,
    });

    // Same supply, same cut. Registration changes what the customer pays and
    // what the vendor remits, not what the platform takes.
    expect(registered.commission).toBe(unregistered.commission);
    expect(registered.commissionTax).toBe(unregistered.commissionTax);
    // And the whole of the difference in the total reaches the vendor.
    expect(registered.vendorShare - unregistered.vendorShare).toBe(registered.tax);
  });

  it("matches the prototype's checkout summary", () => {
    // design/Event Marketplace Glass.dc.html, lines 1172–1178: subtotal
    // C$290.00, HST 13% C$37.70, total C$327.70.
    const money = computeOrderMoney({
      subtotal: 29_000n,
      vendorHstRegistered: true,
      commissionBps: COMMISSION_BPS,
      hstBps: HST_BPS,
    });
    expect(money.tax).toBe(3_770n);
    expect(money.total).toBe(32_770n);
  });

  it("refuses a negative subtotal", () => {
    expect(() =>
      computeOrderMoney({
        subtotal: -1n,
        vendorHstRegistered: true,
        commissionBps: COMMISSION_BPS,
        hstBps: HST_BPS,
      }),
    ).toThrow(ValidationError);
  });
});

describe("allocate", () => {
  it("always sums to the amount it was given", () => {
    // Weights chosen so that proportional shares land on thirds and sevenths,
    // where independent rounding of each part is off by a cent or two.
    const cases: Array<[bigint, bigint[]]> = [
      [100n, [1n, 1n, 1n]],
      [10n, [3n, 3n, 3n, 1n]],
      [1n, [1n, 1n]],
      [0n, [5n, 3n]],
      [99_999n, [7n, 11n, 13n]],
      [26_216n, [6_554n, 26_216n]],
    ];

    for (const [amount, weights] of cases) {
      const shares = allocate(amount, weights);
      expect(shares.reduce((sum, share) => sum + share, 0n)).toBe(amount);
      expect(shares).toHaveLength(weights.length);
      expect(shares.every((share) => share >= 0n)).toBe(true);
    }
  });

  it("gives the leftover cents to the largest remainders", () => {
    // 10 split three ways is 3.33 each: two parts get the extra cent, and they
    // are the two with equal remainders, so the earlier ones win.
    expect(allocate(10n, [1n, 1n, 1n])).toEqual([4n, 3n, 3n]);
  });

  it("is deterministic for equal weights", () => {
    const first = allocate(100n, [1n, 1n, 1n, 1n, 1n, 1n, 1n]);
    const second = allocate(100n, [1n, 1n, 1n, 1n, 1n, 1n, 1n]);
    expect(first).toEqual(second);
  });

  it("refuses a split with nothing to split by", () => {
    expect(() => allocate(100n, [])).toThrow(ValidationError);
    expect(() => allocate(100n, [0n, 0n])).toThrow(ValidationError);
    expect(() => allocate(100n, [1n, -1n])).toThrow(ValidationError);
  });
});

describe("sliceOrderMoney", () => {
  it("splits the vendor's share across instalments that sum back exactly", () => {
    for (const subtotal of SUBTOTALS) {
      for (const registered of [true, false]) {
        const money = computeOrderMoney({
          subtotal,
          vendorHstRegistered: registered,
          commissionBps: COMMISSION_BPS,
          hstBps: HST_BPS,
        });

        // A 20% deposit and the rest, the way the plan splits a booking.
        const deposit = applyBps(money.total, 2000);
        const slices = sliceOrderMoney(money, [deposit, money.total - deposit]);

        expect(slices.reduce((sum, slice) => sum + slice.amount, 0n)).toBe(money.total);
        expect(slices.reduce((sum, slice) => sum + slice.vendorShare, 0n)).toBe(money.vendorShare);
      }
    }
  });

  it("refuses instalments that do not sum to the total", () => {
    const money = computeOrderMoney({
      subtotal: 29_000n,
      vendorHstRegistered: true,
      commissionBps: COMMISSION_BPS,
      hstBps: HST_BPS,
    });

    expect(() => sliceOrderMoney(money, [money.total - 1n])).toThrow(ValidationError);
    expect(() => sliceOrderMoney(money, [money.total, 1n])).toThrow(ValidationError);
  });

  it("charges nothing to the vendor beyond the platform's cut", () => {
    const money = computeOrderMoney({
      subtotal: 132_000n,
      vendorHstRegistered: false,
      commissionBps: COMMISSION_BPS,
      hstBps: HST_BPS,
    });
    const slices = sliceOrderMoney(money, [26_400n, 105_600n]);

    const kept = slices.reduce((sum, slice) => sum + (slice.amount - slice.vendorShare), 0n);
    expect(kept).toBe(money.commission + money.commissionTax);
  });
});
