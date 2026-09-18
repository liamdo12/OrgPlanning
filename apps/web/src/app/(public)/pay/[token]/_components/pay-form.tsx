"use client";

import { useActionState } from "react";
import { Button } from "@occasion/ui";
import { payBalanceAction, type PayState } from "../actions";

/**
 * The button that starts the payment.
 *
 * It does not collect card details, and it does not claim to have taken money.
 * Pressing it hands the customer to Stripe's own payment page; the balance is
 * paid there, and the order is confirmed by the webhook that follows. Anything
 * this page said about the outcome would be a guess made before the answer
 * exists.
 */

const INITIAL: PayState = {};

export function PayForm({ token }: { token: string }) {
  const [state, submit, pending] = useActionState(payBalanceAction, INITIAL);

  return (
    <form action={submit} className="mt-6">
      <input type="hidden" name="token" value={token} />

      <Button type="submit" intent="primary" disabled={pending}>
        {pending ? "Opening…" : "Pay balance"}
      </Button>

      <p className="mt-3 text-xs text-white/50">
        You will finish on Stripe&rsquo;s secure payment page.
      </p>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-rose-200">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
