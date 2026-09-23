import type {
  ProviderAccount,
  ProviderEvent,
  ProviderPaymentIntent,
  ProviderRefund,
  ProviderTransfer,
  StripePort,
} from "../ports.js";

/**
 * A payment provider that behaves like one, in memory.
 *
 * Not a stub that returns success: the properties this domain has to get right
 * are all about what happens when the provider misbehaves, so this fake can be
 * told to decline, to time out, and to remember — or forget — an idempotency
 * key. A test against a port that always succeeds proves only that the happy
 * path compiles.
 *
 * What it reproduces on purpose:
 *
 * - **Idempotency keys deduplicate, for a while.** The same key returns the
 *   same object. `expireIdempotencyKeys()` forgets them, which is what the
 *   provider does after about a day and is the exact condition under which a
 *   per-order key double-charges.
 * - **Metadata is searchable.** The lookups the service falls back to once a
 *   key has expired work here, so the fallback can be tested rather than
 *   assumed.
 * - **A timeout is not a failure to create.** `failNextWith` raises after the
 *   object has been recorded, which is the case that makes a naive retry charge
 *   twice.
 *
 * Reachable at `@occasion/core/testing` only. Nothing in `apps/web` may import
 * it: a fake provider in a request handler is a booking nobody paid for.
 */

export type StripeFake = StripePort & {
  /** Every object this fake has created, in order. */
  readonly created: Array<{ kind: string; id: string; idempotencyKey: string | null }>;
  /** Makes the next call of `method` throw after it has recorded its object. */
  failNextWith(method: string, error: Error): void;
  /** Makes the next off-session charge decline with this code. */
  declineNextCharge(code?: string, message?: string): void;
  /** Makes the next off-session charge ask for a challenge instead of settling. */
  requireActionNextCharge(): void;
  /** Forgets every key, as the provider does once its window lapses. */
  expireIdempotencyKeys(): void;
  /** Builds a signed-looking webhook this fake will accept. */
  webhook(type: string, object: Record<string, unknown>, account?: string | null): string;
  /** Marks a connected account ready, as finishing the provider's onboarding does. */
  completeOnboarding(accountId: string): void;
  /** Settles a hosted checkout, as the customer finishing on the provider's page does. */
  settleCheckoutSession(paymentIntentId: string): void;
  /**
   * Settles an intent, as a customer completing the card form does.
   *
   * The same thing `settleCheckoutSession` does — the difference between the
   * two is where the customer was, not what happens to the intent — so one
   * implementation under two honest names, rather than a test reaching for the
   * hosted-checkout verb to describe an Elements payment.
   */
  settlePaymentIntent(paymentIntentId: string): void;
};

type Recorded = { kind: string; id: string; idempotencyKey: string | null };

