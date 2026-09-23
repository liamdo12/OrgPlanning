import Stripe from "stripe";
import type {
  PaymentIntentStatus,
  ProviderAccount,
  ProviderEvent,
  ProviderPaymentIntent,
  ProviderRefund,
  ProviderTransfer,
  StripePort,
} from "@occasion/core";

/**
 * Stripe adapter.
 *
 * The SDK lives here and nowhere else: `packages/core` talks to `StripePort`,
 * so the domain can be exercised against a fake without a network, and a
 * provider change is a rewrite of this file rather than of the payments domain.
 *
 * Three rules this file keeps on the domain's behalf:
 *
 * **Idempotency keys are arguments.** Every call that creates money takes the
 * key the service derived from a persisted attempt row. Nothing here invents
 * one — a key this file made up would be a new key on every retry, which is the
 * same as having none.
 *
 * **Amounts cross as integers.** Cents are `bigint` in the domain and `number`
 * at the SDK boundary, and the conversion is checked rather than assumed.
 *
 * **Nothing is fabricated.** A call that fails throws; a lookup that finds
 * nothing returns null. There is no plausible-looking fallback anywhere in
 * here, because a payments adapter that invents an answer invents money.
 */

/**
 * Pinned to the version this SDK was written against.
 *
 * Stated rather than defaulted: the account's own dashboard version would then
 * decide what these calls return, and upgrading it in a browser would change
 * what this code receives without anybody editing this repository.
 */
const API_VERSION = "2026-08-26.dahlia";

/**
 * @param secretKey  test-mode only; the environment schema refuses anything else
 * @param webhookSecret  the signing secret `parseWebhook` verifies against
 */
