import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  orders,
  paymentLinks,
  payments,
  refunds,
  stripeEvents,
  transfers,
  users,
  vendors,
} from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";

/**
 * Database access for money.
 *
 * Every function takes an executor rather than the context: the attempt row
 * that becomes an idempotency key has to be committed in the same transaction
 * as the decision to charge, and a repository that could only reach the pool
 * could not be part of one.
 */

export type PaymentKind = "deposit" | "balance" | "full";
export type PaymentState = "pending" | "succeeded" | "failed" | "refunded";
export type TransferKind = "deposit_share" | "balance_share";
export type TransferState = "pending" | "paid" | "held" | "failed" | "reversed";

export type PaymentRow = {
  id: string;
  orderId: string;
  kind: PaymentKind;
  state: PaymentState;
  amount: bigint;
  currency: string;
  providerPaymentIntentId: string | null;
  providerChargeId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  /**
   * The last four digits of the card this attempt settled on, if known.
   *
   * Null while an attempt is open, and null when the provider did not report a
   * card — a declined off-session charge does not always come back with one
   * attached, and a message says "your card" then.
   */
  cardLast4: string | null;
  succeededAt: Date | null;
  /**
   * When the attempt row was written, which is how old its idempotency key is.
   *
   * Carried on the row rather than read from the clock at retry time: the
   * question the retry has to answer is whether the provider still remembers
   * the key, and that depends on when the key was minted, not on when somebody
   * is asking.
   */
  openedAt: Date;
};

const paymentColumns = {
  id: payments.id,
  orderId: payments.orderId,
  kind: payments.kind,
  state: payments.state,
  amount: payments.amount,
  currency: payments.currency,
  providerPaymentIntentId: payments.providerPaymentIntentId,
  providerChargeId: payments.providerChargeId,
  failureCode: payments.failureCode,
  failureMessage: payments.failureMessage,
  cardLast4: payments.cardLast4,
  succeededAt: payments.succeededAt,
  openedAt: payments.createdAt,
};

/**
 * Opens an attempt to take money.
 *
 * Written **before** the provider is called, and its id is the idempotency key
 * for that call. That ordering is the whole design: a key derived from the
 * order id instead would be reused by every attempt on that order, which
 * double-charges once the provider's key window lapses and collides the moment
 * an order needs a second one.
 */
export async function openPayment(
  db: DbExecutor,
  input: {
    orderId: string;
    kind: PaymentKind;
    amount: bigint;
    currency: string;
    offSession: boolean;
    now: Date;
  },
): Promise<PaymentRow> {
  const [row] = await db
    .insert(payments)
    .values({
      orderId: input.orderId,
      kind: input.kind,
      state: "pending",
      amount: input.amount,
      currency: input.currency,
      offSession: input.offSession ? input.now : null,
    })
    .returning(paymentColumns);

  return row as PaymentRow;
}

/** Records what the provider created, while the attempt is still in flight. */
export async function attachProviderIntent(
  db: DbExecutor,
  paymentId: string,
  intent: { id: string; chargeId: string | null },
): Promise<void> {
  await db
    .update(payments)
    .set({ providerPaymentIntentId: intent.id, providerChargeId: intent.chargeId })
    .where(eq(payments.id, paymentId));
}

export async function markPaymentSucceeded(
  db: DbExecutor,
  paymentId: string,
  input: { chargeId: string | null; now: Date },
): Promise<void> {
  await db
    .update(payments)
    .set({
      state: "succeeded",
      providerChargeId: input.chargeId,
      succeededAt: input.now,
      failureCode: null,
      failureMessage: null,
    })
    .where(eq(payments.id, paymentId));
}

export async function markPaymentFailed(
  db: DbExecutor,
  paymentId: string,
  input: { code: string | null; message: string | null; now: Date },
): Promise<void> {
  await db
    .update(payments)
    .set({
      state: "failed",
      failureCode: input.code,
      failureMessage: input.message,
      failedAt: input.now,
    })
    .where(eq(payments.id, paymentId));
}