export function createStripeFake(options: { mode?: "test" | "live" } = {}): StripeFake {
  const created: Recorded[] = [];
  const byKey = new Map<string, unknown>();
  const intents = new Map<string, ProviderPaymentIntent & { metadata: Record<string, string> }>();
  const transfers = new Map<string, ProviderTransfer & { metadata: Record<string, string> }>();
  const refunds = new Map<string, ProviderRefund & { metadata: Record<string, string> }>();
  const accounts = new Map<string, ProviderAccount>();

  const pendingFailures = new Map<string, Error>();
  let nextDecline: { code: string; message: string } | null = null;
  let nextRequiresAction = false;
  let counter = 0;

  const nextId = (prefix: string) => `${prefix}_${(counter += 1).toString().padStart(6, "0")}`;

  /** Throws if this method was armed to fail — after the object was recorded. */
  function maybeFail(method: string): void {
    const error = pendingFailures.get(method);
    if (!error) return;
    pendingFailures.delete(method);
    throw error;
  }

  /** Returns what this key produced before, if the fake still remembers it. */
  function replay<T>(key: string): T | undefined {
    return byKey.get(key) as T | undefined;
  }

  /** An intent the customer has finished paying, wherever they did it. */
  function settle(paymentIntentId: string): void {
    const intent = intents.get(paymentIntentId);
    if (!intent) throw new Error(`This fake has no intent ${paymentIntentId}.`);

    intents.set(paymentIntentId, {
      ...intent,
      status: "succeeded",
      chargeId: nextId("ch"),
      paymentMethodId: nextId("pm"),
      // A settled intent has a card attached, and the provider reports its last
      // four digits. The fake's one card, so a test can assert the value rather
      // than merely that something is there.
      cardLast4: "4242",
    });
  }

  return {
    created,

    failNextWith(method, error) {
      pendingFailures.set(method, error);
    },

    declineNextCharge(code = "card_declined", message = "Your card was declined.") {
      nextDecline = { code, message };
    },

    requireActionNextCharge() {
      nextRequiresAction = true;
    },

    expireIdempotencyKeys() {
      byKey.clear();
    },

    webhook(type, object, account = null) {
      return JSON.stringify({ id: nextId("evt"), type, account, data: { object } });
    },

    completeOnboarding(accountId) {
      const account = accounts.get(accountId);
      if (!account) throw new Error(`This fake has no account ${accountId}.`);
      accounts.set(accountId, {
        ...account,
        chargesEnabled: true,
        payoutsEnabled: true,
        requirementsDue: [],
      });
    },

    mode: () => options.mode ?? "test",

    ensureCustomer({ idempotencyKey, email }) {
      const existing = replay<{ id: string }>(idempotencyKey);
      if (existing) return Promise.resolve(existing);

      const customer = { id: nextId("cus") };
      byKey.set(idempotencyKey, customer);
      created.push({ kind: "customer", id: customer.id, idempotencyKey });
      void email;
      maybeFail("ensureCustomer");
      return Promise.resolve(customer);
    },

    createPaymentIntent({ idempotencyKey, amount, currency, metadata }) {
      const existing = replay<ProviderPaymentIntent>(idempotencyKey);
      if (existing) return Promise.resolve(existing);

      const id = nextId("pi");
      // `requires_confirmation`, because that is what the provider returns for
      // an intent created server-side and not confirmed. Returning `succeeded`
      // here is the single most misleading thing a payments fake can do: it
      // makes every "and then it settled" assertion pass over a state
      // production cannot reach, and it is why a page that could never take a
      // payment had a green test suite.
      const intent = {
        id,
        status: "requires_confirmation" as const,
        amount,
        currency,
        chargeId: null,
        clientSecret: `${id}_secret`,
        paymentMethodId: null,
        cardLast4: null,
        failureCode: null,
        failureMessage: null,
        metadata,
      };

      intents.set(id, intent);
      byKey.set(idempotencyKey, intent);
      created.push({ kind: "payment_intent", id, idempotencyKey });
      maybeFail("createPaymentIntent");
      return Promise.resolve(intent);
    },

    chargeOffSession({ idempotencyKey, amount, currency, paymentMethodId, metadata }) {
      const existing = replay<ProviderPaymentIntent>(idempotencyKey);
      if (existing) return Promise.resolve(existing);

      const decline = nextDecline;
      const requiresAction = nextRequiresAction;
      nextDecline = null;
      nextRequiresAction = false;

      const id = nextId("pi");
      const intent = {
        id,
        status: decline
          ? ("requires_payment_method" as const)
          : requiresAction
            ? ("requires_action" as const)
            : ("succeeded" as const),
        amount,
        currency,
        chargeId: decline || requiresAction ? null : nextId("ch"),
        clientSecret: `${id}_secret`,
        paymentMethodId,
        // The fake's one card. A test asserting the failed-balance email needs
        // the digits to be something, and the same four every time is what lets
        // it assert them.
        cardLast4: "4242",
        failureCode: decline?.code ?? null,
        failureMessage: decline?.message ?? null,
        metadata,
      };

      intents.set(id, intent);
      byKey.set(idempotencyKey, intent);
      created.push({ kind: "payment_intent", id, idempotencyKey });
      maybeFail("chargeOffSession");
      return Promise.resolve(intent);
    },

    createCheckoutSession({ idempotencyKey, amount, currency, metadata }) {
      const existing = replay<{ id: string; url: string; paymentIntentId: string | null }>(
        idempotencyKey,
      );
      if (existing) return Promise.resolve(existing);

      // A session creates its intent immediately, and the intent is what the
      // webhook carries. It is unsettled until the customer finishes on the
      // provider's page — which in a test is `settleCheckoutSession`.
      const intentId = nextId("pi");
      intents.set(intentId, {
        id: intentId,
        status: "requires_payment_method",
        amount,
        currency,
        chargeId: null,
        clientSecret: `${intentId}_secret`,
        paymentMethodId: null,
        cardLast4: null,
        failureCode: null,
        failureMessage: null,
        metadata,
      });

      const session = {
        id: nextId("cs"),
        url: `https://checkout.stripe.test/c/${intentId}`,
        paymentIntentId: intentId,
      };

      byKey.set(idempotencyKey, session);
      created.push({ kind: "checkout_session", id: session.id, idempotencyKey });
      maybeFail("createCheckoutSession");
      return Promise.resolve(session);
    },

    settlePaymentIntent: settle,

    // The customer was on the provider's own page rather than in the card form
    // on ours, which changes nothing about what happens to the intent.
    // Delegated rather than repeated, and a plain function rather than `this.…`
    // so a destructured handle still works.
    settleCheckoutSession: settle,

    findPaymentIntentByMetadata({ orderId, paymentId }) {
      for (const intent of intents.values()) {
        if (
          intent.metadata["order_id"] === orderId &&
          intent.metadata["payment_id"] === paymentId
        ) {
          return Promise.resolve(intent);
        }
      }
      return Promise.resolve(null);
    },

    retrievePaymentIntent(id) {
      return Promise.resolve(intents.get(id) ?? null);
    },

    cancelPaymentIntent(id) {
      const intent = intents.get(id);
      if (!intent) return Promise.resolve({ outcome: "missing" as const });

      // The provider's own rule, and the reason this method returns a refusal
      // rather than a success flag: money that is moving cannot be called back
      // by cancelling the intent it is moving under.
      if (intent.status === "succeeded" || intent.status === "processing") {
        maybeFail("cancelPaymentIntent");
        return Promise.resolve({
          outcome: "refused" as const,
          status: intent.status,
          reason: `You cannot cancel this PaymentIntent because it has a status of ${intent.status}.`,
        });
      }

      const canceled = { ...intent, status: "canceled" as const };
      intents.set(id, canceled);
      created.push({ kind: "payment_intent_cancel", id, idempotencyKey: null });
      // After the object has been recorded, as everywhere else here: a call
      // that failed on the way back still cancelled the intent, and a retry
      // that assumed otherwise would be acting on a stale answer.
      maybeFail("cancelPaymentIntent");
      return Promise.resolve({ outcome: "canceled" as const, intent: canceled });
    },

    createTransfer({ idempotencyKey, amount, destinationAccountId, metadata }) {
      const existing = replay<ProviderTransfer>(idempotencyKey);
      if (existing) return Promise.resolve(existing);

      const id = nextId("tr");
      const transfer = { id, amount, destination: destinationAccountId, metadata };

      transfers.set(id, transfer);
      byKey.set(idempotencyKey, transfer);
      created.push({ kind: "transfer", id, idempotencyKey });
      maybeFail("createTransfer");
      return Promise.resolve(transfer);
    },

    findTransferByMetadata({ orderId, transferId }) {
      for (const transfer of transfers.values()) {
        if (
          transfer.metadata["order_id"] === orderId &&
          transfer.metadata["transfer_id"] === transferId
        ) {
          return Promise.resolve(transfer);
        }
      }
      return Promise.resolve(null);
    },

    createRefund({ idempotencyKey, amount, metadata }) {
      const existing = replay<ProviderRefund>(idempotencyKey);
      if (existing) return Promise.resolve(existing);

      const id = nextId("re");
      const refund = { id, amount, status: "succeeded", metadata };

      refunds.set(id, refund);
      byKey.set(idempotencyKey, refund);
      created.push({ kind: "refund", id, idempotencyKey });
      maybeFail("createRefund");
      return Promise.resolve(refund);
    },

    findRefundByMetadata({ paymentIntentId, refundId }) {
      for (const refund of refunds.values()) {
        if (
          refund.metadata["payment_intent_id"] === paymentIntentId &&
          refund.metadata["refund_id"] === refundId
        ) {
          return Promise.resolve(refund);
        }
      }
      return Promise.resolve(null);
    },

    retrieveRefund(id) {
      return Promise.resolve(refunds.get(id) ?? null);
    },

    createConnectedAccount({ idempotencyKey }) {
      const existing = replay<ProviderAccount>(idempotencyKey);
      if (existing) return Promise.resolve(existing);

      const account: ProviderAccount = {
        id: nextId("acct"),
        chargesEnabled: false,
        payoutsEnabled: false,
        requirementsDue: ["business_profile.url", "external_account"],
      };

      accounts.set(account.id, account);
      byKey.set(idempotencyKey, account);
      created.push({ kind: "account", id: account.id, idempotencyKey });
      maybeFail("createConnectedAccount");
      return Promise.resolve(account);
    },

    createAccountLink({ accountId }) {
      return Promise.resolve({
        url: `https://connect.stripe.test/setup/${accountId}`,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
    },

    retrieveAccount(id) {
      return Promise.resolve(accounts.get(id) ?? null);
    },

    parseWebhook(rawBody, signature) {
      if (signature !== "test-signature") {
        throw new Error("Webhook signature verification failed.");
      }

      const event = JSON.parse(rawBody) as {
        id: string;
        type: string;
        account?: string | null;
        data: { object: Record<string, unknown> };
      };

      return {
        id: event.id,
        type: event.type,
        account: event.account ?? null,
        payload: event,
        object: event.data.object,
      } satisfies ProviderEvent;
    },
  };
}
