import { record } from "../audit/service.js";
import * as catalog from "../catalog/repo.js";
import type { CoreContext, DbExecutor } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import {
  assertCanActOnOrder,
  assertCanReadEvent,
  assertCanReadOrder,
  type OrderParties,
} from "../identity/policies.js";
import { isAuthenticated } from "../identity/actor.js";
import { computeOrderMoney } from "../payments/money.js";
import { buildPaymentPlan } from "../payments/plan.js";
import * as repo from "./repo.js";
import {
  DEFAULT_TIMEZONE,
  dueAt,
  eventEndInstant,
  eventStartInstant,
  type ScheduleAnchors,
} from "./schedule.js";
import {
  assertTransition,
  cancelsQueuedJobs,
  jobsCancelledOnLeaving,
  jobsOnEntering,
  releasesCapacity,
  retiresPaymentLinks,
  type OrderState,
} from "./transitions.js";
import { retirePaymentLinks } from "../payments/repo.js";

/**
 * What an order does, and everything that follows from it doing it.
 *
 * The lifecycle is specified once, in `lifecycle.md`, and enforced once, in
 * `transitions.ts`. This module is the third and last piece: the place where a
 * legal move becomes a transaction — the row, its capacity block, its queued
 * work and its audit entry, all together or not at all.
 *
 * `applyTransition` is the only function here that writes a state. Every verb
 * below is a thin wrapper naming the move it makes, which is what keeps "what
 * happens when an order is cancelled" a question with one answer.
 */

/** Rates and windows that come from the platform's settings, not from a caller. */
export type OrderingPolicy = {
  balanceLeadDays: number;
  coolingWindowHours: number;
  /** Below this total the whole amount is taken at checkout. */
  fullPaymentBelow: bigint;
  /** Used when an order carries no policy template. */
  defaultDepositBps: number;
};

export const DEFAULT_ORDERING_POLICY: OrderingPolicy = {
  balanceLeadDays: 14,
  coolingWindowHours: 48,
  fullPaymentBelow: 25_000n,
  defaultDepositBps: 2_000,
};

export type CheckoutLine = {
  serviceId: string;
  servicePackageId?: string | undefined;
  quantity: number;
};

export type CheckoutRequest = {
  eventId: string;
  lines: readonly CheckoutLine[];
  /**
   * The cancellation policy the booking is made under.
   *
   * An id, and only an id. The deposit rate and the free-cancellation window
   * are read from the template it names — a request that could state its own
   * deposit could state a one-cent one, and lock a vendor's date for a C$5,000
   * booking with fifty cents.
   */
  policyTemplateId?: string | undefined;
};

export type CheckoutResult = {
  checkoutId: string;
  orders: Array<{
    id: string;
    reference: string;
    vendorId: string;
    total: bigint;
    depositAmount: bigint;
    balanceAmount: bigint;
    balanceDueAt: Date | null;
  }>;
};

/**
 * Turns a cart into orders in `pending_payment`, one per vendor.
 *
 * Three rules, and each of them is a thing a client must not be trusted with:
 *
 * **Prices come from the catalogue.** The request names services and
 * quantities; every amount is read here. A checkout that accepted an amount
 * would accept a smaller one.
 *
 * **One order per vendor, one charge per order.** An order is a booking with a
 * single business, and its payment row carries a unique provider intent, so a
 * multi-vendor cart is several orders each with its own charge. They share a
 * `transfer_group` so the provider's own dashboard still shows one booking.
 *
 * **The date is held before the money is taken.** The capacity block goes in
 * inside this transaction; if the exclusion constraint refuses it, nobody has
 * been charged, because nothing has been charged yet.
 */