export function loadPayment(db: DbExecutor, paymentId: string): Promise<PaymentRow | undefined> {
  return db
    .select(paymentColumns)
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1)
    .then((rows) => rows[0] as PaymentRow | undefined);
}

/** The most recent attempt of a kind, whatever became of it. */
export function latestPaymentOfKind(
  db: DbExecutor,
  orderId: string,
  kind: PaymentKind,
): Promise<PaymentRow | undefined> {
  return db
    .select(paymentColumns)
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.kind, kind)))
    .orderBy(desc(payments.createdAt))
    .limit(1)
    .then((rows) => rows[0] as PaymentRow | undefined);
}

/** Every attempt on an order, oldest first. */
export function listPayments(db: DbExecutor, orderId: string): Promise<PaymentRow[]> {
  return db
    .select(paymentColumns)
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(payments.createdAt);
}

/** The settled charge a refund or a transfer can draw on. */
export function succeededPaymentOfKind(
  db: DbExecutor,
  orderId: string,
  kind: PaymentKind,
): Promise<PaymentRow | undefined> {
  return db
    .select(paymentColumns)
    .from(payments)
    .where(
      and(eq(payments.orderId, orderId), eq(payments.kind, kind), eq(payments.state, "succeeded")),
    )
    .orderBy(desc(payments.succeededAt))
    .limit(1)
    .then((rows) => rows[0] as PaymentRow | undefined);
}

export type TransferRow = {
  id: string;
  orderId: string;
  vendorId: string;
  kind: TransferKind;
  state: TransferState;
  amount: bigint;
  currency: string;
  providerTransferId: string | null;
  heldReason: string | null;
  /** When the claim was written; the age of its idempotency key. */
  openedAt: Date;
};

const transferColumns = {
  id: transfers.id,
  orderId: transfers.orderId,
  vendorId: transfers.vendorId,
  kind: transfers.kind,
  state: transfers.state,
  amount: transfers.amount,
  currency: transfers.currency,
  providerTransferId: transfers.providerTransferId,
  heldReason: transfers.heldReason,
  openedAt: transfers.createdAt,
};

/**
 * Claims the right to pay a vendor a particular share of an order.
 *
 * `(order_id, kind)` is unique, so a retried job cannot open a second claim on
 * the same share however many times it runs. `onConflictDoNothing` plus a read
 * makes that the ordinary path rather than an exception: the second caller gets
 * the first caller's row and can see it is already paid.
 */
export async function claimTransfer(
  db: DbExecutor,
  input: {
    orderId: string;
    vendorId: string;
    kind: TransferKind;
    amount: bigint;
    currency: string;
    heldReason: string | null;
  },
): Promise<TransferRow> {
  await db
    .insert(transfers)
    .values({
      orderId: input.orderId,
      vendorId: input.vendorId,
      kind: input.kind,
      state: input.heldReason ? "held" : "pending",
      amount: input.amount,
      currency: input.currency,
      heldReason: input.heldReason,
    })
    .onConflictDoNothing({ target: [transfers.orderId, transfers.kind] });

  const [row] = await db
    .select(transferColumns)
    .from(transfers)
    .where(and(eq(transfers.orderId, input.orderId), eq(transfers.kind, input.kind)))
    .limit(1);

  return row as TransferRow;
}

export async function markTransferPaid(
  db: DbExecutor,
  transferId: string,
  input: { providerTransferId: string; now: Date },
): Promise<void> {
  await db
    .update(transfers)
    .set({
      state: "paid",
      providerTransferId: input.providerTransferId,
      paidAt: input.now,
      heldReason: null,
    })
    .where(eq(transfers.id, transferId));
}

export async function holdTransfer(
  db: DbExecutor,
  transferId: string,
  reason: string,
): Promise<void> {
  await db
    .update(transfers)
    .set({ state: "held", heldReason: reason })
    .where(eq(transfers.id, transferId));
}

