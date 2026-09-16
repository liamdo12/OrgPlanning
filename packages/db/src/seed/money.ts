/**
 * The money split, in integer cents.
 *
 * The rule, and why each part of it is where it is:
 *
 *   subtotal        what the vendor charges, pre-tax
 *   tax             HST on that supply. The VENDOR is the supplier, so this is
 *                   the vendor's to remit — the platform must not keep it.
 *                   Zero when the vendor is not HST-registered.
 *   total           what the customer pays
 *   commission      the platform's cut, charged on the PRE-TAX subtotal, so the
 *                   platform never takes a percentage of someone else's tax
 *   commissionTax   HST on the platform's own service to the vendor
 *
 * A vendor's payout is therefore `subtotal + tax - commission - commissionTax`,
 * and the platform keeps `commission + commissionTax`. Both sides reconcile to
 * the customer's total whether or not the vendor is registered.
 *
 * Verified against the prototype's checkout summary
 * (`design/Event Marketplace Glass.dc.html`, lines 1172–1178): subtotal
 * C$290.00 → HST C$37.70 → total C$327.70, deposit 20% C$65.54, balance
 * C$262.16.
 *
 * NOTE: the prototype's "Transfer deposit share · C$58.50" (line 2156) is not
 * reproducible from this rule or any other consistent one — see
 * `docs/design-gaps.md`. The seed computes the deposit share instead of copying
 * that number.
 *
 * This lives in the seed because the seed needs concrete amounts today. The
 * canonical implementation belongs in the domain layer with the ordering
 * service; when it lands, this should be deleted rather than left to drift.
 */

export type MoneyBreakdown = {
  subtotal: bigint;
  tax: bigint;
  total: bigint;
  commission: bigint;
  commissionTax: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  /** What reaches the vendor for the deposit portion. */
  depositVendorShare: bigint;
  /** What reaches the vendor for the balance portion. */
  balanceVendorShare: bigint;
};

export type MoneyInput = {
  subtotalCents: bigint;
  /** An unregistered vendor charges no HST on their supply. */
  vendorHstRegistered: boolean;
  commissionBps: number;
  hstBps: number;
  depositBps: number;
};

/** Rounds half away from zero, the convention people expect for currency. */
function applyBps(amount: bigint, bps: number): bigint {
  const numerator = amount * BigInt(bps);
  const quotient = numerator / 10_000n;
  const remainder = numerator % 10_000n;
  return remainder * 2n >= 10_000n ? quotient + 1n : quotient;
}

export function computeMoney(input: MoneyInput): MoneyBreakdown {
  const { subtotalCents, vendorHstRegistered, commissionBps, hstBps, depositBps } = input;

  const tax = vendorHstRegistered ? applyBps(subtotalCents, hstBps) : 0n;
  const total = subtotalCents + tax;

  const commission = applyBps(subtotalCents, commissionBps);
  const commissionTax = applyBps(commission, hstBps);

  // The deposit is a share of what the customer pays, so it is taken on the
  // total rather than the subtotal — that is what the prototype charges.
  const depositAmount = applyBps(total, depositBps);
  const balanceAmount = total - depositAmount;

  // The platform's cut is withheld proportionally, so a cancellation after the
  // deposit does not require clawing back a full commission.
  const platformCut = commission + commissionTax;
  const depositCut = applyBps(platformCut, depositBps);

  return {
    subtotal: subtotalCents,
    tax,
    total,
    commission,
    commissionTax,
    depositAmount,
    balanceAmount,
    depositVendorShare: depositAmount - depositCut,
    balanceVendorShare: balanceAmount - (platformCut - depositCut),
  };
}

/**
 * Works backwards from a tax-inclusive total.
 *
 * The prototype displays totals, not subtotals, and those totals are what a
 * customer was shown — so they are authoritative. The subtotal absorbs the
 * rounding, which keeps `subtotal + tax === total` exactly.
 *
 * Every derived amount is then recomputed from that authoritative total rather
 * than from the reconstructed one. Taking them from `computeMoney` instead
 * leaves the deposit and balance splitting a total a cent away from the real
 * one — which is how a marketplace ends up with books that do not balance.
 */
export function deriveFromTotal(input: {
  totalCents: bigint;
  vendorHstRegistered: boolean;
  commissionBps: number;
  hstBps: number;
  depositBps: number;
}): MoneyBreakdown {
  const { totalCents, vendorHstRegistered, commissionBps, hstBps, depositBps } = input;

  const subtotal = vendorHstRegistered
    ? divideRounded(totalCents * 10_000n, BigInt(10_000 + hstBps))
    : totalCents;
  const tax = totalCents - subtotal;

  const commission = applyBps(subtotal, commissionBps);
  const commissionTax = applyBps(commission, hstBps);

  const depositAmount = applyBps(totalCents, depositBps);
  const balanceAmount = totalCents - depositAmount;

  const platformCut = commission + commissionTax;
  const depositCut = applyBps(platformCut, depositBps);

  return {
    subtotal,
    tax,
    total: totalCents,
    commission,
    commissionTax,
    depositAmount,
    balanceAmount,
    depositVendorShare: depositAmount - depositCut,
    balanceVendorShare: balanceAmount - (platformCut - depositCut),
  };
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}
