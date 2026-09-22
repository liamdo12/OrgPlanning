import { record } from "../audit/service.js";
import type { CoreContext, DbExecutor } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { isAdmin, type Actor } from "../identity/actor.js";
import { assertCanActOnEvent } from "../identity/policies.js";
import { requireUser } from "../identity/service.js";
import { isTerminal } from "../ordering/transitions.js";
import { eventBudget, type EventBudget } from "./budget.js";
import * as repo from "./repo.js";
import { dayOfSchedule, type ScheduleEntry } from "./schedule.js";
import { slotState, type SlotState } from "./slots.js";

/**
 * A customer planning their own event.
 *
 * **Every entry point here is guarded by `assertCanActOnEvent`, reads
 * included.** That is deliberate and is not a copy-paste of the write path.
 * `assertCanReadEvent` admits administrators by design, because an
 * administrator looking at a customer's event on an admin screen is legitimate;
 * but everything below *is* that customer's own planner, whose every button
 * acts — adds to the plan, moves the date, closes the event. Handing an
 * administrator the read half of a screen whose write half refuses them would
 * be a view nothing can do anything with, and would make these functions an
 * oracle for which event ids exist. An administrator's view of a customer's
 * event is a different screen with a different policy, and this module is not
 * it.
 *
 * `NotFoundError` in every refusal, so a refusal is indistinguishable from a
 * missing row.
 */

const DEFAULT_TIMEZONE = "America/Toronto";

/** `YYYY-MM-DD`. The column is a `date`, and Postgres raises on anything else. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** `HH:MM` or `HH:MM:SS`, which is what a `time` column accepts. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export type EventVisibility = "private" | "shared" | "public";

export type EventSummary = {
  id: string;
  name: string;
  eventDate: string;
  startTime: string | null;
  timezone: string;
  venueName: string | null;
  guestCount: number | null;
  budget: bigint | null;
  currency: string;
  visibility: EventVisibility;
  cancelledAt: Date | null;
};

/** A slot on the planner, with the state derived rather than read. */
export type PlanItem = {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  /**
   * The category's own colour, as a CSS background.
   *
   * Carried on the slot because the planner draws a tile per slot in it, and
   * the value is reference data an administrator edits. A screen holding its
   * own copy would be right until the first edit.
   */
  categoryTone: string | null;
  state: SlotState;
  serviceId: string | null;
  serviceName: string | null;
  servicePackageId: string | null;
  servicePackageName: string | null;
  vendorName: string | null;
  quantity: number;
  arrivalTime: string | null;
  notes: string | null;
  orderReference: string | null;
};

export type EventDetail = EventSummary & { items: PlanItem[] };

export type EventPayments = {
  /** What actually settled, summed from the payments rather than the orders. */
  captured: bigint;
  /** When the soonest outstanding balance is taken. Read from the order. */
  nextChargeAt: Date | null;
  nextCharge: bigint;
  /**
   * Whether that charge is still waiting its turn or has already failed.
   *
   * Null when there is nothing left to take. `attention` is the case a screen
   * must not print as an ordinary deadline: the date has passed, the card was
   * declined, and the money is owed now.
   */
  nextChargeStatus: repo.NextChargeStatus | null;
};

/**
 * The whole planner.
 *
 * `budget` widens the event's own figure into what has been committed against
 * it — the figure itself is still in there, so nothing is lost by the override.
 */
export type EventHub = Omit<EventDetail, "budget"> & {
  budget: EventBudget;
  schedule: readonly ScheduleEntry[];
  payments: EventPayments;
};

export type CreateEventInput = {
  name: string;
  eventDate: string;
  startTime?: string | null;
  timezone?: string;
  venueName?: string | null;
  neighbourhoodId?: string | null;
  guestCount?: number | null;
  budget?: bigint | null;
  visibility?: EventVisibility;
};

