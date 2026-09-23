/**
 * The card form's own rules, away from the card form.
 *
 * Two of the three things this screen must get right are decisions rather than
 * markup: whether the button may be pressed, and what happens when the provider
 * declines. Both are here so they can be asserted without mounting a payment
 * SDK — and so that "keeps the box ticked" is a property of a function rather
 * than of a render nobody checks.
 */

export type PayFormState = {
  /** Whether the agreement is ticked. */
  consented: boolean;
  /** Whether a payment is in flight. */
  submitting: boolean;
  /** What went wrong last time, shown in place. */
  error: string | null;
};

export const IDLE: PayFormState = { consented: false, submitting: false, error: null };

/**
 * Whether Pay may be pressed.
 *
 * `ready` is the payment SDK having loaded: the button is live before the card
 * fields can accept anything otherwise, and pressing it then fails with
 * something no customer can act on.
 */
export function canPay(state: PayFormState, ready: boolean): boolean {
  return state.consented && ready && !state.submitting;
}

/**
 * What the screen does when a payment does not go through.
 *
 * **The consent survives.** The customer agreed to the terms and their card was
 * declined; clearing the tick would make them read and agree all over again for
 * a reason that has nothing to do with the terms. The order survives too — it
 * is still `pending_payment`, still holding the date, and the same screen
 * resumes it — so nothing here cancels or navigates.
 *
 * The provider's own sentence is used when there is one: "Your card was
 * declined" and "Your card has insufficient funds" are different problems with
 * different fixes, and flattening them to one message makes the screen useless
 * for the person who can act on it.
 */
export function onDeclined(state: PayFormState, providerMessage?: string | null): PayFormState {
  return {
    consented: state.consented,
    submitting: false,
    error:
      providerMessage && providerMessage.trim().length > 0
        ? providerMessage
        : "That payment did not go through. Nothing has been charged, and your booking is still held — try again, or use another card.",
  };
}
