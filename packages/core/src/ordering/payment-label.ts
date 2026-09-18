import { formatMoney } from "../payments/money.js";

/**
 * Where an order stands with money, in the four words a table cell has room for.
 *
 * A pure function of the payment rows, never of the order's state. Those are
 * different facts and they disagree on purpose: an order is `confirmed` from
 * the deposit until the day it is delivered, and during that time the payment
 * position moves from a deposit to paid in full to — sometimes — a failed
 * balance, without the state changing at all. The prototype's own list makes
 * the same separation, carrying `Payment` and `State` as two columns
 * (line 1798).
 *
 * The inputs are three aggregates and a flag rather than the rows themselves,
 * because the list computes them in SQL for twenty-five orders at once. The
 * detail view hands the same shape in from rows it already has.
 */

export type PaymentLabelKind =
  "unpaid" | "deposit" | "paid_in_full" | "balance_failed" | "refunded";

export type PaymentPosition = {
  /** What the customer owes in total, from the order row. */
  total: bigint;
  /**
   * Everything a charge has ever held, refunded charges included.
   *
   * The same convention as `netCaptured`: a payment that has been refunded
   * *was* taken, and the refund row below is what gives it back. Counting only
   * what is still held would subtract the same refund twice.
   */
  captured: bigint;
  /** What has gone back to the customer. */
  returned: bigint;
  /**
   * A balance attempt failed and none has settled.
   *
   * A fact about the attempts rather than about the order, so a balance that
   * succeeds on the second try stops reading as failed the moment it settles,
   * without anything having to remember to clear a flag. Stated without an
   * ordering on purpose — "the latest one failed" would need one, and the two
   * only differ for an order whose balance settled, was refunded and then
   * failed again, which the refund outranks anyway.
   */
  balanceFailed: boolean;
  currency: string;
};

export type PaymentLabel = { kind: PaymentLabelKind; label: string };

/**
 * The five labels, in the order they are decided.
 *
 * The order is the rule. Money that has gone back outranks everything, because
 * a refunded order that still read "Paid in full" would put an administrator on
 * the phone to a customer who has already been made whole. A failed balance
 * outranks a deposit for the same reason in reverse: both describe an order
 * with part of its money taken, and only one of them needs somebody today.
 *
 * Four of the five are the prototype's own strings, lines 2723–2728. The fifth
 * is the case its six fixed rows never contain — a booking whose deposit has
 * not landed yet.
 */
export function paymentLabel(position: PaymentPosition): PaymentLabel {
  const { total, captured, returned, balanceFailed, currency } = position;

  if (returned > 0n) {
    // Partial refunds exist: an administrator recording a dashboard refund
    // names the amount. Saying only "Refunded" for one would describe an order
    // as settled while it still holds most of the customer's money, so a
    // partial says how much went back and a full one keeps the prototype's
    // word for it.
    const full = returned >= captured;
    return {
      kind: "refunded",
      label: full ? "Refunded" : `Refunded ${formatMoney(returned, currency)}`,
    };
  }

  if (balanceFailed) {
    return { kind: "balance_failed", label: "Balance failed" };
  }

  if (captured >= total) {
    // `>=` rather than `===`: an order whose total was later reduced would
    // otherwise read as part-paid for ever, with nothing left to charge.
    return { kind: "paid_in_full", label: "Paid in full" };
  }

  if (captured > 0n) {
    return { kind: "deposit", label: `Deposit ${formatMoney(captured, currency)}` };
  }

  return { kind: "unpaid", label: "Awaiting payment" };
}
