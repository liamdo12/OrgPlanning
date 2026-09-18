import { record } from "../audit/service.js";
import type { CoreContext, DbExecutor } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { ANONYMOUS, isAuthenticated, type Actor } from "../identity/actor.js";
import { assertCanActOnOrder, assertCanPayOrder } from "../identity/policies.js";
import { requireAdmin } from "../identity/service.js";
import * as ordering from "../ordering/repo.js";
import { applyTransition } from "../ordering/service.js";
import { payoutAllowed as orderPayoutAllowed, parseOrderState } from "../ordering/transitions.js";
import { payoutAllowed as vendorPayoutAllowed, type VendorStatus } from "../vendors/transitions.js";
import { sliceOrderMoney } from "./money.js";
import { mintPaymentLinkToken, paymentLinkDigest, paymentLinkState } from "./payment-links.js";
import * as repo from "./repo.js";
import {
  chargeOrAdoptOffSession,
  createOrAdoptPaymentIntent,
  createOrAdoptRefund,
  createOrAdoptTransfer,
  idempotencyKey,
} from "./stripe.js";

/**
 * Money, and the rules about when it may move.
 *
 * Everything here writes an attempt row before it calls the provider, because
 * that row's id is the idempotency key — see `stripe.ts` for why a key derived
 * from the order id double-charges. Everything here also asks the lifecycle and
 * the vendor's standing before paying anybody out, because an order in `issue`
 * and a suspended business look exactly like a healthy booking to a query that
 * only reads amounts.
 */

/** How long a customer has to rescue a declined balance. */
const GRACE_HOURS = 72;

/**
 * Everything a payment for an order is charged against.
 *
 * Grouped so the provider's dashboard shows a multi-vendor booking as one
 * thing. It is the order id rather than the checkout's, because a payment row
 * carries a unique provider intent and therefore belongs to exactly one order.
 */
function transferGroup(orderId: string): string {
  return orderId;
}

export type DepositResult = {
  paymentId: string;
  providerPaymentIntentId: string;
  clientSecret: string | null;
  /** Settled without further input — a test card, or a card needing no challenge. */
  settled: boolean;
};

/**
 * Takes the deposit, or the whole total for a short-notice booking.
 *
 * The attempt row is committed before the provider is called, deliberately in
 * its own transaction: if the call then fails, the row survives, and the retry
 * reuses its key instead of opening a second attempt. A row rolled back with
 * the failure would leave the retry with a new key and the provider with two
 * charges.
 */
