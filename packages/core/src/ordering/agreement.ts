import { AgreementMismatchError, type AgreedFigures } from "../errors.js";

/**
 * What the customer said yes to, checked against what they are about to be
 * charged.
 *
 * The checkout re-reads the platform's rates inside its own transaction —
 * deliberately, so that every order in one cart is priced alike and an
 * administrator's new commission takes effect on the next booking. The cost is
 * that the figures the screen displayed are not necessarily the figures the
 * transaction computes, and recording the transaction's as "agreed" would be a
 * consent record for an amount nobody ever saw.
 *
 * So the screen sends what it showed, and this compares. Prices still come from
 * the catalogue: nothing here is *used* to charge, only to refuse.
 */

export type CheckoutExpectation = AgreedFigures;

/**
 * **Exactly four figures, and the cooling-window end is not one of them.**
 *
 * `buildPaymentPlan` computes that window as `now + coolingWindowHours`, so the
 * screen's copy and the transaction's differ by however long the customer spent
 * reading the policy. Comparing it would abort every checkout ever made. The
 * balance date is comparable because it is derived from the event —
 * `eventStart − balanceLeadDays` — and is the same value whenever it is
 * computed from the same rows.
 */
export function assertAgreement(expectation: CheckoutExpectation, actual: AgreedFigures): void {
  const agreed =
    expectation.total === actual.total &&
    expectation.depositAmount === actual.depositAmount &&
    expectation.balanceAmount === actual.balanceAmount &&
    sameInstant(expectation.balanceDueAt, actual.balanceDueAt);

  if (!agreed) throw new AgreementMismatchError(actual);
}

/** Two nullable instants, compared by value — a `Date` is never `===` another. */
function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}