/**
 * A new event, with a slot for every category currently offered.
 *
 * **Six is the seed's number, not a schema fact.** `categories` has no hierarchy
 * column and the categories screen can add and remove rows, so this reads the
 * table and seeds one slot per active category, whatever that count is. An
 * operator adding a seventh gets a seventh slot on events created afterwards;
 * events that already exist are not backfilled, because a slot is a row and
 * rewriting everybody's planner from a reference-data edit is a bigger promise
 * than the screen makes. `addItemToPlan` fills a missing slot in when it is
 * first used, so a category added later is still reachable.
 *
 * One transaction: an event whose slots failed to land is a planner with
 * nothing on it.
 */
export async function createEvent(
  ctx: CoreContext,
  actor: Actor,
  input: CreateEventInput,
): Promise<EventDetail> {
  const user = requireUser(actor);

  // The owner is always the actor — there is no parameter for whose event this
  // is, so nobody can create one in somebody else's name.
  //
  // An administrator is refused, which is the one condition `assertCanActOnEvent`
  // applies that does not need a row to be asked about. The policy refuses them
  // on every event including their own, so an event created here would be one
  // its owner could never open again, and no admin screen plans a party. Same
  // `NotFoundError` as every other refusal in this module, so none of them is
  // distinguishable from another.
  if (isAdmin(actor)) throw new NotFoundError("No such event.");

  const name = input.name.trim();
  if (name.length === 0) throw new ValidationError("An event needs a name.", { name: "required" });
  if (!DATE.test(input.eventDate)) {
    throw new ValidationError("An event needs a date.", { eventDate: "invalid" });
  }

  const startTime = normaliseTime(input.startTime);
  const guestCount = validateGuestCount(input.guestCount);
  const budget = validateBudget(input.budget);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const event = await repo.insertEvent(tx, {
      ownerUserId: user.userId,
      name,
      eventDate: input.eventDate,
      startTime,
      timezone: input.timezone?.trim() || DEFAULT_TIMEZONE,
      venueName: nullableText(input.venueName),
      neighbourhoodId: input.neighbourhoodId ?? null,
      guestCount,
      budget,
      visibility: input.visibility ?? "private",
      now,
    });

    const active = await repo.listActiveCategories(tx);
    await repo.insertEmptySlots(tx, event.id, active, now);

    await record(
      ctx,
      actor,
      {
        action: "planning.event.create",
        entityType: "event",
        entityId: event.id,
        after: { name: event.name, eventDate: event.eventDate, slots: active.length },
      },
      tx,
    );

    return detail(event, await repo.listItems(tx, event.id));
  });
}

/** One event and its slots, for its owner and nobody else. */
export async function getEvent(
  ctx: CoreContext,
  actor: Actor,
  eventId: string,
): Promise<EventDetail> {
  const event = await loadOwned(ctx.db, actor, eventId);
  return detail(event, await repo.listItems(ctx.db, eventId));
}

/**
 * Somebody's own events.
 *
 * No entity id, so no policy on a row: the actor *is* the scope, and the query
 * is filtered by their id rather than filtered afterwards.
 */
export async function listEventsForOwner(ctx: CoreContext, actor: Actor): Promise<EventSummary[]> {
  const user = requireUser(actor);
  const rows = await repo.listEventsForOwner(ctx.db, user.userId);
  return rows.map(summarise);
}

export type UpdateEventInput = {
  name?: string;
  eventDate?: string;
  startTime?: string | null;
  venueName?: string | null;
  neighbourhoodId?: string | null;
  guestCount?: number | null;
  budget?: bigint | null;
  visibility?: EventVisibility;
};

/**
 * Changes an event, refusing a date move while a booking is still in flight.
 *
 * The planner warns that changing the date releases booked vendors and gives
 * them 48 hours to accept or refund — and there is no accept screen, no job and
 * no refund path behind that warning. Building one would be inventing a
 * workflow nobody specified, so the save is refused instead and the customer is
 * told which booking is in the way.
 *
 * **It guards any non-terminal order, not only a confirmed one.** A checkout in
 * flight is `pending_payment`; letting the date move out from under it means the
 * webhook then confirms an order whose balance charge is scheduled against the
 * new date while its capacity block sits on the old one — a vendor committed to
 * a date their own calendar shows as free. A `completed` booking, by contrast,
 * has had its date already and constrains nothing.
 *
 * **Under a row lock, taken before the orders are read.** Without it the check
 * and a concurrent confirm are two transactions under READ COMMITTED that
 * neither see nor block each other, and the refusal is a suggestion. The lock is
 * on the event first and the orders second — the same order `createCheckout`
 * acquires them in, which is what keeps the two from deadlocking.
 *
 * Everything else — guest count, name, venue, budget, visibility — saves
 * regardless.
 */