export function loadTransfer(
  db: DbExecutor,
  orderId: string,
  kind: TransferKind,
): Promise<TransferRow | undefined> {
  return db
    .select(transferColumns)
    .from(transfers)
    .where(and(eq(transfers.orderId, orderId), eq(transfers.kind, kind)))
    .limit(1)
    .then((rows) => rows[0] as TransferRow | undefined);
}

export function listTransfers(db: DbExecutor, orderId: string): Promise<TransferRow[]> {
  return db
    .select(transferColumns)
    .from(transfers)
    .where(eq(transfers.orderId, orderId))
    .orderBy(transfers.createdAt);
}

export type RefundRow = {
  id: string;
  orderId: string;
  paymentId: string | null;
  state: "requested" | "settled" | "needs_attention";
  amount: bigint;
  currency: string;
  reason: string | null;
  providerRefundId: string | null;
  recordedExternally: Date | null;
  settledAt: Date | null;
  /** When the attempt was written; the age of its idempotency key. */
  openedAt: Date;
};

const refundColumns = {
  id: refunds.id,
  orderId: refunds.orderId,
  paymentId: refunds.paymentId,
  state: refunds.state,
  amount: refunds.amount,
  currency: refunds.currency,
  reason: refunds.reason,
  providerRefundId: refunds.providerRefundId,
  recordedExternally: refunds.recordedExternally,
  settledAt: refunds.settledAt,
  openedAt: refunds.createdAt,
};

/** Opens a refund attempt. Like a payment, the row precedes the provider call. */
export async function openRefund(
  db: DbExecutor,
  input: {
    orderId: string;
    paymentId: string | null;
    amount: bigint;
    currency: string;
    reason: string | null;
    requestedByUserId: string | null;
  },
): Promise<RefundRow> {
  const [row] = await db
    .insert(refunds)
    .values({
      orderId: input.orderId,
      paymentId: input.paymentId,
      amount: input.amount,
      currency: input.currency,
      reason: input.reason,
      requestedByUserId: input.requestedByUserId,
      state: "requested",
    })
    .returning(refundColumns);

  return row as RefundRow;
}

/**
 * Marks a payment as given back.
 *
 * Only when the whole of it has been: a partial refund leaves the payment
 * `succeeded`, because most of that money is still captured. The state exists
 * so a screen can label the payment without summing refund rows, and the seed
 * writes it too — the two must agree, or one order reads "succeeded · refunded"
 * and the next reads "refunded · refunded" for the same situation.
 */
export async function markPaymentRefunded(db: DbExecutor, paymentId: string): Promise<void> {
  await db.update(payments).set({ state: "refunded" }).where(eq(payments.id, paymentId));
}

export async function settleRefund(
  db: DbExecutor,
  refundId: string,
  input: { providerRefundId: string; now: Date; external: boolean },
): Promise<void> {
  await db
    .update(refunds)
    .set({
      state: "settled",
      providerRefundId: input.providerRefundId,
      settledAt: input.now,
      recordedExternally: input.external ? input.now : null,
    })
    .where(eq(refunds.id, refundId));
}

/**
 * Marks a refund as needing a person.
 *
 * The state exists because a refund and its vendor-side reversal are two writes
 * to two systems: the customer has their money and the vendor has not given
 * theirs back is a real situation, and a free-text note is not a way to find it
 * again.
 */
export async function flagRefundForAttention(
  db: DbExecutor,
  refundId: string,
  reason: string,
): Promise<void> {
  await db
    .update(refunds)
    .set({ state: "needs_attention", reason })
    .where(eq(refunds.id, refundId));
}

export function loadRefund(db: DbExecutor, refundId: string): Promise<RefundRow | undefined> {
  return db
    .select(refundColumns)
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .limit(1)
    .then((rows) => rows[0] as RefundRow | undefined);
}

