import type { CoreContext } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import * as ordering from "../ordering/repo.js";
import { autoComplete, cancelOrder } from "../ordering/service.js";
import { chargeBalance, transferShare } from "../payments/service.js";
import { expireQuoteRequest } from "../quotes/service.js";
import { deliverSend } from "../email/service.js";
import { isTerminal } from "../ordering/transitions.js";
import { orderIdOf, type JobRow, type JobType } from "./repo.js";

/**
 * What each job type actually does.
 *
 * Thin on purpose: every one of these is a call into a service that already
 * owns the rule, the transaction and the audit entry. A handler that
 * implemented a lifecycle move itself would be a second answer to "what happens
 * when an order completes", and the lifecycle is specified once.
 *
 * All of them are safe to run twice. That is the property the queue depends on
 * — a job can be claimed, crash after its work committed, and be retried — and
 * it is achieved by asking the current state rather than by assuming the one
 * that was true when the job was queued. A job that finds its work already done
 * reports that and finishes, rather than throwing.
 */

/** A job either finished, or could not run yet for a reason that is not an error. */
export type JobOutcome = { kind: "done"; detail: string } | { kind: "held"; reason: string };

export type JobHandler = (ctx: CoreContext, actor: Actor, job: JobRow) => Promise<JobOutcome>;

const done = (detail: string): JobOutcome => ({ kind: "done", detail });
const held = (reason: string): JobOutcome => ({ kind: "held", reason });

/** The order a job is about, or a refusal naming the job rather than the row. */
async function orderFor(ctx: CoreContext, job: JobRow) {
  const orderId = orderIdOf(job);
  if (!orderId) {
    throw new ValidationError(`A ${job.type} job must name its order.`, { payload: "invalid" });
  }

  const order = await ordering.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");
  return order;
}

/**
 * The soft hold expiring on a cart nobody paid for.
 *
 * Without this an abandoned checkout keeps a vendor's date for ever and nothing
 * else would ever free it. An order that has since been paid is left alone —
 * leaving `pending_payment` already cancels this job, so arriving here at all
 * means the two raced.
 */
const expireUnpaid: JobHandler = async (ctx, actor, job) => {
  const order = await orderFor(ctx, job);
  if (order.state !== "pending_payment") {
    return done(`${order.reference} is ${order.state}; nothing to expire.`);
  }

  const change = await cancelOrder(ctx, actor, order.id, "order.expire_unpaid");
  return done(`${order.reference} expired unpaid; ${change.capacityReleased} date(s) released.`);
};

/**
 * The vendor's share of the deposit, once the free-cancellation window closes.
 *
 * Held rather than failed when the money cannot move: a suspended vendor, or
 * one with no connected account, is correct behaviour and not an error. Failing
 * it would burn an attempt and eventually give up on money somebody is owed.
 */
const coolingWindowTransfer: JobHandler = async (ctx, actor, job) => {
  const order = await orderFor(ctx, job);

  try {
    const transfer = await transferShare(ctx, actor, order.id, "deposit_share");
    return transfer.state === "paid"
      ? done(`Deposit share paid on ${order.reference}.`)
      : held(transfer.reason ?? `Payout held on ${order.reference}.`);
  } catch (error) {
    // A refusal that names a standing rather than a fault is a hold. Anything
    // else is a real failure and belongs in the retry path.
    if (error instanceof ValidationError) return held(error.message);
    throw error;
  }
};

/**
 * The balance, fourteen days before the event.
 *
 * A decline is an ordinary answer rather than a failure: the order moves to
 * `action_required`, a link is minted for the customer, and the grace window
 * starts. Retrying the job would charge the same card again for a reason
 * already known.
 */
const chargeBalanceJob: JobHandler = async (ctx, actor, job) => {
  const order = await orderFor(ctx, job);

  if (isTerminal(order.state)) {
    return done(`${order.reference} is ${order.state}; no balance to charge.`);
  }

  try {
    const result = await chargeBalance(ctx, actor, order.id);
    return result.outcome === "captured"
      ? done(`Balance captured on ${order.reference}.`)
      : done(`Balance declined on ${order.reference}; waiting on the customer.`);
  } catch (error) {
    // A refusal that names the order's present condition is a hold, not a
    // failure — the same reading the transfer path already takes. `issue` is
    // the case that matters: a flagged order refuses the charge, and treating
    // that as a fault would burn eight attempts and land in `failed`, where
    // nothing re-enqueues a balance charge. The platform would then simply
    // never collect it, even after the issue was resolved and the booking went
    // ahead.
    if (error instanceof ValidationError) {
      return held(`${order.reference} is ${order.state}: ${error.message}`);
    }
    throw error;
  }
};

/**
 * The seventy-two hours a customer had to rescue a declined balance, run out.
 *
 * The booking is cancelled, which puts the date back on the vendor's calendar.
 * **No refund is computed here.** The free-cancellation window closed long
 * before — a balance falls due fourteen days before the event — so anything
 * owed back is a policy-computed amount, and this milestone performs exactly
 * one refund in-app: a cancellation inside the free window. Whatever the policy
 * says is due is refunded by an administrator in the provider's dashboard and
 * recorded against the order.
 */