export async function createCheckout(
  ctx: CoreContext,
  actor: Actor,
  request: CheckoutRequest,
  policy: OrderingPolicy = DEFAULT_ORDERING_POLICY,
): Promise<CheckoutResult> {
  if (!isAuthenticated(actor)) {
    throw new ValidationError("A booking needs somebody to belong to.", { actor: "anonymous" });
  }
  if (request.lines.length === 0) {
    throw new ValidationError("A checkout needs at least one service.", { lines: "empty" });
  }
  for (const line of request.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new ValidationError("A quantity must be a whole number, at least one.", {
        quantity: "invalid",
      });
    }
  }

  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const event = await repo.loadEventForOrder(tx, request.eventId);
    if (!event) throw new NotFoundError("No such event.");

    // Somebody else's event is not a thing to book against, and the refusal is
    // a `NotFoundError` for the same reason every other policy's is: success
    // and "forbidden" as different answers would make this an oracle for which
    // event ids exist.
    assertCanReadEvent(actor, { id: event.id, ownerUserId: event.ownerUserId });

    // The terms, read from the policy the booking names rather than taken from
    // the request. `flexible` is 10%, `moderate` 20%, `strict` 30%, and each
    // carries its own free-cancellation window.
    const template = request.policyTemplateId
      ? await repo.loadPolicyTemplate(tx, request.policyTemplateId)
      : undefined;

    if (request.policyTemplateId && !template) {
      throw new NotFoundError("No such cancellation policy.");
    }

    const depositBps = template?.depositBps ?? policy.defaultDepositBps;
    const coolingWindowHours = template?.freeCancellationHours ?? policy.coolingWindowHours;

    const timeZone = event.timezone || DEFAULT_TIMEZONE;
    const eventStart = eventStartInstant(event.eventDate, event.startTime, timeZone);
    const eventEnd = eventEndInstant(event.eventDate, timeZone);

    const priced = await catalog.priceServices(
      tx,
      request.lines.map((line) => line.serviceId),
    );
    const packages = await catalog.pricePackages(
      tx,
      request.lines
        .filter((line) => line.servicePackageId)
        .map((line) => ({
          serviceId: line.serviceId,
          servicePackageId: line.servicePackageId as string,
        })),
    );

    // Grouped by vendor, because an order belongs to one.
    const byVendor = new Map<string, Array<{ line: CheckoutLine; priced: catalog.PricedLine }>>();

    for (const line of request.lines) {
      const service = priced.get(line.serviceId);
      // The same answer for "no such service" and "that vendor is not approved":
      // a suspended business's catalogue must not become a way to learn it
      // exists and has been suspended.
      if (!service || !catalog.bookable(service)) {
        throw new NotFoundError("That service cannot be booked.");
      }

      let description = service.description;
      let unitPrice = service.unitPrice;

      if (line.servicePackageId) {
        const tier = packages.get(line.servicePackageId);
        if (!tier) throw new NotFoundError("That service cannot be booked.");
        description = `${service.description} · ${tier.name}`;
        unitPrice = tier.unitPrice;
      }

      const group = byVendor.get(service.vendorId) ?? [];
      group.push({ line, priced: { ...service, description, unitPrice } });
      byVendor.set(service.vendorId, group);
    }

    const checkout = await repo.insertCheckout(tx, {
      userId: actor.userId,
      eventId: request.eventId,
      draft: {
        lines: request.lines.map((line) => ({ ...line })),
        pricedAt: now.toISOString(),
      },
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    });

    const created: CheckoutResult["orders"] = [];

    for (const [vendorId, group] of byVendor) {
      const items = group.map(({ line, priced: priceLine }) => ({
        serviceId: priceLine.serviceId,
        servicePackageId: line.servicePackageId ?? null,
        description: priceLine.description,
        quantity: line.quantity,
        unitPrice: priceLine.unitPrice,
        lineTotal: priceLine.unitPrice * BigInt(line.quantity),
        currency: priceLine.currency,
      }));

      const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0n);
      const first = group[0]?.priced as catalog.PricedLine;

      // Summing amounts in two currencies produces a number in neither. Nothing
      // in this milestone sells in anything but CAD, which is exactly why a
      // check is cheap now and a migration later.
      if (items.some((item) => item.currency !== first.currency)) {
        throw new ValidationError("A booking cannot mix currencies.", { currency: "mixed" });
      }

      const money = computeOrderMoney({
        subtotal,
        vendorHstRegistered: first.vendorHstRegistered,
        commissionBps: ctx.config.commissionBps,
        hstBps: ctx.config.hstBps,
      });

      const plan = buildPaymentPlan({
        total: money.total,
        now,
        eventStart,
        depositBps,
        balanceLeadDays: policy.balanceLeadDays,
        coolingWindowHours,
        fullPaymentBelow: policy.fullPaymentBelow,
        timeZone,
      });

      const order = await repo.insertOrder(tx, {
        reference: await repo.nextReference(tx),
        userId: actor.userId,
        vendorId,
        eventId: request.eventId,
        subtotal: money.subtotal,
        tax: money.tax,
        total: money.total,
        commission: money.commission,
        commissionTax: money.commissionTax,
        depositAmount: plan.depositAmount,
        balanceAmount: plan.balanceAmount,
        currency: first.currency,
        policyTemplateId: request.policyTemplateId ?? null,
        coolingWindowEndsAt: plan.coolingWindowEndsAt,
        balanceDueAt: plan.balanceDueAt,
        isDemo: false,
      });

      await repo.insertItems(tx, order.id, items);

      // The date, held before anything is charged. A clash surfaces as the
      // exclusion constraint refusing the insert, which rolls the whole
      // checkout back — including the orders already written above.
      for (const { priced: priceLine } of group) {
        await repo.holdCapacity(tx, {
          serviceId: priceLine.serviceId,
          orderId: order.id,
          from: eventStart,
          until: eventEnd,
        });
      }

      // The soft hold's own expiry. Without it an abandoned cart keeps the
      // vendor's date for ever, and no other job would ever free it.
      for (const job of jobsOnEntering("pending_payment", "pending_payment", {
        hasBalance: plan.balanceAmount > 0n,
      })) {
        await repo.enqueue(tx, {
          type: job.type,
          orderId: order.id,
          runAfter: dueAt(job, { now, eventStart, eventEnd, timeZone }),
          payload: { orderId: order.id },
          isDemo: order.isDemo,
        });
      }

      await record(
        ctx,
        actor,
        {
          action: "order.create",
          entityType: "order",
          entityId: order.id,
          after: {
            reference: order.reference,
            total: money.total.toString(),
            state: "pending_payment",
          },
        },
        tx,
      );

      created.push({
        id: order.id,
        reference: order.reference,
        vendorId,
        total: money.total,
        depositAmount: plan.depositAmount,
        balanceAmount: plan.balanceAmount,
        balanceDueAt: plan.balanceDueAt,
      });
    }

    return { checkoutId: checkout.id, orders: created };
  });
}

