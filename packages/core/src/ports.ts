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

/** An admin-initiated time shift. */
export type ClockOverride = {
  /** The instant the system should pretend it is. */
  effectiveAt: Date;
  /** Admin who set the override — recorded on every job run it touches. */
  actorUserId: string;
  /** When the override lapses. Overrides are never open-ended. */
  expiresAt: Date;
};

/**
 * Time adapter.
 *
 * Nothing in the domain may call `Date.now()` or `new Date()` directly: the
 * seeded demo states are computed from an anchor, and the admin override has to
 * be able to move them. `override` is exposed rather than hidden so the job
 * runner can enforce the rule that matters — under an override, only
 * demo-flagged rows may be touched.
 */
export type ClockPort = {
  /** Current time, shifted when an override is in effect. */
  now(): Date;
  /** The real wall clock, never shifted. For audit timestamps. */
  realNow(): Date;
  /** The active override, or null when running on the real clock. */
  override(): ClockOverride | null;
};

/**
 * Payments adapter.
 *
 * Idempotency keys are derived from persisted attempt rows by the calling
 * service rather than from order ids, so this port takes a key as an argument
 * rather than inventing one: a per-order key double-charges once the provider's
 * key window expires, and collides on a second partial refund.
 */
export type StripePort = {
  /** Provider identity, so admin screens can label which mode produced a row. */
  mode(): "test" | "live";
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
