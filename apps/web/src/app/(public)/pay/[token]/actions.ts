"use server";

import { redirect } from "next/navigation";
import { AppError, parsePaymentLinkToken, startLinkCheckout } from "@occasion/core";
import { createRequestContext } from "../../../../lib/core";
import { getEnv } from "../../../../lib/env";
import { readString } from "../../../../lib/form-values";

/**
 * Paying a balance through an emailed link.
 *
 * The one action in this milestone with no actor behind it. There is no
 * `requireAdminActor()` here and no session at all — the token is the
 * authority, and the domain is what checks it. What stops this being a way to
 * charge somebody arbitrarily is that the amount comes from the link's own row:
 * nothing on the wire names a figure.
 *
 * It ends in a redirect to Stripe's own payment page. Taking the card here
 * would mean a card form, the provider's client library and PCI scope this
 * milestone does not have; a hosted page is the honest way for one public route
 * to take one payment.
 */

export type PayState = {
  error?: string;
};

export async function payBalanceAction(_previous: PayState, form: FormData): Promise<PayState> {
  const raw = readString(form, "token");
  const origin = getEnv().APP_URL;

  let url: string;

  try {
    const checkout = await startLinkCheckout(createRequestContext(), parsePaymentLinkToken(raw), {
      successUrl: `${origin}/pay/${encodeURIComponent(raw)}/done`,
      cancelUrl: `${origin}/pay/${encodeURIComponent(raw)}`,
    });
    url = checkout.url;
  } catch (error) {
    // One answer for every refusal, for the same reason the page 404s: a
    // message that distinguishes "already paid" from "no such link" tells
    // somebody holding a guessed token that they guessed correctly.
    if (error instanceof AppError) {
      return { error: "This payment link is no longer valid." };
    }
    throw error;
  }

  // Outside the catch: `redirect` signals by throwing, and catching it here
  // would turn every successful payment into "this link is no longer valid".
  redirect(url);
}
