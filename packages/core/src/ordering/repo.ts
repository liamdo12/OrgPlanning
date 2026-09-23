import { and, eq, inArray, sql } from "drizzle-orm";
import {
  capacityBlocks,
  checkouts,
  events,
  jobs,
  orderItems,
  orders,
  payments,
  policyTemplates,
} from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";
import * as scheduler from "../jobs/repo.js";
import type { OrderState, ScheduledJobType } from "./transitions.js";

/**
 * Database access for orders.
 *
 * Every function takes an executor, because a state change is one transaction:
 * the row, its capacity block, its queued jobs and its audit entry either all
 * land or none of them do. A booking that is cancelled but still holding the
 * vendor's date is the failure this shape exists to prevent.
 */

export type OrderRow = {
  id: string;
  reference: string;
  userId: string;
  vendorId: string;
  eventId: string | null;
  state: OrderState;
  subtotal: bigint;
  tax: bigint;
  total: bigint;
  commission: bigint;
  commissionTax: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  currency: string;
  coolingWindowEndsAt: Date | null;
  balanceDueAt: Date | null;
  graceExpiresAt: Date | null;
  autoCompleteAt: Date | null;
  fulfilledAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  issueNote: string | null;
  isDemo: boolean;
};

const orderColumns = {
  id: orders.id,
  reference: orders.reference,
  userId: orders.userId,
  vendorId: orders.vendorId,
  eventId: orders.eventId,
  state: orders.state,
  subtotal: orders.subtotal,
  tax: orders.tax,
  total: orders.total,
  commission: orders.commission,
  commissionTax: orders.commissionTax,
  depositAmount: orders.depositAmount,
  balanceAmount: orders.balanceAmount,
  currency: orders.currency,
  coolingWindowEndsAt: orders.coolingWindowEndsAt,
  balanceDueAt: orders.balanceDueAt,
  graceExpiresAt: orders.graceExpiresAt,
  autoCompleteAt: orders.autoCompleteAt,
  fulfilledAt: orders.fulfilledAt,
  completedAt: orders.completedAt,
  cancelledAt: orders.cancelledAt,
  issueNote: orders.issueNote,
  isDemo: orders.isDemo,
};

export function load(db: DbExecutor, orderId: string): Promise<OrderRow | undefined> {
  return db
    .select(orderColumns)
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
    .then((rows) => rows[0] as OrderRow | undefined);
}

/**
 * Reads an order and holds it for the rest of the transaction.
 *
 * Every state change goes through this. Without the lock, a webhook and an
 * admin action read the same state, both find the move legal, and both apply
 * the effects of a transition the order only made once.
 */
export async function loadForUpdate(
  db: DbExecutor,
  orderId: string,
): Promise<OrderRow | undefined> {
  const rows = await db
    .select(orderColumns)
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
    .for("update");

  return rows[0];
}

export function loadByReference(db: DbExecutor, reference: string): Promise<OrderRow | undefined> {
  return db
    .select(orderColumns)
    .from(orders)
    .where(eq(orders.reference, reference))
    .limit(1)
    .then((rows) => rows[0] as OrderRow | undefined);
}

/**
 * The order a provider payment intent belongs to.
 *
 * How a webhook finds its order: the event names an intent, and the attempt row
 * that created that intent names the order. A miss is an ordinary answer — an
 * event can arrive before the transaction that made the attempt has committed —
 * and the caller parks it rather than dropping it.
 */
export function loadByPaymentIntent(
  db: DbExecutor,
  intentId: string,
): Promise<OrderRow | undefined> {
  return db
    .select(orderColumns)
    .from(orders)
    .innerJoin(payments, eq(payments.orderId, orders.id))
    .where(eq(payments.providerPaymentIntentId, intentId))
    .limit(1)
    .then((rows) => rows[0] as OrderRow | undefined);
}

export type NewOrder = {
  reference: string;
  userId: string;
  vendorId: string;
  eventId: string | null;
  subtotal: bigint;
  tax: bigint;
  total: bigint;
  commission: bigint;
  commissionTax: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  currency: string;
  policyTemplateId: string | null;
  coolingWindowEndsAt: Date;
  balanceDueAt: Date | null;
  isDemo: boolean;
};

/**
 * Records what the customer was shown when they authorised the booking.
 *
 * Written in the checkout's own transaction, from the same figures it just
 * compared against, so the order's terms and its consent record cannot
 * disagree. Left unwritten when the caller stated nothing — an agreement
 * nobody made is not a row to invent.
 */