export function listRefunds(db: DbExecutor, orderId: string): Promise<RefundRow[]> {
  return db
    .select(refundColumns)
    .from(refunds)
    .where(eq(refunds.orderId, orderId))
    .orderBy(refunds.createdAt);
}

/** What has actually been taken from a customer, net of what went back. */
export async function netCaptured(db: DbExecutor, orderId: string): Promise<bigint> {
  const [row] = await db
    .select({
      // `refunded` counts as captured. A payment in that state *was* taken —
      // the refund row is what gives it back, and it is subtracted below.
      // Counting only `succeeded` subtracts the same refund twice, which reads
      // a fully refunded order as owing the customer money it already returned.
      captured: sql<string>`coalesce(sum(${payments.amount}) filter (
        where ${payments.state} in ('succeeded', 'refunded')
      ), 0)`,
    })
    .from(payments)
    .where(eq(payments.orderId, orderId));

  const [back] = await db
    .select({
      // `needs_attention` counts too. That state is written *after* the refund
      // has settled — it flags that the vendor's share had already been
      // transferred and somebody has to reverse it — so the customer has their
      // money whatever the row is called. Counting only `settled` leaves the
      // order reading as though it still holds the funds, which means a second
      // full refund can be recorded against it.
      refunded: sql<string>`coalesce(sum(${refunds.amount}) filter (
        where ${refunds.state} in ('settled', 'needs_attention')
      ), 0)`,
    })
    .from(refunds)
    .where(eq(refunds.orderId, orderId));

  // `sum(bigint)` is `numeric`, which the driver hands back as a string: a raw
  // fragment carries no mapping, so the conversion is explicit rather than
  // left to whichever caller happens to coerce first.
  return BigInt(row?.captured ?? "0") - BigInt(back?.refunded ?? "0");
}