export async function updateEvent(
  ctx: CoreContext,
  actor: Actor,
  eventId: string,
  input: UpdateEventInput,
): Promise<EventDetail> {
  const patch = validatePatch(input);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const event = await loadOwned(tx, actor, eventId, { forUpdate: true });

    if (patch.eventDate !== undefined && patch.eventDate !== event.eventDate) {
      await refuseWhileBooked(tx, eventId, "Change the date");
    }

    const updated = await repo.updateEvent(tx, eventId, patch, now);

    await record(
      ctx,
      actor,
      {
        action: "planning.event.update",
        entityType: "event",
        entityId: eventId,
        before: audited(event),
        after: audited(updated),
      },
      tx,
    );

    return detail(updated, await repo.listItems(tx, eventId));
  });
}

/**
 * Closes an event.
 *
 * The same lock and the same refusal as a date change, for the same reason: an
 * event with a booking still in flight has a vendor holding a date and a card
 * about to be charged, and closing it would leave both with nothing explaining
 * them. Writes `cancelled_at` rather than deleting, so the orders, the payments
 * and the audit trail keep what they were for.
 */
export async function cancelEvent(
  ctx: CoreContext,
  actor: Actor,
  eventId: string,
): Promise<EventSummary> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const event = await loadOwned(tx, actor, eventId, { forUpdate: true });

    if (event.cancelledAt !== null) {
      throw new ValidationError("That event is already cancelled.", { event: "cancelled" });
    }

    await refuseWhileBooked(tx, eventId, "Cancel the event");

    const cancelled = await repo.setCancelledAt(tx, eventId, now);

    await record(
      ctx,
      actor,
      {
        action: "planning.event.cancel",
        entityType: "event",
        entityId: eventId,
        before: { cancelledAt: null },
        after: { cancelledAt: cancelled.cancelledAt },
      },
      tx,
    );

    return summarise(cancelled);
  });
}

export type AddItemInput = {
  eventId: string;
  serviceId: string;
  servicePackageId?: string | null;
  quantity?: number;
  arrivalTime?: string | null;
  notes?: string | null;
};

/**
 * Puts a service in its category's slot.
 *
 * **Updates the slot rather than adding a second one**, and the unique
 * `(event_id, category_id)` is what makes that an invariant rather than a rule
 * each caller has to remember. The category is taken from the service rather
 * than from the caller, so a florist cannot land in the catering slot and the
 * constraint never has to arbitrate.
 */
export async function addItemToPlan(
  ctx: CoreContext,
  actor: Actor,
  input: AddItemInput,
): Promise<PlanItem> {
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ValidationError("A quantity is a whole number of at least one.", {
      quantity: "invalid",
    });
  }

  const arrivalTime = normaliseTime(input.arrivalTime);
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    const event = await loadOwned(tx, actor, input.eventId);
    if (event.cancelledAt !== null) {
      throw new ValidationError("That event is cancelled.", { event: "cancelled" });
    }

    const service = await repo.loadBookableService(tx, input.serviceId);
    // The same answer as a missing service for a service belonging to a
    // business that is not approved: a suspended catalogue must not become a
    // way to learn it exists.
    if (!service) throw new NotFoundError("No such service.");

    if (input.servicePackageId) {
      const belongs = await repo.packageBelongsToService(
        tx,
        input.servicePackageId,
        input.serviceId,
      );
      // A package priced for another service would cost the slot at a figure
      // the checkout would never charge.
      if (!belongs) throw new NotFoundError("No such package.");
    }

    const category = await repo.loadCategory(tx, service.categoryId);
    if (!category) throw new NotFoundError("No such service.");

    const item = await repo.upsertItem(tx, {
      eventId: input.eventId,
      categoryId: service.categoryId,
      serviceId: input.serviceId,
      servicePackageId: input.servicePackageId ?? null,
      quantity,
      arrivalTime,
      notes: nullableText(input.notes),
      sortOrder: category.sortOrder,
      now,
    });

    await record(
      ctx,
      actor,
      {
        action: "planning.item.add",
        entityType: "event_item",
        entityId: item.id,
        after: {
          eventId: input.eventId,
          categoryId: service.categoryId,
          serviceId: input.serviceId,
          servicePackageId: input.servicePackageId ?? null,
          quantity,
        },
      },
      tx,
    );

    return present(item);
  });
}

