import { describe, expect, it } from "vitest";
import { computeMoney, deriveFromTotal } from "@occasion/db/testing";
import { applyBps, computeOrderMoney, sliceOrderMoney } from "./money.js";

/**
 * The seed's split and the domain's, held against each other.
 *
 * There are two implementations of one rule, and there is no version of this
 * repository where there is only one: the seed writes order rows and
 * `packages/db` may not import `packages/core`, so the seed cannot call the
 * domain's module and the domain's module cannot live in the schema package.
 *
 * What is available instead is this: run both over the same inputs and fail
 * when they disagree. The duplication is then a fact somebody has to keep true
 * rather than a fact nobody notices has stopped being true. Delete the seed's
 * copy the day the seed can call this one, and delete this file with it.
 */

const COMMISSION_BPS = 1000;
const HST_BPS = 1300;
const DEPOSIT_BPS = 2000;

/** The seeded totals, plus subtotals that land on rounding boundaries. */
const SUBTOTALS = [1n, 7n, 99n, 333n, 1_234n, 18_000n, 29_000n, 45_000n, 132_000n, 999_999n];

describe("money parity with the seed", () => {
  it("agrees on every order-level amount", () => {
    for (const subtotal of SUBTOTALS) {
      for (const registered of [true, false]) {
        const seeded = computeMoney({
          subtotalCents: subtotal,
          vendorHstRegistered: registered,
          commissionBps: COMMISSION_BPS,
          hstBps: HST_BPS,
          depositBps: DEPOSIT_BPS,
        });
        const domain = computeOrderMoney({
          subtotal,
          vendorHstRegistered: registered,
          commissionBps: COMMISSION_BPS,
          hstBps: HST_BPS,
        });

        expect([subtotal, registered, domain.subtotal]).toEqual([subtotal, registered, seeded.subtotal]);
        expect([subtotal, registered, domain.tax]).toEqual([subtotal, registered, seeded.tax]);
        expect([subtotal, registered, domain.total]).toEqual([subtotal, registered, seeded.total]);
        expect([subtotal, registered, domain.commission]).toEqual([
          subtotal,
          registered,
          seeded.commission,
        ]);
        expect([subtotal, registered, domain.commissionTax]).toEqual([
          subtotal,
          registered,
          seeded.commissionTax,
        ]);
      }
    }
  });

  it("agrees on what reaches the vendor, in total and per instalment", () => {
    for (const subtotal of SUBTOTALS) {
      for (const registered of [true, false]) {
        const seeded = computeMoney({
          subtotalCents: subtotal,
          vendorHstRegistered: registered,
          commissionBps: COMMISSION_BPS,
          hstBps: HST_BPS,
          depositBps: DEPOSIT_BPS,
        });
        const domain = computeOrderMoney({
          subtotal,
          vendorHstRegistered: registered,
          commissionBps: COMMISSION_BPS,
          hstBps: HST_BPS,
        });
        const slices = sliceOrderMoney(domain, [seeded.depositAmount, seeded.balanceAmount]);

        expect(seeded.depositVendorShare + seeded.balanceVendorShare).toBe(domain.vendorShare);
        expect(slices[0]?.vendorShare).toBe(seeded.depositVendorShare);
        expect(slices[1]?.vendorShare).toBe(seeded.balanceVendorShare);
      }
    }
  });

  it("agrees on the platform's cut when the seed works backwards from a total", () => {
    // The seeded orders are written from the totals the prototype shows, so
    // this is the path the real rows took. Everything computed forward from the
    // reconstructed subtotal still has to match.
    for (const total of [20_340n, 32_770n, 50_850n, 54_000n, 132_000n, 148_000n, 185_000n]) {
      for (const registered of [true, false]) {
        const seeded = deriveFromTotal({
          totalCents: total,
          vendorHstRegistered: registered,
          commissionBps: COMMISSION_BPS,
          hstBps: HST_BPS,
          depositBps: DEPOSIT_BPS,
        });
        const domain = computeOrderMoney({
          subtotal: seeded.subtotal,
          vendorHstRegistered: registered,
          commissionBps: COMMISSION_BPS,
          hstBps: HST_BPS,
        });

        expect(domain.commission).toBe(seeded.commission);
        expect(domain.commissionTax).toBe(seeded.commissionTax);
        // Both breakdowns reconcile against their own total, which is the
        // property the books need.
        expect(seeded.subtotal + seeded.tax).toBe(total);
        expect(domain.subtotal + domain.tax).toBe(domain.total);
        expect(seeded.depositVendorShare + seeded.balanceVendorShare).toBe(
          total - seeded.commission - seeded.commissionTax,
        );
      }
    }
  });

  it("does not claim a reconstructed subtotal reproduces the total it came from", () => {
    // Inverting a rounded rate is not lossless, and pretending otherwise is how
    // a cent goes missing. C$1,480.00 at 13% reconstructs to a subtotal of
    // C$1,309.73, whose own tax rounds down — recomputing forward lands on
    // C$1,479.99.
    const seeded = deriveFromTotal({
      totalCents: 148_000n,
      vendorHstRegistered: true,
      commissionBps: COMMISSION_BPS,
      hstBps: HST_BPS,
      depositBps: DEPOSIT_BPS,
    });
    const recomputed = computeOrderMoney({
      subtotal: seeded.subtotal,
      vendorHstRegistered: true,
      commissionBps: COMMISSION_BPS,
      hstBps: HST_BPS,
    });

    expect(seeded.tax).toBe(17_027n);
    expect(recomputed.tax).toBe(17_026n);
    expect(recomputed.total).toBe(147_999n);

    // Which is why a stored order's total is authoritative and is read, never
    // recomputed from its subtotal. The domain computes money forward, at
    // checkout, from catalogue prices — where the subtotal is the input rather
    // than something reconstructed from an answer.
    expect(seeded.subtotal + seeded.tax).toBe(148_000n);
  });

  it("agrees on the deposit amount itself", () => {
    for (const total of [20_340n, 32_770n, 50_850n, 132_000n, 185_000n]) {
      const seeded = deriveFromTotal({
        totalCents: total,
        vendorHstRegistered: true,
        commissionBps: COMMISSION_BPS,
        hstBps: HST_BPS,
        depositBps: DEPOSIT_BPS,
      });
      expect(applyBps(total, DEPOSIT_BPS)).toBe(seeded.depositAmount);
    }
  });
});