export function createStripe(secretKey: string, webhookSecret: string): StripePort {
  const mode = secretKey.startsWith("sk_live_") ? "live" : "test";
  const stripe = new Stripe(secretKey, {
    apiVersion: API_VERSION,
    // The domain decides when to give up; see the retry ceiling in
    // `payments/stripe.ts`. The SDK retrying underneath it would multiply the
    // two ceilings together without either knowing.
    maxNetworkRetries: 0,
  });

  return {
    mode: () => mode,

    async ensureCustomer({ idempotencyKey, email, name, metadata }) {
      const customer = await stripe.customers.create({ email, name, metadata }, { idempotencyKey });
      return { id: customer.id };
    },

    async createPaymentIntent({
      idempotencyKey,
      amount,
      currency,
      customerId,
      transferGroup,
      metadata,
    }) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: toProviderAmount(amount),
          currency: currency.toLowerCase(),
          customer: customerId,
          // What makes the balance charge possible at all: the card is kept
          // for a charge the customer will not be present for.
          setup_future_usage: "off_session",
          transfer_group: transferGroup,
          automatic_payment_methods: { enabled: true },
          metadata,
        },
        { idempotencyKey },
      );

      return toPaymentIntent(intent);
    },

    async chargeOffSession({
      idempotencyKey,
      amount,
      currency,
      customerId,
      paymentMethodId,
      transferGroup,
      metadata,
    }) {
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: toProviderAmount(amount),
            currency: currency.toLowerCase(),
            customer: customerId,
            payment_method: paymentMethodId,
            off_session: true,
            confirm: true,
            transfer_group: transferGroup,
            metadata,
          },
          { idempotencyKey },
        );

        return toPaymentIntent(intent);
      } catch (error) {
        // A declined off-session charge is an ordinary answer here, not an
        // exception: it is what `action_required` and the emailed payment link
        // exist for. The SDK raises it, so it is turned back into the intent
        // the caller asked about. Anything without an intent attached really is
        // a failure and is rethrown.
        const intent = declinedIntent(error);
        if (!intent) throw error;
        return toPaymentIntent(intent);
      }
    },

    async createCheckoutSession({
      idempotencyKey,
      amount,
      currency,
      customerId,
      description,
      transferGroup,
      successUrl,
      cancelUrl,
      metadata,
    }) {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          customer: customerId,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: currency.toLowerCase(),
                unit_amount: toProviderAmount(amount),
                product_data: { name: description },
              },
            },
          ],
          // On the intent as well as the session: `payment_intent.succeeded` is
          // the event this platform acts on, and it carries the intent's
          // metadata, not the session's.
          payment_intent_data: { transfer_group: transferGroup, metadata },
          metadata,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
        { idempotencyKey },
      );

      if (!session.url) {
        throw new Error(`Stripe returned checkout session ${session.id} with no URL.`);
      }

      const intent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);

      return { id: session.id, url: session.url, paymentIntentId: intent };
    },

    async findPaymentIntentByMetadata({ orderId, paymentId }) {
      // Search rather than list: nothing else queries metadata. Its index is
      // eventually consistent — up to a minute behind — which is why the
      // service that calls this waits out the provider's own idempotency
      // window first rather than treating a miss as proof of absence.
      const found = await stripe.paymentIntents.search({
        query: `metadata['payment_id']:'${escapeQuery(paymentId)}' AND metadata['order_id']:'${escapeQuery(orderId)}'`,
        limit: 1,
      });

      const intent = found.data[0];
      return intent ? toPaymentIntent(intent) : null;
    },

    async retrievePaymentIntent(id) {
      // Expanded, because `payment_method` comes back as a bare id otherwise
      // and the card's last four digits live on the object. Without this,
      // `cardLast4` is null on every real retrieve — silently, since the
      // in-memory fake carries the whole object and cannot reproduce it.
      const intent = await stripe.paymentIntents
        .retrieve(id, { expand: ["payment_method"] })
        .catch(missingToNull);
      return intent ? toPaymentIntent(intent) : null;
    },

    async cancelPaymentIntent(id) {
      try {
        const intent = await stripe.paymentIntents.cancel(id);
        return { outcome: "canceled", intent: toPaymentIntent(intent) };
      } catch (error) {
        if (error instanceof Stripe.errors.StripeError) {
          if (error.code === "resource_missing") return { outcome: "missing" };

          // The one error that is an answer rather than a fault: Stripe raises
          // this when the intent is already `processing` or `succeeded`, which
          // is the race an expiry falling due mid-checkout lands in. The status
          // is read back from the intent Stripe attaches to the error rather
          // than parsed out of its message.
          if (error.code === "payment_intent_unexpected_state") {
            const status = error.payment_intent?.status;
            return {
              outcome: "refused",
              status: status ? (status as PaymentIntentStatus) : null,
              reason: error.message,
            };
          }
        }
        throw error;
      }
    },

    async createTransfer({
      idempotencyKey,
      amount,
      currency,
      destinationAccountId,
      sourceTransaction,
      transferGroup,
      metadata,
    }) {
      const transfer = await stripe.transfers.create(
        {
          amount: toProviderAmount(amount),
          currency: currency.toLowerCase(),
          destination: destinationAccountId,
          // The charge the money comes from. Without it the transfer draws on
          // the platform's own balance — which succeeds in test mode and, in
          // live mode, is the platform paying vendors out of its float.
          source_transaction: sourceTransaction,
          transfer_group: transferGroup,
          metadata,
        },
        { idempotencyKey },
      );

      return toTransfer(transfer);
    },

    async findTransferByMetadata({ orderId, transferId }) {
      // Listed by transfer group rather than searched, so this one does not
      // depend on the search index having caught up.
      const listed = await stripe.transfers.list({ transfer_group: orderId, limit: 100 });
      const transfer = listed.data.find((row) => row.metadata?.["transfer_id"] === transferId);
      return transfer ? toTransfer(transfer) : null;
    },

    async createRefund({ idempotencyKey, paymentIntentId, amount, metadata }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId, amount: toProviderAmount(amount), metadata },
        { idempotencyKey },
      );

      return toRefund(refund);
    },

    async findRefundByMetadata({ paymentIntentId, refundId }) {
      // Listed against the intent rather than searched: refunds have no
      // metadata search, and a list has no index to be behind.
      const listed = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
      const refund = listed.data.find((row) => row.metadata?.["refund_id"] === refundId);
      return refund ? toRefund(refund) : null;
    },

    async retrieveRefund(id) {
      const refund = await stripe.refunds.retrieve(id).catch(missingToNull);
      return refund ? toRefund(refund) : null;
    },

    async createConnectedAccount({ idempotencyKey, email, businessName, metadata }) {
      const account = await stripe.accounts.create(
        {
          type: "express",
          country: "CA",
          ...(email ? { email } : {}),
          default_currency: "cad",
          business_profile: { name: businessName },
          metadata,
        },
        { idempotencyKey },
      );

      return toAccount(account);
    },

    async createAccountLink({ accountId, refreshUrl, returnUrl }) {
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: "account_onboarding",
      });

      return { url: link.url, expiresAt: new Date(link.expires_at * 1000) };
    },

    async retrieveAccount(id) {
      const account = await stripe.accounts.retrieve(id).catch(missingToNull);
      return account ? toAccount(account) : null;
    },

    parseWebhook(rawBody, signature) {
      // Verification needs the exact bytes that were signed, which is why the
      // route hands over the raw body rather than a parsed object.
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      const object = event.data.object as unknown as Record<string, unknown>;

      return {
        id: event.id,
        type: event.type,
        account: event.account ?? null,
        payload: event,
        object,
      } satisfies ProviderEvent;
    },
  };
}