/**
 * Empties a category's slot.
 *
 * The slot stays — it is the row the planner draws the category from, so
 * deleting it would take the category off the screen rather than clearing it.
 * `order_id` is left alone for the same reason nothing else clears it: it
 * records which order was placed from here, and the order's own state is what
 * says whether the slot is still taken.
 */
export async function removeItemFromPlan(
  ctx: CoreContext,
  actor: Actor,
  input: { eventId: string; categoryId: string },
): Promise<PlanItem> {
  const now = ctx.clock.now();

  return ctx.db.transaction(async (tx) => {
    await loadOwned(tx, actor, input.eventId);

    const existing = await repo.loadItemByCategory(tx, input.eventId, input.categoryId);
    if (!existing) throw new NotFoundError("No such item.");

    await repo.clearItem(tx, existing.id, now);

    await record(
      ctx,
      actor,
      {
        action: "planning.item.remove",
        entityType: "event_item",
        entityId: existing.id,
        before: {
          serviceId: existing.serviceId,
          servicePackageId: existing.servicePackageId,
          quantity: existing.quantity,
          arrivalTime: existing.arrivalTime,
        },
        // The slot survives, emptied. Recording that rather than nothing is what
        // makes the pair readable a year later: what was chosen, and that it no
        // longer is.
        after: {
          eventId: input.eventId,
          categoryId: input.categoryId,
          serviceId: null,
          servicePackageId: null,
          arrivalTime: null,
        },
      },
      tx,
    );

    const items = await repo.listItems(tx, input.eventId);
    return present(items.find((item) => item.id === existing.id) as repo.ItemRow);
  });
}

/**
 * Everything the planner draws, in one call.
 *
 * Composed rather than stored: the slots, the money, the running order of the
 * day and what has been charged are four views of the same rows, and four
 * separate round trips would let them disagree with each other on screen.
 */
export async function eventHub(ctx: CoreContext, actor: Actor, eventId: string): Promise<EventHub> {
  const event = await loadOwned(ctx.db, actor, eventId);

  const [items, orders, payments] = await Promise.all([
    repo.listItems(ctx.db, eventId),
    repo.listOrdersForEvent(ctx.db, eventId),
    repo.paymentSummary(ctx.db, eventId),
  ]);

  const base = detail(event, items);

  // Only the slots that are not already bought: an order on the event is
  // already counted from the order side, and adding its slot would charge the
  // budget twice for one booking.
  const inPlan = base.items
    .filter((item) => item.state.kind === "in_plan")
    .map((item) => {
      const row = items.find((candidate) => candidate.id === item.id) as repo.ItemRow;
      return { unitPrice: row.unitPrice ?? 0n, quantity: row.quantity };
    });

  return {
    ...base,
    budget: eventBudget({ budget: event.budget, orders, inPlan }),
    schedule: dayOfSchedule({
      startTime: event.startTime,
      venueName: event.venueName,
      items: items.map((item) => ({
        arrivalTime: item.arrivalTime,
        categoryName: item.categoryName,
        vendorName: item.vendorName,
      })),
    }),
    payments,
  };
}

/**
 * Loads the event and decides whether this actor may touch it, in that order.
 *
 * The load has to come first, because the policy's question is about the
 * **owner** and there is nowhere else to read one. Both answers are the same
 * `NotFoundError`, so "no such event" and "not yours" are indistinguishable.
 */
async function loadOwned(
  db: DbExecutor,
  actor: Actor,
  eventId: string,
  options: { forUpdate?: boolean } = {},
): Promise<repo.EventRow> {
  const event = await repo.loadEvent(db, eventId, options);
  if (!event) throw new NotFoundError("No such event.");

  assertCanActOnEvent(actor, { id: event.id, ownerUserId: event.ownerUserId });
  return event;
}

