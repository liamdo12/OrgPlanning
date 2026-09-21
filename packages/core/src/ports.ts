/**
 * Adapter contracts for everything outside the domain.
 *
 * Each port is deliberately thin: it exists so `CoreContext` is a real,
 * constructible type and so a service can be exercised against a fake. Widen a
 * port when a capability actually needs it. The rule that survives is that this
 * package only ever talks to these interfaces, never to a vendor SDK, a
 * framework module, or the environment.
 */

/** Identity as the auth provider sees it. Roles are NOT here — see below. */
export type AuthUser = {
  id: string;
  email: string;
  /**
   * When the token was issued.
   *
   * Compared against the account's revocation cutoff on every request, which
   * is what makes suspending an account or revoking a role take effect now
   * rather than whenever the token would have expired.
   */
  issuedAt: Date | null;
  /**
   * Whether the provider has proven control of the address.
   *
   * Load-bearing: binding a provider subject to an existing account matches on
   * email, so an unproven address would let anyone claim a seeded account by
   * registering with its address.
   */
  emailVerified: boolean;
  /**
   * Whether this session has cleared a second factor.
   *
   * Whether one is *required* is not asked of the provider: its session object
   * lists the factors a person enrolled, and that object reaches the server in
   * a cookie the browser controls. The requirement is read from our own row, so
   * a stolen password plus an edited cookie cannot answer it away.
   */
  secondFactorVerified: boolean;
};

/**
 * Authentication adapter.
 *
 * Deliberately identity-only. Roles live in `user_roles` and are re-read from
 * the database on every request, because a token claim cannot be revoked: a
 * cached role would keep working after an admin removed it.
 */
export type AuthPort = {
  /** The signed-in user for the current request, or null when anonymous. */
  getCurrentUser(): Promise<AuthUser | null>;
};

/**
 * Time adapter.
 *
 * Nothing in the domain may call `Date.now()` or `new Date()` directly. Both
 * methods answer the real wall clock, and the distinction between them is about
 * intent rather than value: `realNow` is for a timestamp that must never be
 * moved, such as a revocation cutoff compared against a token the auth provider
 * stamped.
 *
 * **The admin clock override is deliberately not here.** It was, once, as a
 * third method — and a port that can shift `now()` shifts it for every caller
 * of every service in the request, which is the opposite of what the override
 * is for. It is a stored row instead, read by name where a listing wants a
 * hypothetical moment, and passed explicitly as `asOf` where a runner wants
 * one. A shifted clock that nothing implicitly reads cannot leak.
 */
export type ClockPort = {
  /** Current time. */
  now(): Date;
  /** The real wall clock. For audit timestamps and revocation cutoffs. */
  realNow(): Date;
};

/** What a charge attempt came back as. */
export type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "succeeded"
  | "canceled";

/** A charge at the provider, as much of it as the domain has any business seeing. */
export type ProviderPaymentIntent = {
  id: string;
  status: PaymentIntentStatus;
  amount: bigint;
  currency: string;
  /** The settled charge, once there is one. Needed to source a transfer. */
  chargeId: string | null;
  /** Present while the customer still has to do something — 3DS, mostly. */
  clientSecret: string | null;
  /** The saved card this intent may be charged against again. */
  paymentMethodId: string | null;
  /**
   * The last four digits of the card, when the provider reports them.
   *
   * The one detail about a payment instrument this domain keeps, and it is here
   * because a customer whose balance failed has to be told which card to fix.
   * Null is an ordinary answer — a declined off-session charge does not always
   * come back with a card attached — and the message says "your card" then.
   */
  cardLast4: string | null;
  /** Why it failed, in the provider's words. Never shown raw to a customer. */
  failureCode: string | null;
  failureMessage: string | null;
};

export type ProviderTransfer = {
  id: string;
  amount: bigint;
  /** The connected account the money went to. */
  destination: string;
};

export type ProviderRefund = {
  id: string;
  amount: bigint;
  /** `pending`, `succeeded`, `failed` or `canceled` at the provider. */
  status: string;
};

/** A vendor's connected account, as the provider currently sees it. */
export type ProviderAccount = {
  id: string;
  /** Whether the account may take money. */
  chargesEnabled: boolean;
  /** Whether the platform may pay money out to it. */
  payoutsEnabled: boolean;
  /** What onboarding is still waiting for, if anything. */
  requirementsDue: string[];
};

/** A verified webhook, with its envelope separated from its payload. */
export type ProviderEvent = {
  id: string;
  type: string;
  /** The connected account it belongs to, when it is not the platform's. */
  account: string | null;
  /** The whole event, kept so an early arrival can be replayed later. */
  payload: unknown;
  /** The object the event is about, already unwrapped. */
  object: Record<string, unknown>;
};

/**
 * Payments adapter.
 *
 * Idempotency keys are derived from persisted attempt rows by the calling
 * service rather than from order ids, so every method that creates money takes
 * a key as an argument rather than inventing one: a per-order key
 * double-charges once the provider's key window expires, and collides on a
 * second partial refund.
 *
 * The `find…ByMetadata` pair is the other half of that rule. A key only
 * deduplicates for as long as the provider remembers it — about a day — so a
 * retry beyond that window must ask what already exists instead of trusting the
 * key to refuse a duplicate. Every object this port creates therefore carries
 * `metadata.order_id` and `metadata.payment_id`, and those are what the lookups
 * search on.
 */