export async function recordAgreement(
  db: DbExecutor,
  orderId: string,
  agreement: { at: Date; total: bigint; depositAmount: bigint; balanceAmount: bigint; balanceDueAt: Date | null },
): Promise<void> {
  await db
    .update(orders)
    .set({
      agreedAt: agreement.at,
      agreedTotal: agreement.total,
      agreedDepositAmount: agreement.depositAmount,
      agreedBalanceAmount: agreement.balanceAmount,
      agreedBalanceDueAt: agreement.balanceDueAt,
    })
    .where(eq(orders.id, orderId));
}

export async function insertOrder(db: DbExecutor, input: NewOrder): Promise<OrderRow> {
  const [row] = await db
    .insert(orders)
    .values({ ...input, state: "pending_payment" })
    .returning(orderColumns);

  return row as OrderRow;
}

export async function insertItems(
  db: DbExecutor,
  orderId: string,
  items: ReadonlyArray<{
    serviceId: string;
    servicePackageId: string | null;
    description: string;
    quantity: number;
    unitPrice: bigint;
    lineTotal: bigint;
    currency: string;
  }>,
): Promise<void> {
  if (items.length === 0) return;
  await db.insert(orderItems).values(items.map((item) => ({ ...item, orderId })));
}

export function listItems(db: DbExecutor, orderId: string) {
  return db
    .select({
      id: orderItems.id,
      serviceId: orderItems.serviceId,
      servicePackageId: orderItems.servicePackageId,
      description: orderItems.description,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      lineTotal: orderItems.lineTotal,
      currency: orderItems.currency,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.createdAt);
}

/**
 * A `pending_payment` order of this customer's that is the same cart again.
 *
 * The exclusion constraint is on `(service_id, during)` and does not know whose
 * order holds the block, so a customer who abandons a checkout and comes back
 * collides with **their own** hold and is told the date is gone — for thirty
 * minutes, with no way out, because a customer cannot cancel a
 * `pending_payment` order. Resuming is what gives them the date back.
 *
 * **The item set has to match exactly**, because resuming means charging the
 * order that already exists: its lines, its total and its terms. Returning it
 * for a *different* cart would take a deposit for something other than what was
 * on screen.
 *
 * Every candidate is locked. The expiry job cancels through `loadForUpdate`, so
 * without the lock a checkout could resume an order the runner is in the middle
 * of releasing and hand back a client secret for a booking that no longer holds
 * a date. The lock is taken after the event's, never before, which is the same
 * order `loadEventForOrder({forUpdate})` establishes — `applyTransition` locks
 * the order and reads the event unlocked, so no path takes the pair the other
 * way round.
 */
export async function findResumableOrder(
  db: DbExecutor,
  input: {
    userId: string;
    eventId: string;
    vendorId: string;
    lines: ReadonlyArray<{
      serviceId: string;
      servicePackageId: string | null;
      quantity: number;
    }>;
  },
): Promise<OrderRow | undefined> {
  const candidates = await db
    .select(orderColumns)
    .from(orders)
    .where(
      and(
        eq(orders.userId, input.userId),
        eq(orders.eventId, input.eventId),
        eq(orders.vendorId, input.vendorId),
        eq(orders.state, "pending_payment"),
      ),
    )
    .for("update");

  const wanted = cartFingerprint(input.lines);

  for (const candidate of candidates) {
    const items = await listItems(db, candidate.id);
    if (
      cartFingerprint(
        items.map((item) => ({
          serviceId: item.serviceId ?? "",
          servicePackageId: item.servicePackageId,
          quantity: item.quantity,
        })),
      ) === wanted
    ) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * What a cart contains, as one comparable value.
 *
 * Sorted, so two carts holding the same lines in a different order are the same
 * cart — a customer re-entering a checkout has no control over the order their
 * plan's slots come back in. The quantity is part of the key: the same service
 * twice over is a different booking and a different price.
 */
function cartFingerprint(
  lines: ReadonlyArray<{ serviceId: string; servicePackageId: string | null; quantity: number }>,
): string {
  return lines
    .map((line) => `${line.serviceId}:${line.servicePackageId ?? ""}:${line.quantity}`)
    .sort()
    .join("|");
}

/**
 * Writes the new state and the timestamps that belong to it.
 *
 * The timestamps are set here rather than by each caller so that a state and
 * its date cannot disagree — an order that is `cancelled` with no
 * `cancelled_at` is a row no screen can explain.
 */
export async function setState(
  db: DbExecutor,
  orderId: string,
  to: OrderState,
  input: {
    now: Date;
    /** Set when entering `issue`; cleared by passing null when leaving it. */
    issueNote?: string | null;
    graceExpiresAt?: Date | null;
    autoCompleteAt?: Date | null;
    /**
     * Mirrors the queued `charge_balance` job, exactly as the two above mirror
     * theirs. Written from the same computation as the job's `run_after`, so a
     * screen cannot show a balance date nothing is working to.
     */
    balanceDueAt?: Date | null;
  },
): Promise<void> {
  await db
    .update(orders)
    .set({
      state: to,
      ...(to === "fulfilled" ? { fulfilledAt: input.now } : {}),
      ...(to === "completed" ? { completedAt: input.now } : {}),
      ...(to === "cancelled" ? { cancelledAt: input.now } : {}),
      ...("issueNote" in input ? { issueNote: input.issueNote ?? null } : {}),
      ...("graceExpiresAt" in input ? { graceExpiresAt: input.graceExpiresAt ?? null } : {}),
      ...("autoCompleteAt" in input ? { autoCompleteAt: input.autoCompleteAt ?? null } : {}),
      ...("balanceDueAt" in input ? { balanceDueAt: input.balanceDueAt ?? null } : {}),
      updatedAt: input.now,
    })
    .where(eq(orders.id, orderId));
}

/**
 * The next reference in the series, so demo data and new bookings read as one
 * set.
 *
 * From a sequence, not from `max(reference) + 1`. Two checkouts running at the
 * same moment compute the same maximum, and `reference` is unique — so the
 * second one died on the constraint. That is two ordinary customers booking at
 * the same time, and one of them getting a 500.
 *
 * A sequence also does not roll back with its transaction, so a failed checkout
 * burns a number. That is the intended trade: gaps in a reference series are
 * invisible, and collisions are an outage.
 */
export async function nextReference(db: DbExecutor): Promise<string> {
  const [row] = await db.execute<{ value: string }>(
    sql`select nextval('app.planning_org_order_reference_seq')::text as value`,
  );

  return `TO-${row?.value ?? "0"}`;
}

/**
 * The event an order is for, with what the schedule needs off it.
 *
 * `forUpdate` locks the row, and only the pricing path asks for it. Every date
 * a checkout computes — the capacity block, the balance charge, the
 * cooling window — is derived from this row, so a date change committing
 * between the read and the capacity insert leaves a booking holding one day and
 * charging for another. Locking here serialises the two instead.
 *
 * Deliberately **not** taken by `applyTransition`, which reads the same row
 * through `anchorsFor` while already holding the order lock. Locking there
 * would establish order → event, against the event → order order this path
 * takes, and two paths that acquire the same pair in opposite orders deadlock.
 */
export async function loadEventForOrder(
  db: DbExecutor,
  eventId: string,
  options: { forUpdate?: boolean } = {},
): Promise<
  | {
      id: string;
      ownerUserId: string;
      eventDate: string;
      startTime: string | null;
      timezone: string;
    }
  | undefined
> {
  const query = db
    .select({
      id: events.id,
      ownerUserId: events.ownerUserId,
      eventDate: events.eventDate,
      startTime: events.startTime,
      timezone: events.timezone,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  const [row] = await (options.forUpdate ? query.for("update") : query);

  return row;
}

/**
 * Takes the date a booking needs.
 *
 * The exclusion constraint on active blocks is what actually prevents a double
 * booking — two requests that both passed an application-level "is it free?"
 * check still cannot both commit past it. So this does not check first: it
 * inserts, and a clash surfaces as the constraint violation it is.
 */
export async function holdCapacity(
  db: DbExecutor,
  input: { serviceId: string; orderId: string; from: Date; until: Date },
): Promise<void> {
  await db.insert(capacityBlocks).values({
    serviceId: input.serviceId,
    orderId: input.orderId,
    during: rangeLiteral(input.from, input.until),
    active: true,
  });
}

/**
 * Frees every date an order was holding.
 *
 * Deactivated rather than deleted: only active blocks take part in the overlap
 * constraint, so the slot is free again while the record that it was once held
 * survives. A cancelled booking that leaves no trace is one nobody can explain
 * a vendor's empty calendar with.
 */
export async function releaseCapacity(db: DbExecutor, orderId: string): Promise<number> {
  const released = await db
    .update(capacityBlocks)
    .set({ active: false })
    .where(and(eq(capacityBlocks.orderId, orderId), eq(capacityBlocks.active, true)))
    .returning({ id: capacityBlocks.id });

  return released.length;
}

export function listCapacityBlocks(db: DbExecutor, orderId: string) {
  return db
    .select({
      id: capacityBlocks.id,
      serviceId: capacityBlocks.serviceId,
      active: capacityBlocks.active,
    })
    .from(capacityBlocks)
    .where(eq(capacityBlocks.orderId, orderId));
}

/** `[from, until)` — half-open, so touching bookings do not collide. */
function rangeLiteral(from: Date, until: Date): string {
  return `[${from.toISOString()},${until.toISOString()})`;
}

/**
 * Queues work for an order, once.
 *
 * The dedupe key is derived from what the job is about — its type and the order
 * — never from the time it was queued. That is the layer that stops the same
 * balance being charged twice however many times a confirmation is replayed:
 * `(type, dedupe_key)` is unique, and a second insert is a no-op rather than a
 * second charge.
 */
export async function enqueue(
  db: DbExecutor,
  input: {
    type: ScheduledJobType;
    orderId: string;
    runAfter: Date;
    payload: Record<string, unknown>;
    isDemo: boolean;
  },
): Promise<boolean> {
  return scheduler.enqueue(db, {
    type: input.type,
    dedupeKey: dedupeKey(input.type, input.orderId),
    runAfter: input.runAfter,
    payload: input.payload,
    isDemo: input.isDemo,
  });
}

export function dedupeKey(type: ScheduledJobType, orderId: string): string {
  return `${type}:${orderId}`;
}

/**
 * Drops whatever is still queued for an order.
 *
 * Only `queued` and `held` rows: a job that is already running owns itself, and
 * marking it done from outside would let its own completion write over the
 * answer. Every terminal state calls this — including `completed`, where an
 * auto-complete job that fires afterwards is at best a no-op and at worst the
 * second half of a race nobody will reproduce.
 */
export async function cancelQueuedJobs(
  db: DbExecutor,
  orderId: string,
  input: { reason: string; types?: readonly ScheduledJobType[] } = {
    reason: "Order reached a terminal state.",
  },
): Promise<number> {
  const keys = (input.types ?? ORDER_JOB_TYPES).map((type) => dedupeKey(type, orderId));
  if (keys.length === 0) return 0;

  const cancelled = await db
    .update(jobs)
    .set({ status: "done", lastError: input.reason })
    .where(and(inArray(jobs.status, ["queued", "held"]), inArray(jobs.dedupeKey, keys)))
    .returning({ id: jobs.id });

  return cancelled.length;
}

export function listJobsForOrder(db: DbExecutor, orderId: string) {
  return db
    .select({
      id: jobs.id,
      type: jobs.type,
      status: jobs.status,
      runAfter: jobs.runAfter,
      heldReason: jobs.heldReason,
    })
    .from(jobs)
    .where(inArray(jobs.dedupeKey, orderKeys(orderId)))
    .orderBy(jobs.runAfter);
}

/**
 * Every dedupe key an order can have.
 *
 * Enumerated rather than matched with a `like`: a pattern over a key that
 * happens to contain a uuid would also match whatever future job type embeds
 * one, and "cancel everything that looks related" is not a thing to guess at
 * when the things being cancelled move money.
 */
function orderKeys(orderId: string): string[] {
  return ORDER_JOB_TYPES.map((type) => dedupeKey(type, orderId));
}

const ORDER_JOB_TYPES = [
  "expire_unpaid",
  "cooling_window_transfer",
  "charge_balance",
  "balance_grace_expiry",
  "auto_complete_order",
] as const satisfies readonly ScheduledJobType[];

/** Opens a cart. The draft is kept so an abandoned one stays explainable. */
export async function insertCheckout(
  db: DbExecutor,
  input: { userId: string; eventId: string | null; draft: unknown; expiresAt: Date },
): Promise<{ id: string }> {
  const [row] = await db.insert(checkouts).values(input).returning({ id: checkouts.id });
  return row as { id: string };
}

export async function completeCheckout(
  db: DbExecutor,
  checkoutId: string,
  now: Date,
): Promise<void> {
  await db.update(checkouts).set({ completedAt: now }).where(eq(checkouts.id, checkoutId));
}

/**
 * The cancellation policy a booking is made under.
 *
 * Read at checkout and snapshotted onto the order, because the deposit rate and
 * the free-cancellation window are what the customer agreed to — a template
 * edited afterwards must not change the terms of a booking already made.
 */
export type PolicyTerms = {
  id: string;
  tier: string;
  depositBps: number;
  freeCancellationHours: number;
};

export async function loadPolicyTemplate(
  db: DbExecutor,
  templateId: string,
): Promise<PolicyTerms | undefined> {
  const [row] = await db
    .select({
      id: policyTemplates.id,
      tier: policyTemplates.tier,
      depositBps: policyTemplates.depositBps,
      freeCancellationHours: policyTemplates.freeCancellationHours,
    })
    .from(policyTemplates)
    .where(eq(policyTemplates.id, templateId))
    .limit(1);

  return row;
}