/**
 * Refuses while any booking on the event is still in flight, naming it.
 *
 * Read inside the caller's transaction, after the event row is locked, so a
 * confirm arriving concurrently either waits for this transaction or is already
 * visible to it.
 */
async function refuseWhileBooked(db: DbExecutor, eventId: string, attempt: string): Promise<void> {
  const orders = await repo.listOrdersForEvent(db, eventId);
  const live = orders.find((order) => !isTerminal(order.state));

  if (live) {
    throw new ValidationError(
      `${attempt} after cancelling ${live.reference}. A booking on this event is still live.`,
      { eventDate: "booked", reference: live.reference },
    );
  }
}

function summarise(row: repo.EventRow): EventSummary {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.eventDate,
    startTime: row.startTime,
    timezone: row.timezone,
    venueName: row.venueName,
    guestCount: row.guestCount,
    budget: row.budget,
    currency: row.currency,
    visibility: row.visibility,
    cancelledAt: row.cancelledAt,
  };
}

/**
 * An event as an audit payload, which is `jsonb` and cannot hold a `bigint`.
 *
 * The budget is rendered as a string of cents rather than dropped or narrowed to
 * a `number`: it is one of the fields a customer changes, so an entry that left
 * it out would not answer what the change was.
 */
function audited(row: repo.EventRow): Record<string, unknown> {
  const { budget, ...rest } = summarise(row);
  return { ...rest, budget: budget === null ? null : budget.toString() };
}

function detail(row: repo.EventRow, items: readonly repo.ItemRow[]): EventDetail {
  return { ...summarise(row), items: items.map(present) };
}

/** A row, with its state derived from the facts the row carries. */
function present(row: repo.ItemRow): PlanItem {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    categoryTone: row.categoryTone,
    state: slotState({
      orderState: row.orderState ?? undefined,
      hasService: row.serviceId !== null,
      quoteState: row.quoteState ?? undefined,
      offerCount: row.offerCount,
    }),
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    servicePackageId: row.servicePackageId,
    servicePackageName: row.servicePackageName,
    vendorName: row.vendorName,
    quantity: row.quantity,
    arrivalTime: row.arrivalTime,
    notes: row.notes,
    orderReference: row.orderReference,
  };
}

function validatePatch(input: UpdateEventInput): repo.EventPatch {
  const patch: repo.EventPatch = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new ValidationError("An event needs a name.", { name: "required" });
    }
    patch.name = name;
  }

  if (input.eventDate !== undefined) {
    if (!DATE.test(input.eventDate)) {
      throw new ValidationError("An event needs a date.", { eventDate: "invalid" });
    }
    patch.eventDate = input.eventDate;
  }

  if (input.startTime !== undefined) patch.startTime = normaliseTime(input.startTime);
  if (input.venueName !== undefined) patch.venueName = nullableText(input.venueName);
  if (input.neighbourhoodId !== undefined) patch.neighbourhoodId = input.neighbourhoodId;
  if (input.guestCount !== undefined) patch.guestCount = validateGuestCount(input.guestCount);
  if (input.budget !== undefined) patch.budget = validateBudget(input.budget);
  if (input.visibility !== undefined) patch.visibility = input.visibility;

  return patch;
}

/**
 * A local clock time, or nothing.
 *
 * Checked rather than passed through because the column is a `time` and
 * Postgres raises on a malformed one — which would turn a mistyped form field
 * into the error boundary instead of into a field-level message.
 */
function normaliseTime(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;

  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!TIME.test(trimmed)) {
    throw new ValidationError("A time reads as HH:MM.", { time: "invalid" });
  }

  return trimmed;
}

function validateGuestCount(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError("A guest count is a whole number.", { guestCount: "invalid" });
  }
  return value;
}

function validateBudget(value: bigint | null | undefined): bigint | null {
  if (value === undefined || value === null) return null;
  if (value < 0n) {
    throw new ValidationError("A budget cannot be negative.", { budget: "invalid" });
  }
  return value;
}

function nullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