/** What a transition did, so a caller can say so rather than guess. */
export type OrderChange = {
  orderId: string;
  reference: string;
  from: OrderState;
  to: OrderState;
  /** Dates freed by this move. */
  capacityReleased: number;
  /** Work queued by it. */
  jobsQueued: string[];
  /** Work it called off. */
  jobsCancelled: number;
  /** Emailed payment links it retired. */
  linksRetired: number;
};

/** The deadlines this move set, for a caller that has to match them. */
export type TransitionDates = {
  graceExpiresAt: Date | null;
  autoCompleteAt: Date | null;
};

export type TransitionOptions = {
  /** Recorded on the audit entry, so a screen can say why. */
  action: string;
  issueNote?: string | null;
  /**
   * Runs inside the same transaction, after the state is written.
   *
   * It receives the deadlines the move computed, so that something written
   * alongside it — a payment link racing the grace window, say — carries the
   * same instant rather than a second reading of the clock that is a few
   * milliseconds out.
   */
  also?: (tx: DbExecutor, order: repo.OrderRow, dates: TransitionDates) => Promise<void>;
};

/**
 * Moves an order, with every consequence of the move in the same transaction.
 *
 * The order is locked before its state is read, which is what stops a webhook
 * and an admin action both finding the same move legal and both applying its
 * effects. Everything after the lock is decided by the lifecycle tables rather
 * than by the caller: which jobs are queued, whether queued work is called off,
 * and whether the date goes back on the market.
 */
