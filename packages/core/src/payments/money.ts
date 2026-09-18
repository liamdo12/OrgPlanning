/**
 * The money split, in integer cents. The only module here that rounds.
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
 *   vendorShare     total − commission − commissionTax
 *
 * Both sides reconcile to the customer's total whether or not the vendor is
 * registered, which is the identity the tests assert rather than describe.
 *
 * The prototype's "Transfer deposit share · C$58.50" (line 2156) is **not**
 * normative and is not reproducible from this rule or any other consistent one:
 * its own figures disagree with each other. See `docs/design-gaps.md`.
 *
 * `packages/db/src/seed/money.ts` computes the same split for the seeded rows
 * and cannot import this module — `packages/db` may not depend on
 * `packages/core`, and inverting that to share fifty lines of arithmetic would
 * put the domain's money rule inside the schema package. The two are held
 * together by `money-parity.test.ts`, which runs both over the same inputs.
 */

import { ValidationError } from "../errors.js";

export type OrderMoney = {
  subtotal: bigint;
  /** The vendor's HST on their own supply. Zero when they are unregistered. */
  tax: bigint;
  total: bigint;
  commission: bigint;
  commissionTax: bigint;
  /** What reaches the vendor across every transfer for this order. */
  vendorShare: bigint;
};

export type OrderMoneyInput = {
  subtotal: bigint;
  vendorHstRegistered: boolean;
  commissionBps: number;
  hstBps: number;
};

/**
 * Rounds half away from zero, the convention people expect for currency.
 *
 * Integer arithmetic throughout: the moment a rate is applied as a float, two
 * amounts that should agree stop agreeing at the seventh decimal place, and the
 * disagreement lands in a ledger.
 */
export function applyBps(amount: bigint, bps: number): bigint {
  assertBps(bps);
  const numerator = amount * BigInt(bps);
  const quotient = numerator / 10_000n;
  const remainder = numerator % 10_000n;
  return remainder * 2n >= 10_000n ? quotient + 1n : quotient;
}

/** The whole split for one order. */
export function computeOrderMoney(input: OrderMoneyInput): OrderMoney {
  const { subtotal, vendorHstRegistered, commissionBps, hstBps } = input;

  if (subtotal < 0n) {
    throw new ValidationError("An order subtotal cannot be negative.", { subtotal: "negative" });
  }

  const tax = vendorHstRegistered ? applyBps(subtotal, hstBps) : 0n;
  const total = subtotal + tax;
  const commission = applyBps(subtotal, commissionBps);
  const commissionTax = applyBps(commission, hstBps);

  const vendorShare = total - commission - commissionTax;
  if (vendorShare < 0n) {
    // The platform's cut exceeds what the customer paid, which needs a
    // commission near 90% to happen. It is a misconfiguration rather than a
    // booking, and everything downstream — the allocation, the transfers —
    // would otherwise quietly do arithmetic on it.
    throw new ValidationError("The platform's cut cannot exceed the order total.", {
      commissionBps: "excessive",
    });
  }

  return { subtotal, tax, total, commission, commissionTax, vendorShare };
}

/**
 * Splits an amount into weighted parts that sum back to it exactly.
 *
 * Largest remainder: every part is floored, and the cents left over go to the
 * parts with the largest fractional remainder, one each. Rounding each part on
 * its own instead leaves the sum a cent or two away from the whole, and the gap
 * is money — either the platform keeps a cent it never charged, or a payout
 * overdraws the payment it came from.
 *
 * Ties break towards the earlier part, so the same weights always produce the
 * same allocation. A split that depends on iteration order is one that
 * reconciles on Tuesday and not on Wednesday.
 */
export function allocate(amount: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) {
    throw new ValidationError("An allocation needs at least one part.", { weights: "empty" });
  }
  if (weights.some((weight) => weight < 0n)) {
    throw new ValidationError("An allocation weight cannot be negative.", { weights: "negative" });
  }
  if (amount < 0n) {
    // The largest-remainder pass only ever adds, so a negative amount would
    // come back short: `allocate(-10n, [1n, 2n])` would return parts summing to
    // −9. Nothing should be splitting a negative amount, and a split that
    // silently loses a cent is worse than a refusal.
    throw new ValidationError("An allocation cannot split a negative amount.", {
      amount: "negative",
    });
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight === 0n) {
    throw new ValidationError("An allocation needs a non-zero weight.", { weights: "zero" });
  }

  const shares = weights.map((weight) => (amount * weight) / totalWeight);
  const remainders = weights.map((weight) => (amount * weight) % totalWeight);

  // Largest remainder first; the earlier part wins a tie.
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((a, b) => {
      if (a.remainder === b.remainder) return a.index - b.index;
      return a.remainder > b.remainder ? -1 : 1;
    });

  let left = amount - shares.reduce((sum, part) => sum + part, 0n);
  for (const { index } of order) {
    if (left <= 0n) break;
    shares[index] = (shares[index] as bigint) + 1n;
    left -= 1n;
  }

  return shares;
}

/** One instalment of an order: what the customer pays, and what of it is passed on. */
export type MoneySlice = {
  /** What the customer is charged for this part. */
  amount: bigint;
  /** This instalment's proportional slice of `vendorShare`. */
  vendorShare: bigint;
};

/**
 * Splits an order's money across its instalments.
 *
 * Each payment carries its proportional slice, so a cancellation after the
 * deposit does not require clawing back a whole commission. The slices sum to
 * `vendorShare` exactly — that is what `allocate` is for, and the test that
 * proves it is the one that matters in this file.
 *
 * `amounts` must sum to the order total. A caller that passes anything else is
 * describing a different order, and the mistake is worth a throw rather than a
 * quietly rebalanced split.
 */
export function sliceOrderMoney(money: OrderMoney, amounts: readonly bigint[]): MoneySlice[] {
  const charged = amounts.reduce((sum, amount) => sum + amount, 0n);
  if (charged !== money.total) {
    throw new ValidationError("The instalments must sum to the order total.", {
      amounts: "mismatched",
    });
  }

  const shares = allocate(money.vendorShare, amounts);
  return amounts.map((amount, index) => ({ amount, vendorShare: shares[index] as bigint }));
}

function assertBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new ValidationError(`A rate must be integer basis points in [0, 10000], got ${bps}.`, {
      bps: "invalid",
    });
  }
}
