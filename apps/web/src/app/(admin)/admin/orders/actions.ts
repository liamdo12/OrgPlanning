"use server";

import { revalidatePath } from "next/cache";
import {
  AppError,
  markOrderFulfilled,
  recordDashboardRefund,
  refundCoolingWindow,
  resolveOrderIssue,
  retryBalance,
} from "@occasion/core";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * The order screen's five actions.
 *
 * Every one calls `requireAdminActor()` as its first statement. The layout
 * above these pages redirects a non-admin, but a server action is reachable by
 * a direct POST that renders no layout at all — and the domain checks again,
 * with an object policy on the row, because a role gate does not answer "may
 * this administrator touch *that* order".
 *
 * Each action is audit-logged by the service it calls, with the actor and the
 * role they were acting under. Nothing is logged here, so a screen cannot
 * record a decision the domain did not make.
 */

export type OrderActionState = {
  error?: string;
  message?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The order id off the form, or a refusal.
 *
 * Checked here because the value reaches a `uuid` column, and Postgres raises
 * on a malformed one rather than matching nothing — which is a 500 and a digest
 * where "no such order" is the honest answer. A stale form or a hand-edited
 * POST is the ordinary way that happens.
 */
function orderIdFrom(form: FormData): string {
  const id = readString(form, "orderId");
  if (!UUID.test(id)) throw new AppError("No such order.");
  return id;
}

/**
 * Runs one decision and turns a domain refusal into something readable.
 *
 * Only `AppError` is caught: a refusal is a sentence somebody should read, and
 * anything else is a fault that belongs in the error boundary with a digest
 * rather than paraphrased into a toast.
 */
async function run(work: () => Promise<string>): Promise<OrderActionState> {
  try {
    const message = await work();
    revalidatePath("/admin/orders");
    return { message };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function fulfilOrderAction(
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const change = await markOrderFulfilled(ctx, actor, orderIdFrom(form));
    // The scheduled job is the point of this action, so it is what the message
    // reports: "delivered" alone would not say that the order now completes
    // itself seventy-two hours after the event, which is when the vendor's
    // balance share moves.
    return change.jobsQueued.includes("auto_complete_order")
      ? `${change.reference} is delivered. It completes itself 72 hours after the event, and the balance share transfers then.`
      : `${change.reference} is delivered.`;
  });
}

export async function retryBalanceAction(
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const reference = readString(form, "reference");

  return run(async () => {
    const result = await retryBalance(ctx, actor, orderIdFrom(form));

    if (result.outcome === "captured") {
      return `The balance on ${reference} went through. The order is confirmed again.`;
    }

    // What is true, and no more. A fresh link row is minted, but only its digest
    // is stored and nothing sends it — the email adapter is not implemented in
    // this milestone. Reporting a delivery would have an administrator stop
    // chasing the customer while the grace window ran out on a link nobody
    // holds. The token is deliberately not shown here either: it is a bearer
    // credential for the payment, and this screen is a place screenshots come
    // from.
    return result.linkReissued
      ? `The card was declined again. ${reference} has a renewed payment link, but sending it is not wired up yet — reach the customer another way.`
      : `The card was declined again. ${reference} is still waiting on the customer.`;
  });
}

export async function resolveIssueAction(
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const change = await resolveOrderIssue(
      ctx,
      actor,
      orderIdFrom(form),
      readString(form, "to"),
      readString(form, "note"),
    );
    return `${change.reference} is ${change.to.replaceAll("_", " ")}. Held payouts on it can move again.`;
  });
}

export async function refundAction(
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const reference = readString(form, "reference");

  return run(async () => {
    const refunds = await refundCoolingWindow(ctx, actor, orderIdFrom(form));
    // One refund per charge that held money. An order whose balance fell due
    // inside the window has two, and reporting one would understate what went
    // back.
    const count = refunds.filter((refund) => refund.state !== "requested").length;
    return `${reference} is refunded in full across ${count} ${count === 1 ? "charge" : "charges"}. The date is back on the vendor's calendar.`;
  });
}

export async function recordExternalRefundAction(
  _previous: OrderActionState,
  form: FormData,
): Promise<OrderActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const result = await recordDashboardRefund(ctx, actor, orderIdFrom(form), {
      providerRefundId: readString(form, "providerRefundId").trim(),
      amount: parseAmount(readString(form, "amount")),
      reason: readString(form, "reason"),
    });

    return result.needsAttention
      ? `Recorded ${result.amount}. The vendor's share had already been transferred — reverse it in the Stripe dashboard. The refund is flagged until somebody does.`
      : `Recorded ${result.amount} against this order.`;
  });
}

/**
 * Dollars off a form into cents.
 *
 * Parsed as a decimal string rather than through `Number`: `19.99 * 100` is
 * 1998.9999999999998 in binary floating point, and a refund a cent short is a
 * reconciliation somebody has to chase. The domain then checks the value is
 * within what is still captured.
 */
function parseAmount(value: string): bigint {
  const match = /^\s*\$?\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(value.replace(/,/g, ""));
  if (!match) {
    throw new AppError("Enter the amount in dollars, for example 203.40.");
  }

  const cents = (match[2] ?? "").padEnd(2, "0");
  return BigInt(match[1] as string) * 100n + BigInt(cents);
}
