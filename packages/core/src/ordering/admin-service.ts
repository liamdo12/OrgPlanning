import type { CoreContext } from "../context.js";
import { closeDisputesForOrder } from "../disputes/service.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import { assertCanActOnOrder, assertCanReadOrder } from "../identity/policies.js";
import { requireAdmin } from "../identity/service.js";
import { formatMoney } from "../payments/money.js";
import * as paymentsRepo from "../payments/repo.js";
import {
  chargeBalance,
  recordExternalRefund,
  refundWithinCoolingWindow,
} from "../payments/service.js";
import * as adminRepo from "./admin-repo.js";
import { paymentLabel, type PaymentLabel } from "./payment-label.js";
import * as repo from "./repo.js";
import { eventStartInstant, DEFAULT_TIMEZONE } from "./schedule.js";
import * as ordering from "./service.js";
import { canTransition, parseOrderState, type OrderState } from "./transitions.js";

/**
 * The orders screen.
 *
 * Reading is administrative and so is every action, so `requireAdmin` comes
 * first everywhere — and then an object policy anyway, because a role gate
 * answers "an administrator may use this" and not "this administrator may touch
 * that row". The second check is what a later vendor-facing screen will reuse
 * when it calls the same services with a different actor.
 *
 * Nothing here moves money itself. Each action is the admin-facing name for a
 * move the lifecycle or the payments domain already owns, and the reason for
 * the layer is the opposite of delegation for its own sake: it is where a
 * screen finds out **which** of those moves are legal on a given order, so a
 * button is never drawn for something the service below would refuse.
 */

export type AdminOrderListItem = {
  id: string;
  reference: string;
  state: OrderState;
  /** The prototype's own spellings, line 2723 onwards. */
  stateLabel: string;
  /** `Bloom & Co · Sarah's 30th` — the prototype's second column, line 1799. */
  who: string;
  total: string;
  currency: string;
  payment: PaymentLabel;
  vendorId: string;
  vendorName: string;
  eventName: string | null;
  customerName: string;
  customerEmail: string;
  placedAt: Date;
};

export type AdminOrderList = {
  rows: AdminOrderListItem[];
  nextCursor?: string | undefined;
  total: number;
};

export type OrderFilters = {
  state?: string | undefined;
  payment?: string | undefined;
  vendorId?: string | undefined;
  /** `YYYY-MM-DD`, inclusive, read in the platform's timezone. */
  from?: string | undefined;
  /** `YYYY-MM-DD`, inclusive. */
  to?: string | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
};

/**
 * How a state is spelled on screen.
 *
 * `action req.` is the prototype's own abbreviation (line 2726) and it is kept
 * because the column it sits in is narrow; the rest are the state names with
 * their underscores removed. The mapping lives here rather than in the web app
 * so the vendor and customer views cannot invent a second spelling of the same
 * state.
 */
export function orderStateLabel(state: OrderState): string {
  if (state === "action_required") return "action req.";
  return state.replaceAll("_", " ");
}

/**
 * The filters, narrowed off the query string.
 *
 * An unrecognised value is dropped rather than refused, the same reading as the
 * account list: these arrive in a URL somebody may have edited or a link that
 * outlived a rename, and the whole list is a better answer than an error page.
 * A malformed date is the one exception — silently ignoring it would show every
 * order under a heading claiming a range.
 */