/** Cents as an integer the SDK will accept, or a throw that says why not. */
function toProviderAmount(amount: bigint): number {
  if (amount <= 0n) {
    throw new Error(`Stripe will not move ${amount} cents; an amount must be positive.`);
  }
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${amount} cents is past the integer range the Stripe SDK takes.`);
  }
  return Number(amount);
}

function toPaymentIntent(intent: Stripe.PaymentIntent): ProviderPaymentIntent {
  const charge =
    typeof intent.latest_charge === "string"
      ? intent.latest_charge
      : (intent.latest_charge?.id ?? null);
  const paymentMethod =
    typeof intent.payment_method === "string"
      ? intent.payment_method
      : (intent.payment_method?.id ?? null);

  return {
    id: intent.id,
    status: intent.status as PaymentIntentStatus,
    amount: BigInt(intent.amount),
    currency: intent.currency.toUpperCase(),
    chargeId: charge,
    clientSecret: intent.client_secret ?? null,
    paymentMethodId: paymentMethod,
    cardLast4:
      (typeof intent.payment_method === "string"
        ? null
        : (intent.payment_method?.card?.last4 ?? null)) ??
      intent.last_payment_error?.payment_method?.card?.last4 ??
      null,
    failureCode: intent.last_payment_error?.code ?? null,
    failureMessage: intent.last_payment_error?.message ?? null,
  };
}

function toTransfer(transfer: Stripe.Transfer): ProviderTransfer {
  const destination =
    typeof transfer.destination === "string"
      ? transfer.destination
      : (transfer.destination?.id ?? "");

  return { id: transfer.id, amount: BigInt(transfer.amount), destination };
}

function toRefund(refund: Stripe.Refund): ProviderRefund {
  return { id: refund.id, amount: BigInt(refund.amount), status: refund.status ?? "pending" };
}

function toAccount(account: Stripe.Account): ProviderAccount {
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    requirementsDue: [
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ],
  };
}

/** The intent carried by a declined off-session charge, if this error has one. */
function declinedIntent(error: unknown): Stripe.PaymentIntent | null {
  if (!(error instanceof Stripe.errors.StripeError)) return null;
  const intent = (error as Stripe.errors.StripeCardError).payment_intent;
  return intent ?? null;
}

/**
 * Turns "no such object" into null and lets everything else through.
 *
 * The distinction matters: a missing object is an answer, and a network failure
 * is not. Collapsing the two would let a timeout read as "it was never
 * created", which is how a retry creates a second charge.
 */
function missingToNull(error: unknown): null {
  if (error instanceof Stripe.errors.StripeError && error.code === "resource_missing") return null;
  throw error;
}

/** Stripe's search grammar quotes with `'`, so an embedded quote must not pass. */
function escapeQuery(value: string): string {
  return value.replace(/['\\]/g, "");
}