export async function applyTransition(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  to: OrderState,
  options: TransitionOptions,
): Promise<OrderChange> {
  return ctx.db.transaction(async (tx) => {
    const order = await repo.loadForUpdate(tx, orderId);
    if (!order) throw new NotFoundError("No such order.");

    assertTransition(order.state, to);

    const anchors = await anchorsFor(tx, ctx, order);
    const scheduled = jobsOnEntering(order.state, to, {
      hasBalance: order.balanceAmount > 0n,
    }).map((job) => ({ job, runAfter: dueAt(job, anchors) }));

    // The order's own date columns are the scheduled work, mirrored. Computing
    // them here rather than at each call site is what stops a screen showing a
    // grace deadline that no job is actually working to.
    const grace = scheduled.find(({ job }) => job.type === "balance_grace_expiry");
    const autoComplete = scheduled.find(({ job }) => job.type === "auto_complete_order");

    await repo.setState(tx, orderId, to, {
      now: ctx.clock.now(),
      ...(options.issueNote === undefined ? {} : { issueNote: options.issueNote }),
      ...(grace ? { graceExpiresAt: grace.runAfter } : {}),
      ...(autoComplete ? { autoCompleteAt: autoComplete.runAfter } : {}),
      // Leaving `action_required` means the deadline it was racing is over.
      ...(order.state === "action_required" && to !== "action_required"
        ? { graceExpiresAt: null }
        : {}),
    });

    const jobsQueued: string[] = [];
    for (const { job, runAfter } of scheduled) {
      const inserted = await repo.enqueue(tx, {
        type: job.type,
        orderId: order.id,
        runAfter,
        payload: { orderId: order.id },
        isDemo: order.isDemo,
      });
      if (inserted) jobsQueued.push(job.type);
    }

    let jobsCancelled = 0;
    if (cancelsQueuedJobs(to)) {
      jobsCancelled = await repo.cancelQueuedJobs(tx, orderId, {
        reason: `Order became ${to}.`,
      });
    } else {
      // Work that stops being due because the order has moved on. Leaving
      // `pending_payment` is not an ending, so the rule above does not cover
      // it, and the job whose whole purpose is "cancel this if nobody has paid"
      // would otherwise still be due against an order somebody has just paid for.
      const stale = jobsCancelledOnLeaving(order.state);
      if (stale.length > 0) {
        jobsCancelled = await repo.cancelQueuedJobs(tx, orderId, {
          reason: `Order left ${order.state}.`,
          types: stale,
        });
      }
    }

    let capacityReleased = 0;
    if (releasesCapacity(to)) {
      // The rule the red team found nowhere: every way an order ends without
      // being delivered puts the date back on the market.
      capacityReleased = await repo.releaseCapacity(tx, orderId);
    }

    let linksRetired = 0;
    if (retiresPaymentLinks(order.state, to)) {
      // A link outlives its purpose the moment the order stops waiting for one.
      // Doing this here rather than in the balance path is what closes the two
      // ways it used to survive: a balance that succeeded on a later attempt,
      // and an administrator cancelling an order that was still waiting.
      linksRetired = await retirePaymentLinks(
        tx,
        orderId,
        ctx.clock.realNow(),
        to === "confirmed" ? "paid" : "void",
      );
    }

    await options.also?.(tx, order, {
      graceExpiresAt: grace?.runAfter ?? null,
      autoCompleteAt: autoComplete?.runAfter ?? null,
    });

    await record(
      ctx,
      actor,
      {
        action: options.action,
        entityType: "order",
        entityId: orderId,
        before: { state: order.state },
        after: { state: to },
      },
      tx,
    );

    return {
      orderId,
      reference: order.reference,
      from: order.state,
      to,
      capacityReleased,
      jobsQueued,
      jobsCancelled,
      linksRetired,
    };
  });
}

/** The instants this order's scheduled work is measured from. */
async function anchorsFor(
  tx: DbExecutor,
  ctx: CoreContext,
  order: repo.OrderRow,
): Promise<ScheduleAnchors> {
  const now = ctx.clock.now();

  if (!order.eventId) {
    // An order with no event has no calendar to hang dates off. Only the
    // elapsed-time offsets can be honoured, and anchoring those to `now` is
    // what the lifecycle says they mean anyway.
    return { now, eventStart: now, eventEnd: now, timeZone: DEFAULT_TIMEZONE };
  }

  const event = await repo.loadEventForOrder(tx, order.eventId);
  if (!event) return { now, eventStart: now, eventEnd: now, timeZone: DEFAULT_TIMEZONE };

  const timeZone = event.timezone || DEFAULT_TIMEZONE;
  return {
    now,
    eventStart: eventStartInstant(event.eventDate, event.startTime, timeZone),
    eventEnd: eventEndInstant(event.eventDate, timeZone),
    timeZone,
  };
}