function narrowFilters(filters: OrderFilters): adminRepo.OrderListOptions {
  const state = ORDER_STATE_VALUES.find((value) => value === filters.state);
  const payment = adminRepo.PAYMENT_FILTERS.find((value) => value === filters.payment);
  const vendorId = UUID.test(filters.vendorId ?? "") ? filters.vendorId : undefined;

  return {
    ...(state ? { state } : {}),
    ...(payment ? { payment } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(filters.from ? { from: dayStart(filters.from, "from") } : {}),
    // The end of the named day rather than its start, so "to 18 September"
    // includes the orders placed that afternoon. The repository's condition is
    // `<`, so this is the following midnight.
    ...(filters.to ? { to: dayStart(nextDay(filters.to), "to") } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATE_VALUES = [
  "pending_payment",
  "confirmed",
  "balance_due",
  "action_required",
  "issue",
  "fulfilled",
  "completed",
  "cancelled",
  "refunded",
] as const satisfies readonly OrderState[];

/**
 * Local midnight on a named day, in the platform's timezone.
 *
 * Toronto rather than UTC: an administrator filtering "orders placed on the
 * 18th" means their own day, and the two differ for every order placed between
 * seven in the evening and midnight.
 */
function dayStart(day: string, field: string): Date {
  if (!DAY.test(day)) {
    throw new ValidationError(`A date must be YYYY-MM-DD, got ${day}.`, { [field]: "invalid" });
  }
  return eventStartInstant(day, null, DEFAULT_TIMEZONE);
}

function nextDay(day: string): string {
  if (!DAY.test(day)) return day;
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function toListItem(row: adminRepo.AdminOrderRow): AdminOrderListItem {
  return {
    id: row.id,
    reference: row.reference,
    state: row.state,
    stateLabel: orderStateLabel(row.state),
    who: [row.vendorName, row.eventName].filter(Boolean).join(" · "),
    total: formatMoney(row.total, row.currency),
    currency: row.currency,
    payment: paymentLabel({
      total: row.total,
      captured: row.captured,
      returned: row.returned,
      balanceFailed: row.balanceFailed,
      currency: row.currency,
    }),
    vendorId: row.vendorId,
    vendorName: row.vendorName,
    eventName: row.eventName,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    placedAt: row.createdAt,
  };
}

export async function listOrdersForAdmin(
  ctx: CoreContext,
  actor: Actor,
  filters: OrderFilters = {},
): Promise<AdminOrderList> {
  requireAdmin(actor);

  const page = await adminRepo.listForAdmin(ctx, narrowFilters(filters));

  return {
    rows: page.rows.map(toListItem),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    total: page.total,
  };
}

/** The businesses the vendor filter offers. */
export async function listOrderVendors(
  ctx: CoreContext,
  actor: Actor,
): Promise<adminRepo.VendorOption[]> {
  requireAdmin(actor);
  return adminRepo.listVendorOptions(ctx);
}

/** The money, in the order the checkout summary shows it (lines 1172–1178). */
export type OrderMoneyBreakdown = {
  subtotal: string;
  tax: string;
  total: string;
  commission: string;
  commissionTax: string;
  vendorShare: string;
  deposit: string;
  balance: string;
  /** What has actually been taken, net of what went back. */
  netCaptured: string;
  netCapturedCents: bigint;
};

/** Which of the five actions this order can currently take. */
export type OrderActions = {
  fulfil: boolean;
  retryBalance: boolean;
  resolveIssue: boolean;
  refundInApp: boolean;
  /** Why the in-app refund is unavailable, when it is. */
  refundBlocked: string | null;
  recordExternalRefund: boolean;
  /** The states `resolveIssue` may move this order to. */
  resolutions: OrderState[];
};

export type AdminOrderDetail = {
  order: AdminOrderListItem;
  money: OrderMoneyBreakdown;
  items: Awaited<ReturnType<typeof repo.listItems>>;
  payments: paymentsRepo.PaymentRow[];
  transfers: paymentsRepo.TransferRow[];
  refunds: paymentsRepo.RefundRow[];
  jobs: Awaited<ReturnType<typeof repo.listJobsForOrder>>;
  capacity: Awaited<ReturnType<typeof repo.listCapacityBlocks>>;
  policy: adminRepo.PolicyRow | undefined;
  audit: adminRepo.AuditRow[];
  customer: { id: string; name: string; email: string };
  vendor: { id: string; name: string; status: string; payoutsEnabledAt: Date | null };
  event: { id: string; name: string; date: string } | null;
  dates: {
    coolingWindowEndsAt: Date | null;
    balanceDueAt: Date | null;
    graceExpiresAt: Date | null;
    autoCompleteAt: Date | null;
    fulfilledAt: Date | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
  };
  issueNote: string | null;
  actions: OrderActions;
};

/**
 * One order, in full.
 *
 * Everything on it is already in this database — no provider call is made here,
 * for the same reason the list makes none: an administrator opening six records
 * would otherwise make six round trips to Stripe, and the screen would be slow
 * exactly when somebody is in a hurry. The mirrored columns are what
 * `refreshConnectStatus` and the webhooks keep honest.
 */
export async function getOrderDetail(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<AdminOrderDetail> {
  requireAdmin(actor);
  if (!UUID.test(orderId)) throw new NotFoundError("No such order.");

  const row = await adminRepo.loadForAdmin(ctx, orderId);
  if (!row) throw new NotFoundError("No such order.");

  // The object policy, on the row that was actually loaded. An administrator
  // passes it; a vendor calling this one day would be refused another vendor's
  // order here rather than by the role gate above.
  assertCanReadOrder(actor, { id: row.id, userId: row.customerId, vendorId: row.vendorId });

  const order = await repo.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  const [items, jobs, capacity, payments, transfers, refunds, policy, audit] = await Promise.all([
    repo.listItems(ctx.db, orderId),
    repo.listJobsForOrder(ctx.db, orderId),
    repo.listCapacityBlocks(ctx.db, orderId),
    paymentsRepo.listPayments(ctx.db, orderId),
    paymentsRepo.listTransfers(ctx.db, orderId),
    paymentsRepo.listRefunds(ctx.db, orderId),
    adminRepo.loadPolicy(ctx, orderId),
    adminRepo.listAudit(ctx, orderId),
  ]);

  const netCaptured = row.captured - row.returned;

  return {
    order: toListItem(row),
    money: {
      subtotal: formatMoney(order.subtotal, order.currency),
      tax: formatMoney(order.tax, order.currency),
      total: formatMoney(order.total, order.currency),
      commission: formatMoney(order.commission, order.currency),
      commissionTax: formatMoney(order.commissionTax, order.currency),
      // Read off the stored amounts rather than recomputed from the subtotal:
      // inverting a rounded tax rate is not lossless, so a recomputed total can
      // land a cent away from the one the customer agreed to.
      vendorShare: formatMoney(
        order.total - order.commission - order.commissionTax,
        order.currency,
      ),
      deposit: formatMoney(order.depositAmount, order.currency),
      balance: formatMoney(order.balanceAmount, order.currency),
      netCaptured: formatMoney(netCaptured, order.currency),
      netCapturedCents: netCaptured,
    },
    items,
    payments,
    transfers,
    refunds,
    jobs,
    capacity,
    policy,
    audit,
    customer: { id: row.customerId, name: row.customerName, email: row.customerEmail },
    vendor: {
      id: row.vendorId,
      name: row.vendorName,
      status: row.vendorStatus,
      payoutsEnabledAt: row.vendorPayoutsEnabledAt,
    },
    event:
      row.eventId && row.eventName && row.eventDate
        ? { id: row.eventId, name: row.eventName, date: row.eventDate }
        : null,
    dates: {
      coolingWindowEndsAt: order.coolingWindowEndsAt,
      balanceDueAt: order.balanceDueAt,
      graceExpiresAt: order.graceExpiresAt,
      autoCompleteAt: order.autoCompleteAt,
      fulfilledAt: order.fulfilledAt,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
    },
    issueNote: order.issueNote,
    actions: actionsFor(ctx, order, { netCaptured, transfers }),
  };
}

/**
 * Which actions this order can take, decided by the same rules the services
 * apply.
 *
 * Every one of these is checked again below and in the lifecycle — this decides
 * what to *draw*, not what to allow. Drawing a button the service would refuse
 * is how a screen teaches people it is broken, which is the reason the two are
 * derived from the same tables rather than from a list somebody keeps in step.
 */
function actionsFor(
  ctx: CoreContext,
  order: repo.OrderRow,
  position: { netCaptured: bigint; transfers: paymentsRepo.TransferRow[] },
): OrderActions {
  const now = ctx.clock.now();

  const resolutions = (["confirmed", "fulfilled", "cancelled"] as const).filter((to) =>
    canTransition(order.state, to),
  );

  const windowOpen = Boolean(
    order.coolingWindowEndsAt && order.coolingWindowEndsAt.getTime() > now.getTime(),
  );
  const depositShare = position.transfers.find((transfer) => transfer.kind === "deposit_share");
  const paidOut = depositShare?.state === "paid";

  const refundBlocked = paidOut
    ? "The deposit share has already been transferred. Reverse it in the Stripe dashboard and record the refund here."
    : !windowOpen
      ? "The free cancellation window has closed. Refund this in the Stripe dashboard and record it here."
      : position.netCaptured <= 0n
        ? "Nothing has been captured on this order."
        : null;

  return {
    // Not while the order is flagged, even though the lifecycle allows
    // `issue → fulfilled`. Resolving an issue requires a note saying what
    // happened; a "Mark fulfilled" button beside it is a way out of `issue`
    // that records nothing, which defeats the requirement rather than
    // satisfying it. The resolve dialog offers `fulfilled` as a destination,
    // with the note.
    fulfil: order.state !== "issue" && canTransition(order.state, "fulfilled"),
    // A retry is only meaningful while an order is waiting for a balance it has
    // not got. `payoutAllowed` is not the question here — a confirmed order
    // whose balance is not yet due has nothing to retry.
    retryBalance: order.balanceAmount > 0n && order.state === "action_required",
    resolveIssue: order.state === "issue",
    refundInApp: refundBlocked === null && !isFinished(order.state),
    refundBlocked: isFinished(order.state) ? null : refundBlocked,
    recordExternalRefund: position.netCaptured > 0n,
    resolutions: [...resolutions],
  };
}

/** Whether there is nothing left for an administrator to decide. */
function isFinished(state: OrderState): boolean {
  return state === "refunded" || state === "cancelled";
}

/**
 * Marks an order delivered.
 *
 * The caller the auto-complete path needs: entering `fulfilled` is what
 * schedules `auto_complete_order` at `event_end + 72h`, and a lifecycle whose
 * only route into that state is a seeded row is one nobody has ever run.
 */
export async function markOrderFulfilled(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<ordering.OrderChange> {
  requireAdmin(actor);
  return ordering.markFulfilled(ctx, actor, orderId);
}

export type RetryBalanceResult = {
  outcome: "captured" | "action_required";
  /** A fresh link went out; the token itself is not returned to this screen. */
  linkReissued: boolean;
};

/**
 * Charges a declined balance again.
 *
 * The same off-session path the job runs, with the same attempt-row
 * idempotency, so pressing this twice cannot charge twice: a `pending` attempt
 * is adopted rather than reopened, and its id is the provider's key.
 *
 * The link minted by a second decline is deliberately **not** returned. It is a
 * bearer credential for a payment — whoever holds it can complete the charge —
 * and it reaches the customer by email. Putting it on an admin screen would put
 * it in a screenshot, a support ticket and a browser history.
 */
export async function retryBalance(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<RetryBalanceResult> {
  requireAdmin(actor);

  const order = await repo.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");
  assertCanActOnOrder(actor, { id: order.id, userId: order.userId, vendorId: order.vendorId });

  if (order.state !== "action_required") {
    throw new ValidationError(
      `Only an order waiting on a declined balance can be retried. This one is ${orderStateLabel(order.state)}.`,
      { state: "illegal" },
    );
  }

  const result = await chargeBalance(ctx, actor, orderId);
  return { outcome: result.outcome, linkReissued: Boolean(result.link) };
}

/**
 * Closes an issue and says how.
 *
 * Payouts resume by state alone: `payoutAllowed` refuses `issue` and admits
 * `confirmed`, so the transfer a held order was waiting on becomes payable the
 * moment this lands. Nothing here has to un-hold anything.
 */
export async function resolveOrderIssue(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  to: string,
  note: string,
): Promise<ordering.OrderChange> {
  requireAdmin(actor);

  const target = parseOrderState(to);
  if (target !== "confirmed" && target !== "fulfilled" && target !== "cancelled") {
    throw new ValidationError("An issue is resolved to confirmed, fulfilled or cancelled.", {
      to: "illegal",
    });
  }

  return ctx.db.transaction(async (tx) => {
    const scoped: CoreContext = { ...ctx, db: tx as unknown as CoreContext["db"] };

    const change = await ordering.resolveIssue(scoped, actor, orderId, target, note);

    // The complaints queue is the other half of this move. An administrator can
    // take a booking out of `issue` from this screen without ever opening the
    // queue, and a case left open against an order that has moved on is an
    // entry nobody can action — the thing it was about is settled.
    await closeDisputesForOrder(scoped, actor, orderId, note, tx);

    return change;
  });
}

/**
 * The cooling-window refund: the one this milestone performs in-app.
 *
 * Fixed and full, with no amount field, which is what makes it safe to expose
 * without the override authority a partial refund would need. Everything else
 * is done in the provider's dashboard and recorded below.
 */
export async function refundCoolingWindow(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<paymentsRepo.RefundRow[]> {
  requireAdmin(actor);

  await refundWithinCoolingWindow(ctx, actor, orderId);
  return paymentsRepo.listRefunds(ctx.db, orderId);
}

/** Records a refund an administrator made in the provider's dashboard. */
export async function recordDashboardRefund(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  input: { providerRefundId: string; amount: bigint; reason: string },
): Promise<{ amount: string; needsAttention: boolean }> {
  requireAdmin(actor);

  const order = await repo.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");
  // The object policy, like every sibling action. `recordExternalRefund` gates
  // on the admin role alone, and the rule this repo documents has no admin
  // exemption — the day a vendor-facing screen reuses this path, a role check
  // would hand one vendor another's order.
  assertCanActOnOrder(actor, { id: order.id, userId: order.userId, vendorId: order.vendorId });

  const result = await recordExternalRefund(ctx, actor, orderId, input);

  return {
    amount: formatMoney(result.amount, order.currency),
    needsAttention: result.state === "needs_attention",
  };
}