export type PaymentLinkRow = {
  id: string;
  orderId: string;
  token: string;
  amount: bigint;
  currency: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

const linkColumns = {
  id: paymentLinks.id,
  orderId: paymentLinks.orderId,
  token: paymentLinks.token,
  amount: paymentLinks.amount,
  currency: paymentLinks.currency,
  expiresAt: paymentLinks.expiresAt,
  consumedAt: paymentLinks.consumedAt,
};

/**
 * Mints a link, and puts out the one it replaces.
 *
 * `now` is the caller's **domain** clock, matching `paymentLinkState`. A link
 * retired against one clock and read against another is a link that can be
 * dead to the statement that replaced it and alive to the page that spends it.
 *
 * A replacement is issued when the balance declines again, so the order can
 * hold more than one link in its lifetime — but never more than one that works.
 * Leaving the old one live means a second bearer token for the same money, and
 * the operator who revokes "the link" revokes whichever one they were looking
 * at. Expiring rather than deleting keeps the history: the row is still there
 * to explain what was sent and when it stopped working.
 *
 * `expires_at = now()` rather than a flag, because that is the column
 * `paymentLinkState` already reads; a second way of saying "dead" is a second
 * thing to remember to check.
 */
export async function createPaymentLink(
  db: DbExecutor,
  input: { orderId: string; token: string; amount: bigint; currency: string; expiresAt: Date },
  now: Date,
): Promise<PaymentLinkRow> {
  await db
    .update(paymentLinks)
    .set({ expiresAt: now, updatedAt: now })
    .where(
      and(
        eq(paymentLinks.orderId, input.orderId),
        isNull(paymentLinks.consumedAt),
        gt(paymentLinks.expiresAt, now),
      ),
    );

  const [row] = await db.insert(paymentLinks).values(input).returning(linkColumns);
  return row as PaymentLinkRow;
}

export function loadPaymentLinkByToken(
  db: DbExecutor,
  token: string,
): Promise<PaymentLinkRow | undefined> {
  return db
    .select(linkColumns)
    .from(paymentLinks)
    .where(eq(paymentLinks.token, token))
    .limit(1)
    .then((rows) => rows[0] as PaymentLinkRow | undefined);
}

/**
 * Spends a link, once.
 *
 * The `consumed_at is null` predicate is what makes it single-use, and it is in
 * the statement rather than in a check the caller did first: two tabs submitting
 * the same link is the ordinary way a second payment gets attempted, and only
 * one of them can update a row that is already null.
 */
export async function consumePaymentLink(
  db: DbExecutor,
  linkId: string,
  now: Date,
): Promise<boolean> {
  const updated = await db
    .update(paymentLinks)
    .set({ consumedAt: now })
    .where(and(eq(paymentLinks.id, linkId), isNull(paymentLinks.consumedAt)))
    .returning({ id: paymentLinks.id });

  return updated.length === 1;
}

/**
 * Retires every live link for an order.
 *
 * `paid` and `void` are different facts and are recorded differently: a link
 * the customer actually used is consumed, and one retired because the balance
 * was taken another way — or because the booking ended — is expired. Writing
 * "consumed" on a link nobody opened would be a claim about the customer.
 */
export async function retirePaymentLinks(
  db: DbExecutor,
  orderId: string,
  now: Date,
  outcome: "paid" | "void",
): Promise<number> {
  const updated = await db
    .update(paymentLinks)
    .set(outcome === "paid" ? { consumedAt: now, expiresAt: now } : { expiresAt: now })
    .where(and(eq(paymentLinks.orderId, orderId), isNull(paymentLinks.consumedAt)))
    .returning({ id: paymentLinks.id });

  return updated.length;
}

/**
 * Records a webhook on arrival, unprocessed.
 *
 * Returns whether this is the first sighting. Idempotency is decided later by
 * `processed_at`, never by the row existing: a handler that failed halfway left
 * a row behind, and treating that as "already done" is how a paid order stays
 * unconfirmed for ever.
 */
export async function recordWebhook(
  db: DbExecutor,
  input: { eventId: string; type: string; account: string | null; payload: unknown; now: Date },
): Promise<{ id: string; alreadySeen: boolean; processedAt: Date | null }> {
  const inserted = await db
    .insert(stripeEvents)
    .values({
      eventId: input.eventId,
      type: input.type,
      account: input.account,
      payload: input.payload,
      receivedAt: input.now,
    })
    .onConflictDoNothing({ target: stripeEvents.eventId })
    .returning({ id: stripeEvents.id });

  const first = inserted[0];
  if (first) return { id: first.id, alreadySeen: false, processedAt: null };

  const [existing] = await db
    .select({ id: stripeEvents.id, processedAt: stripeEvents.processedAt })
    .from(stripeEvents)
    .where(eq(stripeEvents.eventId, input.eventId))
    .limit(1);

  return {
    id: existing?.id ?? "",
    alreadySeen: true,
    processedAt: existing?.processedAt ?? null,
  };
}

export async function markWebhookProcessed(db: DbExecutor, id: string, now: Date): Promise<void> {
  await db
    .update(stripeEvents)
    .set({ processedAt: now, lastError: null })
    .where(eq(stripeEvents.id, id));
}

export async function markWebhookFailed(db: DbExecutor, id: string, error: string): Promise<void> {
  await db
    .update(stripeEvents)
    .set({ lastError: error, attempts: sql`${stripeEvents.attempts} + 1` })
    .where(eq(stripeEvents.id, id));
}

/**
 * How many times the sweep will come back for one event.
 *
 * An early arrival resolves on the next tick, so this is generous. What it is
 * really for is the other case: an event that can *never* be applied, because
 * the order it names has been deleted or was never written. Without a ceiling
 * those rows accumulate at the front of the queue — the sweep reads the oldest
 * fifty — and once fifty of them exist no newly arrived event is ever swept
 * again. That is the failure the sweep was written to prevent, with an extra
 * step in front of it.
 */
export const MAX_WEBHOOK_ATTEMPTS = 10;

/**
 * Events that arrived and have not been applied — including early arrivals.
 *
 * Bounded by attempts as well as by count, so a row that will never succeed
 * stops being read and stays visible for a person instead.
 */
export function listUnprocessedWebhooks(db: DbExecutor, limit = 50) {
  return db
    .select({
      id: stripeEvents.id,
      eventId: stripeEvents.eventId,
      type: stripeEvents.type,
      account: stripeEvents.account,
      payload: stripeEvents.payload,
      attempts: stripeEvents.attempts,
    })
    .from(stripeEvents)
    .where(and(isNull(stripeEvents.processedAt), lt(stripeEvents.attempts, MAX_WEBHOOK_ATTEMPTS)))
    .orderBy(stripeEvents.receivedAt)
    .limit(limit);
}

/**
 * Counts an attempt against an event that is still waiting for its order.
 *
 * Parking records no error, because nothing is wrong — but it has to count, or
 * an event whose order will never exist is retried for ever and holds the front
 * of the queue.
 */
export async function countWebhookAttempt(db: DbExecutor, id: string): Promise<void> {
  await db
    .update(stripeEvents)
    .set({ attempts: sql`${stripeEvents.attempts} + 1` })
    .where(eq(stripeEvents.id, id));
}

/** Whether a connected account belongs to a vendor this platform knows. */
export async function vendorIdForStripeAccount(
  db: DbExecutor,
  accountId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(eq(vendors.stripeAccountId, accountId))
    .limit(1);

  return row?.id;
}

/** The provider's record of a person, and their address for creating one. */
export async function loadCustomerRef(
  db: DbExecutor,
  userId: string,
): Promise<{ email: string; fullName: string; stripeCustomerId: string | null } | undefined> {
  const [row] = await db
    .select({
      email: users.email,
      fullName: users.fullName,
      stripeCustomerId: users.stripeCustomerId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row;
}

export async function setCustomerId(
  db: DbExecutor,
  userId: string,
  customerId: string,
): Promise<void> {
  await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
}

/** A vendor's payout standing, read at the moment money would move. */
export async function loadPayeeAccount(
  db: DbExecutor,
  vendorId: string,
): Promise<
  { id: string; name: string; status: string; stripeAccountId: string | null } | undefined
> {
  const [row] = await db
    .select({
      id: vendors.id,
      name: vendors.name,
      status: vendors.status,
      stripeAccountId: vendors.stripeAccountId,
    })
    .from(vendors)
    .where(eq(vendors.id, vendorId))
    .limit(1);

  return row;
}

export async function setConnectedAccount(
  db: DbExecutor,
  vendorId: string,
  input: {
    accountId: string;
    status: string;
    chargesEnabledAt: Date | null;
    payoutsEnabledAt: Date | null;
  },
): Promise<void> {
  await db
    .update(vendors)
    .set({
      stripeAccountId: input.accountId,
      stripeStatus: input.status,
      stripeChargesEnabled: input.chargesEnabledAt,
      stripePayoutsEnabled: input.payoutsEnabledAt,
    })
    .where(eq(vendors.id, vendorId));
}

/** The order an id names, with the parties a payment decision needs. */
export async function loadOrderForPayment(
  db: DbExecutor,
  orderId: string,
): Promise<
  | {
      id: string;
      reference: string;
      userId: string;
      vendorId: string;
      state: string;
      currency: string;
      total: bigint;
      depositAmount: bigint;
      balanceAmount: bigint;
      commission: bigint;
      commissionTax: bigint;
      isDemo: boolean;
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      userId: orders.userId,
      vendorId: orders.vendorId,
      state: orders.state,
      currency: orders.currency,
      total: orders.total,
      depositAmount: orders.depositAmount,
      balanceAmount: orders.balanceAmount,
      commission: orders.commission,
      commissionTax: orders.commissionTax,
      isDemo: orders.isDemo,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return row;
}
