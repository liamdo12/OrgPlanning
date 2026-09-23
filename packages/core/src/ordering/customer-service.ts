import type { CoreContext } from "../context.js";
import { NotFoundError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import { assertCanPayOrder, assertCanReadOrder } from "../identity/policies.js";
import { requireUser } from "../identity/service.js";
import * as paymentsRepo from "../payments/repo.js";
import * as customerRepo from "./customer-repo.js";
import * as repo from "./repo.js";
import { dedupeKey } from "./repo.js";
import { rearmQueuedJob } from "../jobs/repo.js";
import { parties } from "./service.js";
import { canTransition, type OrderState } from "./transitions.js";

/**
 * A customer's own bookings.
 *
 * Its own module because the three functions that already read an order refuse
 * the one person whose card paid for it. `getOrderMoney` and `cancelOrder` ask
 * `assertCanActOnOrder`, which admits the vendor's staff and an administrator
 * and nobody else — widening it would hand every customer `markFulfilled` on
 * their own booking, which releases the vendor's share of the money.
 *
 * So these read under `assertCanReadOrder`, and the one thing here that touches
 * a deadline asks `assertCanPayOrder` — the customer-and-administrator policy.
 * Cancelling is not here at all: `refundWithinCoolingWindow` already is that
 * function, already asserts the same policy and already gives the money back,
 * and a second implementation of it would be a second answer to "what happens
 * when a customer cancels".
 *
 * **Two reads, not four.** The detail screen, the confirmation screen and the
 * calendar file all want the same bounded picture of one booking, so they share
 * one function rather than making three round trips and needing three matrix
 * rows for one authorization decision.
 */

/** How many bookings a list answers with when the caller does not say. */
const DEFAULT_LIMIT = 50;
/** The ceiling, so a caller cannot turn a bounded read into a table scan. */
const MAX_LIMIT = 200;

export type CustomerOrderRow = customerRepo.CustomerOrderRow;

export type CustomerPayment = {
  id: string;
  kind: paymentsRepo.PaymentKind;
  state: paymentsRepo.PaymentState;
  amount: bigint;
  currency: string;
  /** The last four digits of the card, when the provider reported them. */
  cardLast4: string | null;
  succeededAt: Date | null;
};

export type CustomerRefund = {
  id: string;
  amount: bigint;
  currency: string;
  /** `requested` is money on its way; the screen says so rather than "refunded". */
  state: paymentsRepo.RefundRow["state"];
  settledAt: Date | null;
};

export type CustomerOrderDetail = {
  order: customerRepo.CustomerOrderHead;
  items: Awaited<ReturnType<typeof repo.listItems>>;
  /**
   * Payments, refunds and what is actually held — and **no transfers**.
   *
   * `getOrderMoney` returns the vendor's payouts and the platform's commission
   * because an administrator reconciling a booking needs them. What a vendor is
   * paid is not the customer's business, and a projection that carried it would
   * put it one render away from the screen.
   */
  money: {
    payments: CustomerPayment[];
    refunds: CustomerRefund[];
    /** Taken, less anything already given back. */
    captured: bigint;
  };
  /** Whether cancelling now is free, and until when. */
  freeCancellation: { open: boolean; endsAt: Date | null };
};

/**
 * Every booking of the caller's, newest first.
 *
 * Takes no entity id, so there is no object policy to call: the query is keyed
 * on the caller's own user id, which is the guarantee. `requireUser` is still
 * the gate — a suspended account reading its own bookings is an account acting,
 * and every other entry point in this domain refuses one.
 */
export async function listOrdersForCustomer(
  ctx: CoreContext,
  actor: Actor,
  options: { limit?: number | undefined; eventId?: string | undefined } = {},
): Promise<CustomerOrderRow[]> {
  const user = requireUser(actor);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  return options.eventId
    ? customerRepo.listForCustomerEvent(ctx.db, user.userId, options.eventId, limit)
    : customerRepo.listForCustomer(ctx.db, user.userId, limit);
}

/**
 * One booking, with everything the customer's own screens say about it.
 *
 * `assertCanReadOrder`, which admits the customer, the vendor's staff and an
 * administrator. That is wider than "the customer whose card it is" on purpose:
 * it is the read policy, the projection carries nothing a vendor may not see,
 * and a narrower one here would mean a second read for the vendor screens that
 * are coming.
 */
export async function getOrderForCustomer(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<CustomerOrderDetail> {
  assertCanReadOrder(actor, await parties(ctx, orderId));

  const order = await customerRepo.loadForCustomer(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  const [items, payments, refunds, captured] = await Promise.all([
    repo.listItems(ctx.db, orderId),
    paymentsRepo.listPayments(ctx.db, orderId),
    paymentsRepo.listRefunds(ctx.db, orderId),
    paymentsRepo.netCaptured(ctx.db, orderId),
  ]);

  return {
    order,
    items,
    money: {
      payments: payments.map((payment) => ({
        id: payment.id,
        kind: payment.kind,
        state: payment.state,
        amount: payment.amount,
        currency: payment.currency,
        cardLast4: payment.cardLast4,
        succeededAt: payment.succeededAt,
      })),
      refunds: refunds.map((refund) => ({
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        state: refund.state,
        settledAt: refund.settledAt,
      })),
      captured,
    },
    freeCancellation: freeCancellation(order.state, order.coolingWindowEndsAt, ctx.clock.now()),
  };
}

/**
 * Whether the customer can still call this off for nothing.
 *
 * Both halves matter. The window is what `refundWithinCoolingWindow` checks, so
 * a screen offering the button outside it offers a refusal; and the state is
 * what makes the offer meaningful — a booking that has already been cancelled
 * or refunded has nothing left to cancel.
 */
function freeCancellation(
  state: OrderState,
  endsAt: Date | null,
  now: Date,
): { open: boolean; endsAt: Date | null } {
  const cancellable = canTransition(state, "cancelled");
  const inWindow = endsAt !== null && endsAt.getTime() > now.getTime();

  return { open: cancellable && inWindow, endsAt };
}

/**
 * Pushes the unpaid-expiry deadline out, because the customer is paying now.
 *
 * The expiry is queued for `now + 30 minutes` when the order opens, and a
 * customer interrupted by a slow 3DS challenge comes back to an order the job
 * has already cancelled — their card is then charged against a booking whose
 * date has gone back on the vendor's calendar. Re-arming when the client secret
 * is handed out narrows that to the length of one payment attempt.
 *
 * **It only ever moves the deadline later**, which is `rearmQueuedJob`'s own
 * `greatest`: a second attempt cannot pull an expiry forward, and a job the
 * runner has already claimed is left alone. Nothing is created — an order whose
 * expiry has already fired has no `queued` row to find, and answering with
 * nothing is the truth rather than a fault.
 *
 * `assertCanPayOrder`: extending the time to pay is part of paying, so it is
 * the customer whose card it is, or an administrator helping them.
 */
export async function extendCheckoutWindow(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<{ runAfter: Date | null }> {
  assertCanPayOrder(actor, await parties(ctx, orderId));

  const runAfter = await rearmQueuedJob(ctx.db, {
    type: "expire_unpaid",
    dedupeKey: dedupeKey("expire_unpaid", orderId),
    runAfter: new Date(ctx.clock.now().getTime() + CHECKOUT_WINDOW_MINUTES * 60_000),
  });

  return { runAfter: runAfter ?? null };
}

/**
 * How long a customer has from being handed a client secret.
 *
 * The same thirty minutes the lifecycle gives a new order, because it is the
 * same question — how long a date may be held for somebody who has not paid.
 */
const CHECKOUT_WINDOW_MINUTES = 30;
