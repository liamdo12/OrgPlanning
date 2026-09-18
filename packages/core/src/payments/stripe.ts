import type { CoreContext } from "../context.js";
import type { ProviderPaymentIntent, ProviderRefund, ProviderTransfer } from "../ports.js";

/**
 * Every call that moves money, keyed to a row this platform wrote first.
 *
 * Two mechanisms, and the second exists because the first has a shelf life.
 *
 * **The key.** An attempt row — a `payments`, `transfers` or `refunds` row — is
 * inserted before the provider is called, and its UUID is the idempotency key.
 * Retrying reuses the row, so it reuses the key, so the provider returns the
 * object it already made instead of making another. A key derived from the
 * order id would be shared by every attempt on that order: a second partial
 * refund would collide with the first, and a genuine retry months later would
 * be indistinguishable from a repeat.
 *
 * **The window.** A provider only remembers a key for about a day. Past that
 * the same key is a *new* key, and a retry creates a second charge. So retries
 * are capped at six hours — comfortably inside the window — and the first
 * attempt after the cap does not retry at all: it asks the provider what
 * already exists for this attempt row, and adopts it.
 *
 * `metadata` is what makes that lookup possible, which is why every creation
 * here carries the attempt row's id and the order's.
 */

/**
 * How long a chain of retries may run before a key can no longer be trusted.
 *
 * Six hours against the provider's roughly twenty-four. The margin is for the
 * gap between "the job was claimed" and "the call was made" — a runner that is
 * behind can add hours of its own, and a ceiling that sat at twenty hours would
 * depend on it never being.
 */
export const RETRY_CEILING_MS = 6 * 60 * 60 * 1000;

/** Prefixes, so an idempotency key read in a provider dashboard says what it was for. */
const PREFIX = { payment: "pay", transfer: "tr", refund: "rf" } as const;

export function idempotencyKey(kind: keyof typeof PREFIX, rowId: string): string {
  return `${PREFIX[kind]}_${rowId}`;
}

/**
 * Whether this attempt has been running long enough that its key may have been
 * forgotten.
 *
 * `openedAt` is when the attempt row was written, not when this retry started:
 * the question is how old the key is, and the key is as old as the row.
 */
export function keyMayHaveExpired(openedAt: Date, now: Date): boolean {
  return now.getTime() - openedAt.getTime() > RETRY_CEILING_MS;
}

export type ChargeRequest = {
  paymentId: string;
  orderId: string;
  openedAt: Date;
  amount: bigint;
  currency: string;
  customerId: string;
  transferGroup: string;
};

/**
 * Creates the deposit charge, or adopts the one an earlier attempt made.
 *
 * The adoption branch is the one that matters. A request that timed out may
 * still have created a charge: the platform never learned its id, the attempt
 * row has no intent attached, and the naive repair is to call create again.
 * Inside the key window that is safe, because the key deduplicates. Outside it,
 * that call charges the customer a second time — so past the ceiling the only
 * legal first move is to look.
 */
export async function createOrAdoptPaymentIntent(
  ctx: CoreContext,
  request: ChargeRequest,
): Promise<ProviderPaymentIntent> {
  const adopted = await adoptExistingIntent(ctx, request);
  if (adopted) return adopted;

  return ctx.stripe.createPaymentIntent({
    idempotencyKey: idempotencyKey("payment", request.paymentId),
    amount: request.amount,
    currency: request.currency,
    customerId: request.customerId,
    transferGroup: request.transferGroup,
    metadata: attemptMetadata(request.orderId, "payment_id", request.paymentId),
  });
}

/** The same rule for the off-session balance charge. */
export async function chargeOrAdoptOffSession(
  ctx: CoreContext,
  request: ChargeRequest & { paymentMethodId: string },
): Promise<ProviderPaymentIntent> {
  const adopted = await adoptExistingIntent(ctx, request);
  if (adopted) return adopted;

  return ctx.stripe.chargeOffSession({
    idempotencyKey: idempotencyKey("payment", request.paymentId),
    amount: request.amount,
    currency: request.currency,
    customerId: request.customerId,
    paymentMethodId: request.paymentMethodId,
    transferGroup: request.transferGroup,
    metadata: attemptMetadata(request.orderId, "payment_id", request.paymentId),
  });
}

async function adoptExistingIntent(
  ctx: CoreContext,
  request: { paymentId: string; orderId: string; openedAt: Date },
): Promise<ProviderPaymentIntent | null> {
  if (!keyMayHaveExpired(request.openedAt, ctx.clock.realNow())) return null;

  return ctx.stripe.findPaymentIntentByMetadata({
    orderId: request.orderId,
    paymentId: request.paymentId,
  });
}

export type TransferRequest = {
  transferId: string;
  orderId: string;
  openedAt: Date;
  amount: bigint;
  currency: string;
  destinationAccountId: string;
  sourceTransaction: string;
  transferGroup: string;
};

export async function createOrAdoptTransfer(
  ctx: CoreContext,
  request: TransferRequest,
): Promise<ProviderTransfer> {
  if (keyMayHaveExpired(request.openedAt, ctx.clock.realNow())) {
    const existing = await ctx.stripe.findTransferByMetadata({
      orderId: request.orderId,
      transferId: request.transferId,
    });
    if (existing) return existing;
  }

  return ctx.stripe.createTransfer({
    idempotencyKey: idempotencyKey("transfer", request.transferId),
    amount: request.amount,
    currency: request.currency,
    destinationAccountId: request.destinationAccountId,
    sourceTransaction: request.sourceTransaction,
    transferGroup: request.transferGroup,
    metadata: attemptMetadata(request.orderId, "transfer_id", request.transferId),
  });
}

export type RefundRequest = {
  refundId: string;
  orderId: string;
  openedAt: Date;
  amount: bigint;
  paymentIntentId: string;
};

export async function createOrAdoptRefund(
  ctx: CoreContext,
  request: RefundRequest,
): Promise<ProviderRefund> {
  if (keyMayHaveExpired(request.openedAt, ctx.clock.realNow())) {
    const existing = await ctx.stripe.findRefundByMetadata({
      paymentIntentId: request.paymentIntentId,
      refundId: request.refundId,
    });
    if (existing) return existing;
  }

  return ctx.stripe.createRefund({
    idempotencyKey: idempotencyKey("refund", request.refundId),
    paymentIntentId: request.paymentIntentId,
    amount: request.amount,
    metadata: {
      ...attemptMetadata(request.orderId, "refund_id", request.refundId),
      payment_intent_id: request.paymentIntentId,
    },
  });
}

/**
 * What every provider object carries so it can be found again.
 *
 * The order id alone would not do: an order has several attempts, and the
 * question this answers is "did *this* attempt already create something".
 */
function attemptMetadata(orderId: string, field: string, value: string): Record<string, string> {
  return { order_id: orderId, [field]: value };
}
