"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Toast } from "@occasion/ui";
import { stripeBrowser } from "../../../../lib/stripe-browser";
import { startCheckoutAction, type DisplayedTerms } from "../actions";
import { AgreementConsent } from "./agreement-consent";
import { OrderSummary } from "./order-summary";
import { IDLE, canPay, onDeclined, type PayFormState } from "./can-pay";

/**
 * The card fields, the agreement, the summary and Pay — lines 1146–1187.
 *
 * One `<form>` across both columns, because the agreement and the button it
 * enables sit in different halves of the canvas's layout and a button outside
 * its form submits nothing.
 *
 * **It confirms; it never asserts an outcome.** A successful `confirmPayment`
 * means the provider accepted the card, not that the booking is confirmed —
 * that is the webhook's sentence, and the screen this navigates to reads the
 * order's own state rather than anything carried from here.
 *
 * **The order is opened when Pay is pressed, not when the page renders.**
 * Elements' deferred-intent mode draws the fields from the amount alone, so a
 * customer who opens the screen and walks away has not taken a vendor's date
 * off the market for thirty minutes.
 *
 * **A decline leaves everything standing.** The order is still
 * `pending_payment`, still holding the date, and this same screen resumes it —
 * so the message is rendered in place, the agreement stays ticked, and the
 * button comes back.
 */

/** The summary's rows, formatted on the server by the one money formatter. */
export type SummaryRows = {
  subtotal: string;
  tax: string;
  taxLabel: string;
  depositLabel: string;
  balanceLabel: string | null;
  fullPaymentNote: string | null;
};

export function CheckoutPayment({
  publishableKey,
  eventId,
  vendorId,
  terms,
  currency,
  amountInCents,
  summary,
  children,
}: {
  publishableKey: string;
  eventId: string;
  vendorId: string;
  /** What this screen displayed, which is what it holds the charge to. */
  terms: DisplayedTerms;
  currency: string;
  /** What the deposit comes to, so the provider draws the right fields. */
  amountInCents: number;
  summary: SummaryRows;
  /** The vendor panel, rendered on the server. */
  children: ReactNode;
}) {
  // Loaded once and held: `loadStripe` injects a script tag, so calling it on
  // every render would add one per render.
  const [stripe] = useState(() => stripeBrowser(publishableKey));

  return (
    <Elements
      stripe={stripe}
      options={{
        mode: "payment",
        amount: amountInCents,
        currency: currency.toLowerCase(),
        // The card is kept for a charge the customer will not be present for,
        // which is what makes the balance charge possible fourteen days later.
        // Declared here as well as on the intent, so the form shows the mandate
        // text that authorises it.
        setupFutureUsage: "off_session",
      }}
    >
      <PayForm eventId={eventId} vendorId={vendorId} terms={terms} summary={summary}>
        {children}
      </PayForm>
    </Elements>
  );
}

function PayForm({
  eventId,
  vendorId,
  terms: shown,
  summary,
  children,
}: {
  eventId: string;
  vendorId: string;
  terms: DisplayedTerms;
  summary: SummaryRows;
  children: ReactNode;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  const [state, setState] = useState<PayFormState>(IDLE);
  // The terms on screen. The server replaces them when the price has moved
  // under the customer; they are held rather than re-fetched, because
  // re-quoting would be a third reading of the rates and could differ from
  // both of the first two.
  const [terms, setTerms] = useState<DisplayedTerms>(shown);
  const [openOrder, setOpenOrder] = useState<{ id: string; reference: string } | null>(null);

  const ready = stripe !== null && elements !== null;

  /**
   * The submit handler, which has to be synchronous.
   *
   * `onSubmit` is called for its effect and its return value is discarded, so
   * handing it a promise means nothing is watching for a rejection — which is
   * how an unhandled one ends up in the console instead of on the screen. The
   * work is in `pay`, and every path through it already reports what happened.
   */
  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void pay();
  }

  async function pay(): Promise<void> {
    if (!stripe || !elements || !canPay(state, ready)) return;

    setState((current) => ({ ...current, submitting: true, error: null }));
    setOpenOrder(null);

    // The provider's own check of the fields, before anything is opened on this
    // side: a card number that is obviously wrong should not cost a vendor's
    // date a thirty-minute hold.
    const validated = await elements.submit();
    if (validated.error) {
      setState((current) => onDeclined(current, validated.error?.message));
      return;
    }

    const started = await startCheckoutAction({
      eventId,
      vendorId,
      stated: {
        totalCents: terms.totalCents,
        depositCents: terms.depositCents,
        balanceCents: terms.balanceCents,
        balanceDueAt: terms.balanceDueAt,
      },
    });

    if (!started.ok) {
      if (started.terms) setTerms(started.terms);
      if (started.openOrder) setOpenOrder(started.openOrder);

      setState({
        // Changed terms are the one refusal that invalidates the consent: what
        // was agreed to is no longer what would be charged. Every other refusal
        // leaves the tick alone, because the terms did not move.
        consented: started.kind === "terms" ? false : state.consented,
        submitting: false,
        error: started.message,
      });
      return;
    }

    // The deposit had already been captured on an earlier attempt, so there is
    // nothing left to confirm.
    if (started.clientSecret === null) {
      router.push(`/orders/${started.orderId}/confirmed`);
      return;
    }

    const confirmed = await stripe.confirmPayment({
      elements,
      clientSecret: started.clientSecret,
      confirmParams: {
        // Where a payment method that leaves the page comes back to. The same
        // screen either way, and it reads the order rather than the result.
        return_url: `${window.location.origin}/orders/${started.orderId}/confirmed`,
      },
      redirect: "if_required",
    });

    if (confirmed.error) {
      setState((current) => onDeclined(current, confirmed.error?.message));
      return;
    }

    router.push(`/orders/${started.orderId}/confirmed`);
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      // Line 1145: two columns that become one when there is no room for two.
      className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-start gap-[24px]"
    >
      <div className="grid gap-[16px]">
        {children}

        <section
          className="oc-glass rounded-overlay border border-glass-edge-soft p-[20px]"
          aria-labelledby="payment-heading"
        >
          <h2 id="payment-heading" className="m-0 mb-[14px] text-subhead">
            Payment
          </h2>

          <PaymentElement options={{ layout: "tabs" }} />

          <AgreementConsent
            consented={state.consented}
            disabled={state.submitting}
            onChange={(next) => setState((current) => ({ ...current, consented: next }))}
            balanceAmount={terms.balance}
            balanceDate={terms.balanceDate}
            depositAmount={terms.deposit}
          />
        </section>
      </div>

      <OrderSummary
        subtotal={summary.subtotal}
        tax={summary.tax}
        total={terms.total}
        taxLabel={summary.taxLabel}
        depositLabel={summary.depositLabel}
        deposit={terms.deposit}
        balanceLabel={terms.balanceDate ? `Balance ${terms.balanceDate}` : summary.balanceLabel}
        balance={terms.balance}
        fullPaymentNote={summary.fullPaymentNote}
      >
        {state.error ? (
          <div className="mt-[14px]">
            <Toast tone="danger">
              <p className="m-0">{state.error}</p>
              {openOrder ? (
                <p className="mt-2 mb-0">
                  <a href={`/orders/${openOrder.id}`} className="font-semibold">
                    Open {openOrder.reference}
                  </a>
                </p>
              ) : null}
            </Toast>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!canPay(state, ready)}
          className="oc-button oc-button--primary oc-button--lg mt-[16px] w-full justify-center"
        >
          {state.submitting ? "Taking payment…" : `Pay deposit ${terms.deposit}`}
        </button>
      </OrderSummary>
    </form>
  );
}