/**
 * Marks an order delivered.
 *
 * An admin action this milestone, a vendor one later. It has a real caller here
 * on purpose: the auto-complete path is what releases the balance share, and a
 * lifecycle whose only entry into `fulfilled` is a seeded row is one nobody has
 * ever actually run.
 */
export async function markFulfilled(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<OrderChange> {
  assertCanActOnOrder(actor, await parties(ctx, orderId));
  return applyTransition(ctx, actor, orderId, "fulfilled", { action: "order.fulfil" });
}

/**
 * Finishes an order nobody raised a problem with.
 *
 * Runs from the `auto_complete_order` job, seventy-two hours after the event
 * ended. It takes no actor because nobody pressed anything — the audit entry
 * records the system, which is the honest answer to "who completed this".
 */
export async function autoComplete(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<OrderChange> {
  assertCanActOnOrder(actor, await parties(ctx, orderId));
  return applyTransition(ctx, actor, orderId, "completed", { action: "order.auto_complete" });
}

/** Flags a booking for a person to look at. Pauses payouts by state alone. */
export async function raiseIssue(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  note: string,
): Promise<OrderChange> {
  const trimmed = note.trim();
  if (!trimmed) {
    throw new ValidationError("Say what the problem is.", { note: "required" });
  }

  assertCanActOnOrder(actor, await parties(ctx, orderId));
  return applyTransition(ctx, actor, orderId, "issue", {
    action: "order.raise_issue",
    issueNote: trimmed.slice(0, 500),
  });
}

/** Resolves an issue back to whichever state the booking continues in. */
export async function resolveIssue(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  to: Extract<OrderState, "confirmed" | "fulfilled" | "cancelled">,
): Promise<OrderChange> {
  assertCanActOnOrder(actor, await parties(ctx, orderId));
  return applyTransition(ctx, actor, orderId, to, {
    action: "order.resolve_issue",
    issueNote: null,
  });
}

/** Ends a booking. The refund, if there is one, is the payments domain's call. */
export async function cancelOrder(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
  action = "order.cancel",
): Promise<OrderChange> {
  assertCanActOnOrder(actor, await parties(ctx, orderId));
  return applyTransition(ctx, actor, orderId, "cancelled", { action });
}

export type OrderDetail = {
  order: repo.OrderRow;
  items: Awaited<ReturnType<typeof repo.listItems>>;
  jobs: Awaited<ReturnType<typeof repo.listJobsForOrder>>;
  capacity: Awaited<ReturnType<typeof repo.listCapacityBlocks>>;
};

/** One order, for whoever is a party to it. */
export async function getOrder(
  ctx: CoreContext,
  actor: Actor,
  orderId: string,
): Promise<OrderDetail> {
  assertCanReadOrder(actor, await parties(ctx, orderId));

  const order = await repo.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");

  const [items, jobs, capacity] = await Promise.all([
    repo.listItems(ctx.db, orderId),
    repo.listJobsForOrder(ctx.db, orderId),
    repo.listCapacityBlocks(ctx.db, orderId),
  ]);

  return { order, items, jobs, capacity };
}

/**
 * Who an order belongs to, for the object policies.
 *
 * Every entry point that names an order id goes through this before it reads or
 * writes anything: a role check answers "an admin may use this", not "this
 * person may touch that row", and a vendor reading another vendor's order by id
 * is the failure that distinction exists to stop.
 */
async function parties(ctx: CoreContext, orderId: string): Promise<OrderParties> {
  const order = await repo.load(ctx.db, orderId);
  if (!order) throw new NotFoundError("No such order.");
  return { id: order.id, userId: order.userId, vendorId: order.vendorId };
}