const balanceGraceExpiry: JobHandler = async (ctx, actor, job) => {
  const order = await orderFor(ctx, job);

  if (order.state !== "action_required") {
    // The window belongs to `action_required` alone, and every other state it
    // could be in means somebody or something resolved it — the balance was
    // paid, the order was cancelled, a problem was raised. None of those come
    // back to `action_required` without a fresh decline, which queues this
    // again.
    return done(`${order.reference} is ${order.state}; the grace window no longer applies.`);
  }

  const change = await cancelOrder(ctx, actor, order.id, "order.grace_expired");
  return done(
    `${order.reference} cancelled after the grace window; ` +
      `${change.capacityReleased} date(s) released, ${change.linksRetired} link(s) retired.`,
  );
};

/**
 * Seventy-two hours after the event, with nobody having raised a problem.
 *
 * Completing the order is what releases the balance share, so the transfer is
 * attempted in the same run. A held payout does not undo the completion — the
 * booking is finished either way, and the money is a separate fact the queue
 * keeps carrying.
 */
const autoCompleteOrder: JobHandler = async (ctx, actor, job) => {
  const order = await orderFor(ctx, job);

  if (order.state === "completed") {
    return done(`${order.reference} is already complete.`);
  }

  if (order.state !== "fulfilled") {
    // Parked rather than finished, unless the order has actually ended. A
    // delivered booking can be flagged and then resolved back to `fulfilled` —
    // the lifecycle allows exactly that — and a job marked `done` in between is
    // a job the re-entry cannot wake, because the dedupe key is taken. The
    // order would then sit `fulfilled` for ever, never complete, and never
    // release the balance share.
    return isTerminal(order.state)
      ? done(`${order.reference} is ${order.state}; nothing to complete.`)
      : held(`${order.reference} is ${order.state}; waiting for it to be delivered again.`);
  }

  await autoComplete(ctx, actor, order.id);

  // A short-notice or small booking is paid in full at checkout and has no
  // balance, so there is no second share to move — the deposit share, which was
  // the whole of it, went at the cooling window. Asking for one anyway finds no
  // settled balance charge and refuses, and the job would sit `held` for ever
  // against an order that is finished and fully paid out.
  if (order.balanceAmount <= 0n) {
    return done(`${order.reference} completed; it was paid in full, so nothing is left to move.`);
  }

  try {
    const transfer = await transferShare(ctx, actor, order.id, "balance_share");
    return transfer.state === "paid"
      ? done(`${order.reference} completed and the balance share paid.`)
      : held(transfer.reason ?? `${order.reference} completed; payout held.`);
  } catch (error) {
    // A balance the order has, with no settled charge behind it, is a real
    // anomaly — but it is one for a person rather than for the retry loop, and
    // the order is completed either way.
    if (error instanceof ValidationError) {
      return held(`${order.reference} completed; payout held: ${error.message}`);
    }
    throw error;
  }
};

/** A request nobody booked from, past its deadline. */
const expireQuote: JobHandler = async (ctx, actor, job) => {
  const id = (job.payload as { quoteRequestId?: unknown }).quoteRequestId;
  if (typeof id !== "string") {
    throw new ValidationError("An expiry job must name its quote request.", {
      payload: "invalid",
    });
  }

  const result = await expireQuoteRequest(ctx, actor, id);
  return result.alreadyClosed
    ? done("The request was already closed.")
    : done(`Request expired; ${result.offersExpired} offer(s) withdrawn from play.`);
};

/**
 * One queued message.
 *
 * The payload carries the rendered message rather than the ingredients for it,
 * because rendering happened inside the transaction that decided to send: a
 * confirmation email says what the order was when it was confirmed, not what it
 * has become by the time the queue gets to it. It also carries the only copy of
 * anything secret — a single-use payment link — which is why the `email_sends`
 * row this points at holds the open merge values and nothing else.
 *
 * On a deployment with no email adapter configured the port throws, the send is
 * marked failed and the job retries. That is the honest outcome: the message
 * has not been sent, and both the queue and the screen say so.
 */
const sendEmail: JobHandler = async (ctx, _actor, job) => {
  const { sendId, to, subject, html } = job.payload as {
    sendId?: unknown;
    to?: unknown;
    subject?: unknown;
    html?: unknown;
  };

  if (
    typeof sendId !== "string" ||
    typeof to !== "string" ||
    typeof subject !== "string" ||
    typeof html !== "string"
  ) {
    throw new ValidationError("An email job needs a send, a recipient, a subject and a body.", {
      payload: "invalid",
    });
  }

  const result = await deliverSend(ctx, { sendId, to, subject, html });
  return done(result.detail);
};

export const HANDLERS: Record<JobType, JobHandler> = {
  expire_unpaid: expireUnpaid,
  cooling_window_transfer: coolingWindowTransfer,
  charge_balance: chargeBalanceJob,
  balance_grace_expiry: balanceGraceExpiry,
  auto_complete_order: autoCompleteOrder,
  expire_quote_request: expireQuote,
  send_email: sendEmail,
};

/** What a queued job is going to do, for the admin queue. */
export function describeJob(type: JobType): string {
  switch (type) {
    case "expire_unpaid":
      return "Release an unpaid hold";
    case "cooling_window_transfer":
      return "Transfer deposit share";
    case "charge_balance":
      return "Charge balance";
    case "balance_grace_expiry":
      return "Expire balance grace window";
    case "auto_complete_order":
      return "Auto-complete order";
    case "expire_quote_request":
      return "Expire quote request";
    case "send_email":
      return "Send email";
  }
}