export type StripePort = {
  /** Provider identity, so admin screens can label which mode produced a row. */
  mode(): "test" | "live";

  /**
   * The provider's record of a person, which a saved card hangs off.
   *
   * Needed before the deposit rather than at the balance, because a card can
   * only be re-used off-session if it was saved against a customer at the time
   * it was first charged.
   */
  ensureCustomer(input: {
    idempotencyKey: string;
    email: string;
    name: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string }>;

  /**
   * Charges a card the customer is present for, and saves it for the balance.
   *
   * `transferGroup` ties every payment and transfer for one checkout together,
   * so the provider's own dashboard can show a multi-vendor booking as one
   * thing even though each order is charged separately.
   */
  createPaymentIntent(input: {
    idempotencyKey: string;
    amount: bigint;
    currency: string;
    customerId: string;
    transferGroup: string;
    metadata: Record<string, string>;
  }): Promise<ProviderPaymentIntent>;

  /**
   * Charges a saved card with nobody watching.
   *
   * The balance, charged ahead of the event rather than taken at checkout. It
   * fails more often than an on-session charge does — that is what
   * `action_required` and the emailed payment link exist for — so a decline
   * here is an ordinary answer rather than an exception.
   */
  chargeOffSession(input: {
    idempotencyKey: string;
    amount: bigint;
    currency: string;
    customerId: string;
    paymentMethodId: string;
    transferGroup: string;
    metadata: Record<string, string>;
  }): Promise<ProviderPaymentIntent>;

  /**
   * A provider-hosted page that takes one payment.
   *
   * What the emailed payment link leads to. The alternative — creating an
   * intent here and confirming it in the browser — needs the provider's own
   * client library and a card form on a page this milestone does not have; an
   * intent created and never confirmed takes no money at all, however
   * successful the call that made it looks.
   *
   * The metadata is put on the **intent**, not only on the session, because the
   * intent is what the webhook that matters carries.
   */
  createCheckoutSession(input: {
    idempotencyKey: string;
    amount: bigint;
    currency: string;
    customerId: string;
    /** What the customer sees they are paying for. */
    description: string;
    transferGroup: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; url: string; paymentIntentId: string | null }>;

  /** Whatever this attempt row already created at the provider, if anything. */
  findPaymentIntentByMetadata(query: {
    orderId: string;
    paymentId: string;
  }): Promise<ProviderPaymentIntent | null>;

  retrievePaymentIntent(id: string): Promise<ProviderPaymentIntent | null>;

  /**
   * Moves a vendor's share to their connected account.
   *
   * `sourceTransaction` is the charge the money comes from: without it the
   * transfer draws on the platform's own balance, which in test mode succeeds
   * and in live mode is the platform paying vendors out of its float.
   */
  createTransfer(input: {
    idempotencyKey: string;
    amount: bigint;
    currency: string;
    destinationAccountId: string;
    sourceTransaction: string;
    transferGroup: string;
    metadata: Record<string, string>;
  }): Promise<ProviderTransfer>;

  findTransferByMetadata(query: {
    orderId: string;
    transferId: string;
  }): Promise<ProviderTransfer | null>;

  createRefund(input: {
    idempotencyKey: string;
    paymentIntentId: string;
    amount: bigint;
    metadata: Record<string, string>;
  }): Promise<ProviderRefund>;

  /**
   * Whatever this refund attempt already created, if anything.
   *
   * Keyed by the charge it refunds rather than by the order, because refunds
   * have no metadata search: they are listed against their payment intent,
   * which has no index lag to wait out.
   */
  findRefundByMetadata(query: {
    paymentIntentId: string;
    refundId: string;
  }): Promise<ProviderRefund | null>;

  retrieveRefund(id: string): Promise<ProviderRefund | null>;

  /**
   * Starts Connect Express onboarding for a vendor.
   *
   * `email` is optional because this platform frequently does not know one: the
   * provider collects the business's own address during onboarding, and an
   * address invented to satisfy a required field is one the provider's
   * notifications are undeliverable to.
   */
  createConnectedAccount(input: {
    idempotencyKey: string;
    email?: string | undefined;
    businessName: string;
    metadata: Record<string, string>;
  }): Promise<ProviderAccount>;

  /** A one-time URL the vendor completes their onboarding at. */
  createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: Date }>;

  retrieveAccount(id: string): Promise<ProviderAccount | null>;

  /**
   * Verifies a webhook's signature and unwraps it.
   *
   * Takes the raw body, not a parsed object: the signature covers the exact
   * bytes, and anything that has been through `JSON.parse` and back cannot be
   * checked against it.
   */
  parseWebhook(rawBody: string, signature: string): ProviderEvent;
};

/** A message queued for delivery. */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /** Opaque idempotency key so a retried job cannot send twice. */
  idempotencyKey: string;
};

/**
 * Email adapter.
 *
 * Recipient consent and the merge-field allowlist are enforced in the service
 * layer above this port, not by the provider — a template that can interpolate
 * arbitrary fields will eventually interpolate a per-recipient secret into a
 * broadcast.
 */
export type EmailPort = {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
};