export async function chargeDeposit(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<DepositResult> {
  const order = await repo.loadOrderForPayment(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  assertCanPayOrder(actor, { id: order.id, userId: order.userId, vendorId: order.vendorId });

  if (order.state !== "pending_payment") {
    throw new ValidationError("This order is not waiting for a deposit.", { state: "settled" });
  }

  const existing = await repo.latestPaymentOfKind(ctx.db, orderId, depositKind(order));
  if (existing?.state === "succeeded") {
    return {
      paymentId: existing.id,
      providerPaymentIntentId: existing.providerPaymentIntentId ?? "",
      clientSecret: null,
      settled: true,
    };
  }

  const customerId = await ensureCustomer(ctx, order.userId);
  const amount = order.depositAmount;

  // Under the order's lock, because two tabs pressing pay at the same moment
  // both read "no attempt yet", both open one, and two attempt rows are two
  // idempotency keys — which is two intents, both of which can be confirmed.
  const attempt = await ctx.db.transaction(async (tx) => {
    await ordering.loadForUpdate(tx, orderId);

    const open = await repo.latestPaymentOfKind(tx, orderId, depositKind(order));
    if (open?.state === "pending") return open;

    return repo.openPayment(tx, {
      orderId,
      kind: depositKind(order),
      amount,
      currency: order.currency,
      offSession: false,
      now: ctx.clock.realNow(),
    });
  });

  const intent = await createOrAdoptPaymentIntent(ctx, {
    paymentId: attempt.id,
    orderId,
    openedAt: attempt.openedAt,
    amount,
    currency: order.currency,
    customerId,
    transferGroup: transferGroup(orderId),
  });

  await repo.attachProviderIntent(ctx.db, attempt.id, { id: intent.id, chargeId: intent.chargeId });

  // The state change itself waits for the webhook. A charge that looks settled
  // here and is reversed a second later would otherwise have confirmed a
  // booking nobody paid for; `payment_intent.succeeded` is the provider saying
  // it is done, and that is the only sentence worth acting on.
  return {
    paymentId: attempt.id,
    providerPaymentIntentId: intent.id,
    clientSecret: intent.clientSecret,
    settled: intent.status === "succeeded",
  };
}

/** `deposit` normally; `full` when the plan takes everything at checkout. */
function depositKind(order: { depositAmount: bigint; total: bigint }): "deposit" | "full" {
  return order.depositAmount === order.total ? "full" : "deposit";
}

/**
 * Applies a settled charge: the payment row, then the order's state.
 *
 * Called from the webhook, and only from there. It is idempotent by
 * construction — the transition refuses a move the order has already made — so
 * a replayed event changes state once and a duplicate is a no-op rather than a
 * second confirmation.
 */
export async function confirmFromWebhook(
  ctx: CoreContext,
  input: { paymentIntentId: string; chargeId: string | null; paymentId?: string | undefined },
): Promise<{ orderId: string; applied: boolean }> {
  const payment = await paymentForEvent(ctx, input);
  if (!payment) {
    // The event beat the transaction that opened the attempt. Parked by the
    // caller and retried; never dropped.
    throw new UnknownOrderError(input.paymentIntentId);
  }

  const order = await ordering.load(ctx.db, payment.orderId);
  if (!order) throw new UnknownOrderError(input.paymentIntentId);

  const now = ctx.clock.realNow();

  if (payment.providerPaymentIntentId !== input.paymentIntentId) {
    // A hosted checkout's intent is learned here when it was not known at
    // creation, which is the case the metadata lookup exists for.
    await repo.attachProviderIntent(ctx.db, payment.id, {
      id: input.paymentIntentId,
      chargeId: input.chargeId,
    });
  }

  if (payment.state !== "succeeded") {
    await repo.markPaymentSucceeded(ctx.db, payment.id, { chargeId: input.chargeId, now });
  }

  // Which move this is depends on what was paid: a deposit confirms a new
  // booking, a balance returns one from `balance_due` or `action_required`.
  const to = "confirmed" as const;
  if (order.state === to) return { orderId: order.id, applied: false };

  try {
    // The link that was emailed to pay this balance, and the deadline it was
    // racing, are both retired by the transition: it knows it is leaving
    // `action_required`, and that is where the rule lives.
    await applyTransition(ctx, ANONYMOUS, order.id, to, {
      action: payment.kind === "balance" ? "payment.balance_captured" : "payment.deposit_captured",
    });
  } catch (error) {
    // Two deliveries of one event race here: both read the order before either
    // moved it, and the loser finds the move already made. That is the event
    // being applied once, which is what was wanted — not a failure to answer
    // 5xx for and have the provider retry for days.
    if (error instanceof ValidationError && error.issues["state"] === "unchanged") {
      return { orderId: order.id, applied: false };
    }
    throw error;
  }

  return { orderId: order.id, applied: true };
}

/** Raised when an event names an order this platform has not written yet. */
export class UnknownOrderError extends Error {
  override name = "UnknownOrderError";

  constructor(readonly paymentIntentId: string) {
    super(`No order for payment intent ${paymentIntentId} yet.`);
  }
}

/**
 * The attempt row an event is about.
 *
 * By the attempt id in the event's metadata first, and only then by the intent
 * id. A hosted checkout's intent may not have been known when the session was
 * created, so a lookup that could only match on the intent would park every one
 * of those as an early arrival — for ever, since nothing would ever learn the
 * id it was waiting for.
 */
async function paymentForEvent(
  ctx: CoreContext,
  input: { paymentIntentId: string; paymentId?: string | undefined },
) {
  if (input.paymentId) {
    const byId = await repo.loadPayment(ctx.db, input.paymentId);
    if (byId) return byId;
  }

  const order = await ordering.loadByPaymentIntent(ctx.db, input.paymentIntentId);
  if (!order) return undefined;

  const payments = await repo.listPayments(ctx.db, order.id);
  return payments.find((payment) => payment.providerPaymentIntentId === input.paymentIntentId);
}

export type BalanceResult = {
  outcome: "captured" | "action_required";
  paymentId: string;
  /** Present when the customer has to finish it themselves. */
  link?: { token: string; expiresAt: Date };
};

/**
 * Charges the balance with nobody present.
 *
 * Runs from the `charge_balance` job, fourteen days before the event. A decline
 * here is an ordinary answer rather than an error: the order moves to
 * `action_required`, a single-use link is minted for the email, and the
 * seventy-two hour grace window starts. Treating it as a failure would leave
 * the order in `balance_due` with nothing scheduled to move it and nobody told.
 */
export async function chargeBalance(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<BalanceResult> {
  const order = await repo.loadOrderForPayment(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  // The same policy as the deposit, and for the same reason: this charges a
  // saved card off-session. The job runner calls it with the system actor,
  // which is an administrator's answer to the policy; a vendor reaching it
  // would otherwise be able to make a charge happen on somebody else's card.
  assertCanPayOrder(actor, { id: order.id, userId: order.userId, vendorId: order.vendorId });

  if (order.balanceAmount <= 0n) {
    throw new ValidationError("This order has no balance to charge.", { balance: "none" });
  }

  const settled = await repo.succeededPaymentOfKind(ctx.db, orderId, "balance");
  if (settled) {
    return { outcome: "captured", paymentId: settled.id };
  }

  if (order.state === "confirmed") {
    await applyTransition(ctx, actor, orderId, "balance_due", { action: "payment.balance_start" });
  } else if (order.state !== "balance_due" && order.state !== "action_required") {
    throw new ValidationError("This order is not waiting for a balance.", { state: "closed" });
  }

  const deposit = await depositPayment(ctx, orderId);
  if (!deposit?.providerPaymentIntentId) {
    throw new ValidationError("This order has no settled deposit to charge against.", {
      deposit: "missing",
    });
  }

  const saved = await ctx.stripe.retrievePaymentIntent(deposit.providerPaymentIntentId);
  const customerId = await ensureCustomer(ctx, order.userId);

  if (!saved?.paymentMethodId) {
    // The card the deposit was taken on is the card the balance is charged to,
    // and the provider is the only place it lives. Without it there is nothing
    // to charge off-session, so the customer is asked instead.
    return handOffToLink(ctx, actor, order, null);
  }

  // An attempt that is still `pending` is one whose outcome this platform never
  // learned — the call timed out, or the process died between the charge and
  // the row. Reusing it reuses its idempotency key, which is the only thing
  // standing between a retried job and a second charge on somebody's card. A
  // *failed* attempt is different: that one has an answer, and a new charge
  // deserves a new key.
  const open = await repo.latestPaymentOfKind(ctx.db, orderId, "balance");
  const attempt =
    open?.state === "pending"
      ? open
      : await repo.openPayment(ctx.db, {
          orderId,
          kind: "balance",
          amount: order.balanceAmount,
          currency: order.currency,
          offSession: true,
          now: ctx.clock.realNow(),
        });

  const intent = await chargeOrAdoptOffSession(ctx, {
    paymentId: attempt.id,
    orderId,
    openedAt: attempt.openedAt,
    amount: order.balanceAmount,
    currency: order.currency,
    customerId,
    paymentMethodId: saved.paymentMethodId,
    transferGroup: transferGroup(orderId),
  });

  await repo.attachProviderIntent(ctx.db, attempt.id, { id: intent.id, chargeId: intent.chargeId });

  if (intent.status === "succeeded") {
    await repo.markPaymentSucceeded(ctx.db, attempt.id, {
      chargeId: intent.chargeId,
      now: ctx.clock.realNow(),
    });
    await applyTransition(ctx, actor, orderId, "confirmed", {
      action: "payment.balance_captured",
    });
    return { outcome: "captured", paymentId: attempt.id };
  }

  await repo.markPaymentFailed(ctx.db, attempt.id, {
    code: intent.failureCode,
    message: intent.failureMessage,
    now: ctx.clock.realNow(),
  });

  return handOffToLink(ctx, actor, order, attempt.id);
}

/**
 * Moves an order to `action_required` and mints the link that rescues it.
 *
 * The token is opaque and single-use, and the order id never appears in it —
 * `/pay/4192` is a URL that can be walked to every other booking by changing a
 * number.
 */
async function handOffToLink(
  ctx: CoreContext,
  actor: Actor,
  order: { id: string; balanceAmount: bigint; currency: string; state: string },
  paymentId: string | null,
): Promise<BalanceResult> {
  const { token, digest } = mintPaymentLinkToken();

  const mintLink = (tx: DbExecutor, expiresAt: Date) =>
    repo.createPaymentLink(tx, {
      orderId: order.id,
      token: digest,
      amount: order.balanceAmount,
      currency: order.currency,
      expiresAt,
    });

  if (order.state === "action_required") {
    // A second decline on an order already waiting. The order does not move —
    // it is already where it needs to be — but the customer gets a fresh link,
    // because the one they were sent may be the reason nobody paid. It expires
    // with the deadline already on the order, not a new one: a fresh 72 hours
    // per decline would let a failing card extend the grace window for ever.
    const existing = await ordering.load(ctx.db, order.id);
    const expiresAt =
      existing?.graceExpiresAt ?? new Date(ctx.clock.now().getTime() + GRACE_HOURS * 3_600_000);
    await mintLink(ctx.db, expiresAt);
    return { outcome: "action_required", paymentId: paymentId ?? "", link: { token, expiresAt } };
  }

  let expiresAt = new Date(ctx.clock.now().getTime() + GRACE_HOURS * 3_600_000);

  await applyTransition(ctx, actor, order.id, "action_required", {
    action: "payment.balance_declined",
    also: async (tx, _order, dates) => {
      // The link expires exactly when the grace job fires, because both come
      // from the same instant rather than from two readings of the clock.
      expiresAt = dates.graceExpiresAt ?? expiresAt;
      await mintLink(tx, expiresAt);
    },
  });

  return { outcome: "action_required", paymentId: paymentId ?? "", link: { token, expiresAt } };
}

/** The deposit, or the single full payment for a short-notice booking. */
async function depositPayment(ctx: CoreContext, orderId: string) {
  return (
    (await repo.succeededPaymentOfKind(ctx.db, orderId, "deposit")) ??
    (await repo.succeededPaymentOfKind(ctx.db, orderId, "full"))
  );
}

export type PaymentLinkView = {
  orderId: string;
  reference: string;
  amount: bigint;
  currency: string;
  expiresAt: Date;
};

/**
 * What a visitor holding a token may see.
 *
 * Anonymous by design — the token is the authority, and requiring a session
 * would mean the one person who needs this page is the one who cannot open it.
 * Every reason a token is not payable answers the same way: a page that says
 * "expired" rather than "no such link" has confirmed that the token was once
 * real, and a token that was once real names an order.
 */
export async function openPaymentLink(
  ctx: CoreContext,
  rawToken: string,
): Promise<PaymentLinkView> {
  const link = await repo.loadPaymentLinkByToken(ctx.db, paymentLinkDigest(rawToken));
  const state = paymentLinkState(link, ctx.clock.now());

  if (state !== "payable" || !link) throw new NotFoundError("No such payment link.");

  const order = await ordering.load(ctx.db, link.orderId);
  if (!order || order.state !== "action_required") {
    throw new NotFoundError("No such payment link.");
  }

  return {
    orderId: order.id,
    reference: order.reference,
    amount: link.amount,
    currency: link.currency,
    expiresAt: link.expiresAt,
  };
}

export type LinkCheckout = {
  paymentId: string;
  /** Where to send the customer to pay. */
  url: string;
};

/**
 * Starts a hosted checkout for the balance a link was emailed to rescue.
 *
 * The customer pays on the provider's own page and the webhook settles the
 * order. Creating an intent here and calling it done is what the first version
 * did, and it took no money at all: an intent that is created and never
 * confirmed sits at `requires_confirmation` for ever, however successful the
 * call that made it looked.
 *
 * **The link is not consumed here.** It is retired when the balance is actually
 * captured, by the transition out of `action_required` — so a customer who
 * closes the provider's page still has a working link, and one who pays does
 * not. Burning the token on an attempt that took no money is how somebody ends
 * up with an unpaid balance and no way to pay it.
 *
 * Re-entry is safe rather than a second charge: a `pending` attempt is reused,
 * so the idempotency key is the same, so the provider returns the session it
 * already made.
 */
export async function startLinkCheckout(
  ctx: CoreContext,
  rawToken: string,
  urls: { successUrl: string; cancelUrl: string },
): Promise<LinkCheckout> {
  const digest = paymentLinkDigest(rawToken);

  // The state is read under the order's own lock, so a link opened at the same
  // moment the balance settles cannot be acted on against a stale reading.
  const { link, order } = await ctx.db.transaction(async (tx) => {
    const found = await repo.loadPaymentLinkByToken(tx, digest);
    if (paymentLinkState(found, ctx.clock.now()) !== "payable" || !found) {
      throw new NotFoundError("No such payment link.");
    }

    const locked = await ordering.loadForUpdate(tx, found.orderId);
    // The order must still be waiting for this, and must still owe it. Neither
    // was checked before: a link could be paid against a cancelled booking, and
    // against a balance somebody had already paid another way.
    if (!locked || locked.state !== "action_required") {
      throw new NotFoundError("No such payment link.");
    }

    const settled = await repo.succeededPaymentOfKind(tx, locked.id, "balance");
    if (settled) throw new NotFoundError("No such payment link.");

    return { link: found, order: locked };
  });

  const customerId = await ensureCustomer(ctx, order.userId);

  const open = await repo.latestPaymentOfKind(ctx.db, order.id, "balance");
  const attempt =
    open?.state === "pending"
      ? open
      : await repo.openPayment(ctx.db, {
          orderId: order.id,
          kind: "balance",
          amount: link.amount,
          currency: link.currency,
          offSession: false,
          now: ctx.clock.realNow(),
        });

  const session = await ctx.stripe.createCheckoutSession({
    idempotencyKey: idempotencyKey("payment", attempt.id),
    amount: link.amount,
    currency: link.currency,
    customerId,
    description: `Balance for booking ${order.reference}`,
    transferGroup: transferGroup(order.id),
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    metadata: { order_id: order.id, payment_id: attempt.id },
  });

  if (session.paymentIntentId) {
    await repo.attachProviderIntent(ctx.db, attempt.id, {
      id: session.paymentIntentId,
      chargeId: null,
    });
  }

  return { paymentId: attempt.id, url: session.url };
}

export type TransferResult = {
  transferId: string;
  state: "paid" | "held";
  amount: bigint;
  reason?: string;
};

/**
 * Pays a vendor their share of one instalment.
 *
 * Four things have to be true, and each of them has been a real defect
 * somewhere:
 *
 * - **The order is in a state that pays out.** `issue` looks identical to
 *   `confirmed` on every other axis, and paying it out sends money for the
 *   booking somebody has just disputed.
 * - **The vendor is approved.** Suspension that only hides a business from
 *   search is not suspension; the payouts it already has scheduled would keep
 *   landing.
 * - **There is a charge to draw on.** A transfer with no `source_transaction`
 *   comes out of the platform's own balance.
 * - **It has not already been paid.** `(order_id, kind)` is unique, so the
 *   claim either exists or is made here, and a retry sees the first one.
 */
export async function transferShare(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  kind: repo.TransferKind,
): Promise<TransferResult> {
  const order = await repo.loadOrderForPayment(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  // Paying a vendor is an action on the order, so it takes the same policy as
  // marking one fulfilled: administrators, and the vendor the money is going
  // to. A customer must not be able to release their own booking's payout.
  assertCanActOnOrder(actor, { id: order.id, userId: order.userId, vendorId: order.vendorId });

  const payee = await repo.loadPayeeAccount(ctx.db, order.vendorId);
  if (!payee) throw new NotFoundError("No such order.");

  const source =
    kind === "deposit_share"
      ? await depositPayment(ctx, orderId)
      : await repo.succeededPaymentOfKind(ctx.db, orderId, "balance");
  if (!source?.providerPaymentIntentId || !source.providerChargeId) {
    throw new ValidationError("There is no settled charge to transfer from.", {
      payment: "unsettled",
    });
  }

  const share = shareFor(order, kind);

  // What is still held, net of anything already given back. A partial refund
  // made in the provider's dashboard does not move the order's state, so
  // nothing above this would have noticed that the money this transfer draws on
  // is no longer there.
  const captured = await repo.netCaptured(ctx.db, orderId);
  const alreadyMoved = (await repo.listTransfers(ctx.db, orderId))
    .filter((transfer) => transfer.state === "paid" && transfer.kind !== kind)
    .reduce((sum, transfer) => sum + transfer.amount, 0n);

  const refundShortfall =
    captured - alreadyMoved - share < 0n
      ? "Some of this order has been refunded; what is left does not cover this payout."
      : null;

  const heldReason =
    refundShortfall ??
    payoutBlockedReason(
      order.state,
      payee.status as VendorStatus,
      payee.name,
      payee.stripeAccountId,
    );

  const claim = await repo.claimTransfer(ctx.db, {
    orderId,
    vendorId: order.vendorId,
    kind,
    amount: share,
    currency: order.currency,
    heldReason,
  });

  if (claim.state === "paid") {
    return { transferId: claim.id, state: "paid", amount: claim.amount };
  }

  if (heldReason) {
    // Parked, not failed: an admin sees it on the vendor's record and it is
    // released when the reason stops being true.
    if (claim.state !== "held") await repo.holdTransfer(ctx.db, claim.id, heldReason);
    await record(ctx, actor, {
      action: "transfer.held",
      entityType: "order",
      entityId: orderId,
      after: { kind, reason: heldReason },
    });
    return { transferId: claim.id, state: "held", amount: claim.amount, reason: heldReason };
  }

  const moved = await createOrAdoptTransfer(ctx, {
    transferId: claim.id,
    orderId,
    openedAt: claim.openedAt,
    amount: claim.amount,
    currency: claim.currency,
    destinationAccountId: payee.stripeAccountId as string,
    sourceTransaction: source.providerChargeId,
    transferGroup: transferGroup(orderId),
  });

  await repo.markTransferPaid(ctx.db, claim.id, {
    providerTransferId: moved.id,
    now: ctx.clock.realNow(),
  });

  await record(ctx, actor, {
    action: "transfer.paid",
    entityType: "order",
    entityId: orderId,
    after: { kind, amount: claim.amount.toString(), providerTransferId: moved.id },
  });

  return { transferId: claim.id, state: "paid", amount: claim.amount };
}

/** Why this payout may not go, or null when it may. */
function payoutBlockedReason(
  orderState: string,
  vendorStatus: VendorStatus,
  vendorName: string,
  accountId: string | null,
): string | null {
  if (!orderPayoutAllowed(parseOrderState(orderState))) {
    return `The order is ${orderState}.`;
  }
  if (!vendorPayoutAllowed(vendorStatus)) {
    return `${vendorName} is ${vendorStatus}.`;
  }
  if (!accountId) {
    return `${vendorName} has not finished payment onboarding.`;
  }
  return null;
}

/**
 * This instalment's slice of what the vendor is owed.
 *
 * Recomputed from the order's own stored amounts rather than from the
 * catalogue: the money on the row is what the customer agreed to, and a
 * catalogue that has changed since must not change what anybody is paid.
 */
function shareFor(order: StoredMoney, kind: repo.TransferKind): bigint {
  const money = storedMoney(order);

  // A short-notice booking was paid in one go, so its whole share moves at once.
  if (order.balanceAmount === 0n) return money.vendorShare;

  const [deposit, balance] = sliceOrderMoney(money, [order.depositAmount, order.balanceAmount]);
  return kind === "deposit_share" ? (deposit?.vendorShare ?? 0n) : (balance?.vendorShare ?? 0n);
}

type StoredMoney = {
  subtotal?: bigint;
  tax?: bigint;
  total: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  commission: bigint;
  commissionTax: bigint;
};

/**
 * An order's money as it was agreed, read rather than recomputed.
 *
 * Deliberately not `computeOrderMoney(order.subtotal, …)`. Inverting a rounded
 * tax rate is not lossless, so an order written from a displayed total can have
 * a stored tax a cent away from what the forward rule would produce — and the
 * stored figures are the ones the customer agreed to and was charged. Money
 * that has already moved is read; only a new booking is computed.
 */
function storedMoney(order: StoredMoney) {
  return {
    subtotal: order.subtotal ?? order.total - (order.tax ?? 0n),
    tax: order.tax ?? 0n,
    total: order.total,
    commission: order.commission,
    commissionTax: order.commissionTax,
    vendorShare: order.total - order.commission - order.commissionTax,
  };
}

export type RefundResult = {
  /** The first refund written. `refundIds` is the whole set. */
  refundId: string;
  /** What went back to the customer in total. */
  amount: bigint;
  state: "settled" | "needs_attention";
  /** One per charge that held money — a booking can have more than one. */
  refundIds?: string[];
};

/**
 * The one refund this milestone performs in-app: a cancellation inside the
 * forty-eight hour cooling window.
 *
 * Everything else — post-transfer, partial, policy-computed, disputed — is done
 * by an administrator in the provider's dashboard and recorded here afterwards.
 * That is a scope decision, not an oversight: automated reversal and
 * policy-computed amounts need the legal and accounting review this milestone
 * excludes.
 *
 * The window is what makes this case simple. Nothing has been transferred yet —
 * the deposit share moves at +48h, which is the same instant the window closes
 * — so there is no vendor-side reversal to keep in step with the customer-side
 * refund.
 */
export async function refundWithinCoolingWindow(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<RefundResult> {
  const order = await ordering.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  // The customer cancelling their own booking, or an administrator doing it for
  // them. Not the vendor: a refund inside the free window is the customer's
  // right, and the vendor's own cancellation is a different path with a
  // different consequence for them.
  assertCanPayOrder(actor, { id: order.id, userId: order.userId, vendorId: order.vendorId });

  const now = ctx.clock.now();
  if (!order.coolingWindowEndsAt || order.coolingWindowEndsAt.getTime() <= now.getTime()) {
    throw new ValidationError(
      "The free cancellation window has closed. Refund this in the Stripe dashboard and record it here.",
      { window: "closed" },
    );
  }

  const paid = await repo.netCaptured(ctx.db, orderId);
  if (paid <= 0n) {
    throw new ValidationError("Nothing has been captured on this order.", { payment: "none" });
  }

  const alreadyPaidOut = await repo.loadTransfer(ctx.db, orderId, "deposit_share");
  if (alreadyPaidOut?.state === "paid") {
    // Should not happen inside the window, and is exactly the case where a
    // silent partial refund would be wrong: the vendor has the money.
    throw new ValidationError(
      "The deposit share has already been transferred. Reverse it in the Stripe dashboard and record the refund here.",
      { transfer: "paid" },
    );
  }

  // One refund per charge that actually holds money, not one refund for the
  // whole order against whichever charge came first.
  //
  // The two are the same figure on an ordinary booking, because only the
  // deposit has been taken inside a forty-eight hour window. They are not the
  // same on a booking made **fifteen days** before its event: the balance falls
  // due at event−14d, which is inside that window, so both charges have settled
  // by the time somebody cancels. Refunding their sum against the deposit's
  // intent asks the provider to return more than that charge ever held, and it
  // refuses — leaving a customer who cannot cancel and a `requested` row nobody
  // reconciles.
  const settled = (await repo.listPayments(ctx.db, orderId)).filter(
    (payment) => payment.state === "succeeded" && payment.providerPaymentIntentId,
  );

  if (settled.length === 0) {
    throw new ValidationError("There is no settled charge to refund.", { payment: "unsettled" });
  }

  const refunds: Array<{ id: string; amount: bigint }> = [];

  for (const payment of settled) {
    // Each attempt row precedes its own provider call and carries its own key,
    // so a failure partway through leaves the refunds already made recorded and
    // the rest retryable.
    const attempt = await repo.openRefund(ctx.db, {
      orderId,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      reason: "Cancelled inside the free cancellation window.",
      requestedByUserId: isAuthenticated(actor) ? actor.userId : null,
    });

    const refund = await createOrAdoptRefund(ctx, {
      refundId: attempt.id,
      orderId,
      openedAt: attempt.openedAt,
      amount: payment.amount,
      paymentIntentId: payment.providerPaymentIntentId as string,
    });

    await repo.settleRefund(ctx.db, attempt.id, {
      providerRefundId: refund.id,
      now: ctx.clock.realNow(),
      external: false,
    });

    // The whole charge went back, so the payment says so. `netCaptured` does
    // not depend on this — it counts a refunded payment as captured and
    // subtracts the refund row — but a screen labelling the payment does.
    await repo.markPaymentRefunded(ctx.db, payment.id);

    refunds.push({ id: attempt.id, amount: payment.amount });
  }

  await applyTransition(ctx, actor, orderId, "cancelled", {
    action: "order.cancel_within_window",
  });
  await applyTransition(ctx, actor, orderId, "refunded", { action: "payment.refunded" });

  const returned = refunds.reduce((sum, refund) => sum + refund.amount, 0n);

  return {
    refundId: refunds[0]?.id as string,
    amount: returned,
    state: "settled",
    refundIds: refunds.map((refund) => refund.id),
  };
}

/**
 * Records a refund an administrator made in the provider's dashboard.
 *
 * The other half of the scope decision above. It writes no money — the money
 * has already moved — and exists so the order stops claiming to hold funds it
 * no longer holds. The provider's refund id is required: a recorded refund with
 * nothing to check it against is a note.
 */
export async function recordExternalRefund(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  input: { providerRefundId: string; amount: bigint; reason: string },
): Promise<RefundResult> {
  requireAdmin(actor);

  const order = await ordering.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  if (!/^re_[A-Za-z0-9]+$/.test(input.providerRefundId)) {
    throw new ValidationError("That is not a Stripe refund id.", { providerRefundId: "invalid" });
  }

  const captured = await repo.netCaptured(ctx.db, orderId);
  if (input.amount <= 0n || input.amount > captured) {
    throw new ValidationError(
      `A refund must be between one cent and what is still captured (${captured}).`,
      { amount: "out_of_range" },
    );
  }

  const deposit = await depositPayment(ctx, orderId);

  const attempt = await repo.openRefund(ctx.db, {
    orderId,
    paymentId: deposit?.id ?? null,
    amount: input.amount,
    currency: order.currency,
    reason: input.reason.trim().slice(0, 500),
    requestedByUserId: isAuthenticated(actor) ? actor.userId : null,
  });

  await repo.settleRefund(ctx.db, attempt.id, {
    providerRefundId: input.providerRefundId,
    now: ctx.clock.realNow(),
    external: true,
  });

  const transfer = await repo.loadTransfer(ctx.db, orderId, "deposit_share");
  if (transfer?.state === "paid") {
    // The customer has their money back and the vendor still has theirs. That
    // is a real state somebody has to clear, and a free-text note is not a way
    // to find it again.
    await repo.flagRefundForAttention(
      ctx.db,
      attempt.id,
      "The deposit share was already transferred; reverse it in the Stripe dashboard.",
    );
  }

  await record(ctx, actor, {
    action: "payment.record_external_refund",
    entityType: "order",
    entityId: orderId,
    after: { amount: input.amount.toString(), providerRefundId: input.providerRefundId },
  });

  const full = input.amount >= captured;
  if (full && order.state !== "refunded") {
    if (order.state !== "cancelled") {
      await applyTransition(ctx, actor, orderId, "cancelled", { action: "order.cancel_refunded" });
    }
    await applyTransition(ctx, actor, orderId, "refunded", { action: "payment.refunded" });
  }

  return {
    refundId: attempt.id,
    amount: input.amount,
    state: transfer?.state === "paid" ? "needs_attention" : "settled",
  };
}

/**
 * Starts or refreshes a vendor's Connect Express onboarding.
 *
 * The status is mirrored onto the vendor row rather than read from the provider
 * on every screen, because the admin queue lists six of them at a time and six
 * provider round trips per page load is a slow screen that also rate-limits.
 * `refreshConnectStatus` is what keeps the mirror honest.
 */
export async function startConnectOnboarding(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
  urls: { refreshUrl: string; returnUrl: string },
): Promise<{ accountId: string; url: string; expiresAt: Date }> {
  requireAdmin(actor);

  const payee = await repo.loadPayeeAccount(ctx.db, vendorId);
  if (!payee) throw new NotFoundError("No such vendor.");

  let accountId = payee.stripeAccountId;

  if (!accountId) {
    const account = await ctx.stripe.createConnectedAccount({
      // No address. The provider emails the business about its own onboarding
      // and payouts, and an address invented here is one those messages are
      // undeliverable to by construction. Stripe asks the vendor for theirs
      // during onboarding, which is the only place it is actually known.
      idempotencyKey: `acct_${vendorId}`,
      businessName: payee.name,
      metadata: { vendor_id: vendorId },
    });

    accountId = account.id;
    await repo.setConnectedAccount(ctx.db, vendorId, {
      accountId: account.id,
      status: account.payoutsEnabled ? "enabled" : "pending",
      chargesEnabledAt: account.chargesEnabled ? ctx.clock.realNow() : null,
      payoutsEnabledAt: account.payoutsEnabled ? ctx.clock.realNow() : null,
    });
  }

  const link = await ctx.stripe.createAccountLink({ accountId, ...urls });

  await record(ctx, actor, {
    action: "vendor.connect_onboarding",
    entityType: "vendor",
    entityId: vendorId,
    after: { accountId },
  });

  return { accountId, url: link.url, expiresAt: link.expiresAt };
}

/** Re-reads what the provider believes and writes it onto the vendor row. */
export async function refreshConnectStatus(
  ctx: CoreContext,
  actor: Actor,
  vendorId: string,
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean; requirementsDue: string[] }> {
  requireAdmin(actor);

  const payee = await repo.loadPayeeAccount(ctx.db, vendorId);
  if (!payee?.stripeAccountId) {
    throw new ValidationError("This vendor has not started payment onboarding.", {
      stripe: "absent",
    });
  }

  const account = await ctx.stripe.retrieveAccount(payee.stripeAccountId);
  if (!account) {
    throw new NotFoundError("The provider has no such account.");
  }

  const now = ctx.clock.realNow();
  await repo.setConnectedAccount(ctx.db, vendorId, {
    accountId: account.id,
    status: account.payoutsEnabled
      ? "enabled"
      : account.requirementsDue.length
        ? "pending"
        : "review",
    chargesEnabledAt: account.chargesEnabled ? now : null,
    payoutsEnabledAt: account.payoutsEnabled ? now : null,
  });

  return {
    chargesEnabled: account.chargesEnabled,
    payoutsEnabled: account.payoutsEnabled,
    requirementsDue: account.requirementsDue,
  };
}

/** The provider's record of a person, created once and reused. */
async function ensureCustomer(ctx: CoreContext, userId: string): Promise<string> {
  const person = await repo.loadCustomerRef(ctx.db, userId);
  if (!person) throw new NotFoundError("No such account.");
  if (person.stripeCustomerId) return person.stripeCustomerId;

  const customer = await ctx.stripe.ensureCustomer({
    // Keyed on the account rather than on the moment, so two checkouts racing
    // each other cannot make two customers for one person.
    idempotencyKey: `cus_${userId}`,
    email: person.email,
    name: person.fullName,
    metadata: { user_id: userId },
  });

  await repo.setCustomerId(ctx.db, userId, customer.id);
  return customer.id;
}

/**
 * Applies a webhook that has already been recorded.
 *
 * Processing is separate from receipt on purpose: the event is acknowledged the
 * moment it is stored, and applying it is a second transaction that may fail
 * and be retried. Idempotency is `processed_at`, never the row existing — a
 * handler that failed halfway left a row behind, and reading that as "already
 * done" is how a paid order stays unconfirmed.
 */
export async function applyWebhook(
  ctx: CoreContext,
  event: { type: string; object: Record<string, unknown> },
): Promise<{ applied: boolean; detail: string }> {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intentId = stringField(event.object, "id");
      const charge = event.object["latest_charge"];
      const result = await confirmFromWebhook(ctx, {
        paymentIntentId: intentId,
        chargeId: typeof charge === "string" ? charge : null,
        ...attemptFromMetadata(event.object),
      });
      return { applied: result.applied, detail: `order ${result.orderId}` };
    }

    case "checkout.session.completed": {
      // A hosted checkout the customer finished. `payment_intent.succeeded`
      // says the same thing and usually arrives too; both are handled, because
      // which lands first is the provider's business and either one is enough.
      const intent = event.object["payment_intent"];
      if (typeof intent !== "string") {
        return { applied: false, detail: "session carried no payment intent" };
      }

      const result = await confirmFromWebhook(ctx, {
        paymentIntentId: intent,
        chargeId: null,
        ...attemptFromMetadata(event.object),
      });
      return { applied: result.applied, detail: `order ${result.orderId}` };
    }

    case "payment_intent.payment_failed": {
      const intentId = stringField(event.object, "id");
      const payment = await paymentForEvent(ctx, {
        paymentIntentId: intentId,
        ...attemptFromMetadata(event.object),
      });
      if (!payment) throw new UnknownOrderError(intentId);

      const error = event.object["last_payment_error"] as {
        code?: string;
        message?: string;
      } | null;
      await repo.markPaymentFailed(ctx.db, payment.id, {
        code: error?.code ?? null,
        message: error?.message ?? null,
        now: ctx.clock.realNow(),
      });
      return { applied: true, detail: `payment ${payment.id} failed` };
    }

    case "account.updated": {
      const accountId = stringField(event.object, "id");
      const vendorId = await repo.vendorIdForStripeAccount(ctx.db, accountId);
      if (!vendorId) return { applied: false, detail: "account belongs to no vendor" };

      const now = ctx.clock.realNow();
      await repo.setConnectedAccount(ctx.db, vendorId, {
        accountId,
        status: event.object["payouts_enabled"] ? "enabled" : "pending",
        chargesEnabledAt: event.object["charges_enabled"] ? now : null,
        payoutsEnabledAt: event.object["payouts_enabled"] ? now : null,
      });
      return { applied: true, detail: `vendor ${vendorId}` };
    }

    default:
      // Not an error. Stripe sends a great deal this platform has no opinion
      // about, and a handler that threw on the unfamiliar would turn every one
      // of them into a retry loop.
      return { applied: false, detail: `ignored ${event.type}` };
  }
}

/** Reads the whole money picture for one order, for an admin screen. */
export async function getOrderMoney(ctx: CoreContext, actor: Actor, orderId: string) {
  const order = await ordering.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  assertCanActOnOrder(actor, { id: order.id, userId: order.userId, vendorId: order.vendorId });

  const [payments, transfers, refunds, captured] = await Promise.all([
    repo.listPayments(ctx.db, orderId),
    repo.listTransfers(ctx.db, orderId),
    repo.listRefunds(ctx.db, orderId),
    repo.netCaptured(ctx.db, orderId),
  ]);

  return {
    money: storedMoney(order),
    shares: {
      deposit: shareFor(order, "deposit_share"),
      balance: order.balanceAmount === 0n ? 0n : shareFor(order, "balance_share"),
    },
    payments,
    transfers,
    refunds,
    captured,
  };
}

/**
 * A string field off a webhook payload.
 *
 * Narrowed rather than coerced: `String(someObject)` is `"[object Object]"`, and
 * an id that reads as that would be looked up, missed, and parked as an early
 * arrival for ever.
 */
function stringField(object: Record<string, unknown>, field: string): string {
  const value = object[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`This event carries no ${field}.`, { [field]: "missing" });
  }
  return value;
}

/**
 * The attempt row an event names in its own metadata.
 *
 * Every object this platform creates at the provider carries `payment_id`, so
 * an event can be matched to its attempt without depending on an intent id this
 * side may not have recorded yet.
 */
function attemptFromMetadata(object: Record<string, unknown>): { paymentId?: string } {
  const metadata = object["metadata"];
  if (typeof metadata !== "object" || metadata === null) return {};

  const paymentId = (metadata as Record<string, unknown>)["payment_id"];
  return typeof paymentId === "string" && paymentId.length > 0 ? { paymentId } : {};
}
