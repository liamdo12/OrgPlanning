import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import {
  categories,
  eventItems,
  events,
  orders,
  payments,
  quoteOffers,
  quoteRequests,
  servicePackages,
  services,
  vendors,
} from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";
import type { OrderState } from "../ordering/transitions.js";
import type { QuoteState } from "./slots.js";

/**
 * Database access for events and their category slots.
 *
 * Every function takes an executor, because creating an event is one
 * transaction: the event and its slots either both land or neither does. An
 * event with no slots is a planner with nothing on it and no way to get
 * anything on it, since `addItemToPlan` updates a slot rather than creating one.
 *
 * Nothing here checks authority. The service above it does, before it calls
 * anything below — which is why none of this is on the package's barrel.
 */

export type EventRow = {
  id: string;
  ownerUserId: string;
  name: string;
  eventDate: string;
  startTime: string | null;
  timezone: string;
  venueName: string | null;
  neighbourhoodId: string | null;
  guestCount: number | null;
  budget: bigint | null;
  currency: string;
  visibility: "private" | "shared" | "public";
  cancelledAt: Date | null;
};

const eventColumns = {
  id: events.id,
  ownerUserId: events.ownerUserId,
  name: events.name,
  eventDate: events.eventDate,
  startTime: events.startTime,
  timezone: events.timezone,
  venueName: events.venueName,
  neighbourhoodId: events.neighbourhoodId,
  guestCount: events.guestCount,
  budget: events.budget,
  currency: events.currency,
  visibility: events.visibility,
  cancelledAt: events.cancelledAt,
};

export async function insertEvent(
  db: DbExecutor,
  input: {
    ownerUserId: string;
    name: string;
    eventDate: string;
    startTime: string | null;
    timezone: string;
    venueName: string | null;
    neighbourhoodId: string | null;
    guestCount: number | null;
    budget: bigint | null;
    visibility: "private" | "shared" | "public";
    now: Date;
  },
): Promise<EventRow> {
  const [row] = await db
    .insert(events)
    .values({
      ownerUserId: input.ownerUserId,
      name: input.name,
      eventDate: input.eventDate,
      startTime: input.startTime,
      timezone: input.timezone,
      venueName: input.venueName,
      neighbourhoodId: input.neighbourhoodId,
      guestCount: input.guestCount,
      budget: input.budget,
      visibility: input.visibility,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning(eventColumns);

  return row as EventRow;
}

/**
 * One event, optionally locked.
 *
 * `forUpdate` is asked for by the two writes that must not race a checkout:
 * changing the date and closing the event. The lock is taken on the **event**
 * first and the orders read second, which is the same order `createCheckout`
 * acquires them in — two paths taking the same pair in opposite orders
 * deadlock, and this pairing is the reason `applyTransition` deliberately does
 * not lock the event at all.
 */
export async function loadEvent(
  db: DbExecutor,
  eventId: string,
  options: { forUpdate?: boolean } = {},
): Promise<EventRow | undefined> {
  const query = db.select(eventColumns).from(events).where(eq(events.id, eventId)).limit(1);

  const [row] = await (options.forUpdate ? query.for("update") : query);
  return row;
}

/**
 * Somebody's own events, soonest first.
 *
 * Owner-scoped in the query as well as by policy above it: a list is the one
 * shape where a missing predicate returns everybody's rows rather than
 * throwing, so the scoping is in the `where` rather than trusted to a caller.
 *
 * Unpaged. The bound is a person's own parties, which is a handful, and a page
 * size with no cursor would silently hide the seventh.
 */
export async function listEventsForOwner(db: DbExecutor, ownerUserId: string): Promise<EventRow[]> {
  const rows = await db
    .select(eventColumns)
    .from(events)
    .where(eq(events.ownerUserId, ownerUserId))
    .orderBy(asc(events.eventDate), asc(events.id));

  return rows;
}

/** The fields a customer may change. Absent means "leave it alone". */
export type EventPatch = {
  name?: string;
  eventDate?: string;
  startTime?: string | null;
  venueName?: string | null;
  neighbourhoodId?: string | null;
  guestCount?: number | null;
  budget?: bigint | null;
  visibility?: "private" | "shared" | "public";
};

export async function updateEvent(
  db: DbExecutor,
  eventId: string,
  patch: EventPatch,
  now: Date,
): Promise<EventRow> {
  const [row] = await db
    .update(events)
    .set({ ...patch, updatedAt: now })
    .where(eq(events.id, eventId))
    .returning(eventColumns);

  return row as EventRow;
}

/** Closes the event. Deletes nothing: its orders still have to be explainable. */
export async function setCancelledAt(
  db: DbExecutor,
  eventId: string,
  cancelledAt: Date,
): Promise<EventRow> {
  const [row] = await db
    .update(events)
    .set({ cancelledAt, updatedAt: cancelledAt })
    .where(eq(events.id, eventId))
    .returning(eventColumns);

  return row as EventRow;
}

export type CategoryRow = { id: string; name: string; slug: string; sortOrder: number };

/**
 * The categories an event gets a slot for.
 *
 * Read from the table rather than from a constant, and filtered to the ones
 * still offered: deactivating a category is how an operator stops offering it,
 * so a slot for a deactivated one would invite a customer to fill a category
 * nothing can be filed under.
 */
export async function listActiveCategories(db: DbExecutor): Promise<CategoryRow[]> {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.sortOrder), asc(categories.slug));
}

/** One empty slot per category, in the same transaction as the event. */
export async function insertEmptySlots(
  db: DbExecutor,
  eventId: string,
  categoryRows: readonly CategoryRow[],
  now: Date,
): Promise<number> {
  if (categoryRows.length === 0) return 0;

  const rows = await db
    .insert(eventItems)
    .values(
      categoryRows.map((category) => ({
        eventId,
        categoryId: category.id,
        sortOrder: category.sortOrder,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .returning({ id: eventItems.id });

  return rows.length;
}

export type ItemRow = {
  id: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  sortOrder: number;
  serviceId: string | null;
  serviceName: string | null;
  servicePackageId: string | null;
  servicePackageName: string | null;
  vendorName: string | null;
  quantity: number;
  arrivalTime: string | null;
  notes: string | null;
  orderId: string | null;
  orderReference: string | null;
  orderState: OrderState | null;
  quoteRequestId: string | null;
  quoteState: QuoteState | null;
  offerCount: number;
  /**
   * What buying this slot would cost per unit: the package's price when one is
   * named, the service's base price otherwise. The checkout's own rule, so the
   * budget counts a slot in plan at what it would actually charge.
   */
  unitPrice: bigint | null;
};

/**
 * Every slot on the event, with the facts its state is derived from.
 *
 * One query rather than one per slot: the offer count is a correlated subquery
 * instead of a join, so a slot with three offers stays one row and a slot with
 * none still appears. A `left join` on offers would multiply the slot by its
 * offers and drop the empty ones from a `group by` the moment somebody added a
 * `having`.
 */
export async function listItems(db: DbExecutor, eventId: string): Promise<ItemRow[]> {
  const rows = await db
    .select({
      id: eventItems.id,
      categoryId: eventItems.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
      sortOrder: eventItems.sortOrder,
      serviceId: eventItems.serviceId,
      serviceName: services.title,
      servicePackageId: eventItems.servicePackageId,
      servicePackageName: servicePackages.name,
      vendorName: vendors.name,
      quantity: eventItems.quantity,
      arrivalTime: eventItems.arrivalTime,
      notes: eventItems.notes,
      orderId: eventItems.orderId,
      orderReference: orders.reference,
      orderState: orders.state,
      quoteRequestId: eventItems.quoteRequestId,
      quoteState: quoteRequests.state,
      offerCount: sql<number>`(
        select count(*)::int from ${quoteOffers}
        where ${quoteOffers.quoteRequestId} = ${eventItems.quoteRequestId}
      )`,
      /**
       * Rendered as text and converted below.
       *
       * A raw expression carries no Drizzle column type, so the driver hands
       * back whatever it decides a `bigint` looks like — which is not a
       * `bigint`, and multiplying it by a quantity then raises rather than
       * quietly rounding. Text is the one rendering that survives the trip.
       */
      unitPrice: sql<
        string | null
      >`coalesce(${servicePackages.unitPrice}, ${services.basePrice})::text`,
    })
    .from(eventItems)
    .innerJoin(categories, eq(categories.id, eventItems.categoryId))
    .leftJoin(services, eq(services.id, eventItems.serviceId))
    .leftJoin(servicePackages, eq(servicePackages.id, eventItems.servicePackageId))
    .leftJoin(vendors, eq(vendors.id, services.vendorId))
    .leftJoin(orders, eq(orders.id, eventItems.orderId))
    .leftJoin(quoteRequests, eq(quoteRequests.id, eventItems.quoteRequestId))
    .where(eq(eventItems.eventId, eventId))
    .orderBy(asc(eventItems.sortOrder), asc(categories.slug));

  return rows.map((row) => ({
    ...row,
    unitPrice: row.unitPrice === null ? null : BigInt(row.unitPrice),
  }));
}

/** One slot, by the category it is for, with what it currently holds. */
export async function loadItemByCategory(
  db: DbExecutor,
  eventId: string,
  categoryId: string,
): Promise<
  | {
      id: string;
      serviceId: string | null;
      servicePackageId: string | null;
      quantity: number;
      arrivalTime: string | null;
      orderId: string | null;
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: eventItems.id,
      serviceId: eventItems.serviceId,
      servicePackageId: eventItems.servicePackageId,
      quantity: eventItems.quantity,
      arrivalTime: eventItems.arrivalTime,
      orderId: eventItems.orderId,
    })
    .from(eventItems)
    .where(and(eq(eventItems.eventId, eventId), eq(eventItems.categoryId, categoryId)))
    .limit(1);

  return row;
}

/**
 * Fills the category's slot, creating it only if the event has none.
 *
 * `on conflict (event_id, category_id) do update` is what makes "one slot per
 * category" an invariant rather than a convention each caller has to remember:
 * an event created before a category existed gets its slot here, and an event
 * that already has one has it updated instead of growing a second.
 */
export async function upsertItem(
  db: DbExecutor,
  input: {
    eventId: string;
    categoryId: string;
    serviceId: string;
    servicePackageId: string | null;
    quantity: number;
    arrivalTime: string | null;
    notes: string | null;
    sortOrder: number;
    now: Date;
  },
): Promise<ItemRow> {
  const [row] = await db
    .insert(eventItems)
    .values({
      eventId: input.eventId,
      categoryId: input.categoryId,
      serviceId: input.serviceId,
      servicePackageId: input.servicePackageId,
      quantity: input.quantity,
      arrivalTime: input.arrivalTime,
      notes: input.notes,
      sortOrder: input.sortOrder,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [eventItems.eventId, eventItems.categoryId],
      set: {
        serviceId: input.serviceId,
        servicePackageId: input.servicePackageId,
        quantity: input.quantity,
        arrivalTime: input.arrivalTime,
        notes: input.notes,
        updatedAt: input.now,
      },
    })
    .returning({ id: eventItems.id });

  const items = await listItems(db, input.eventId);
  return items.find((item) => item.id === row?.id) as ItemRow;
}

/**
 * Empties the slot without deleting it.
 *
 * The row is the slot, so removing it would take the category off the planner
 * altogether. `order_id` is deliberately left alone: it records which order was
 * placed from here, and that order's own state is what says whether the slot is
 * still taken.
 */
export async function clearItem(db: DbExecutor, itemId: string, now: Date): Promise<void> {
  await db
    .update(eventItems)
    .set({
      serviceId: null,
      servicePackageId: null,
      quantity: 1,
      arrivalTime: null,
      notes: null,
      updatedAt: now,
    })
    .where(eq(eventItems.id, itemId));
}

export type EventOrderRow = {
  id: string;
  reference: string;
  state: OrderState;
  subtotal: bigint;
  total: bigint;
  balanceAmount: bigint;
  balanceDueAt: Date | null;
};

/**
 * Every order placed against the event.
 *
 * All of them, not just the live ones: what counts as committed is the
 * lifecycle's question, answered in `budget.ts`, and a repository that filtered
 * here would be a second place that definition lives.
 */
export async function listOrdersForEvent(
  db: DbExecutor,
  eventId: string,
): Promise<EventOrderRow[]> {
  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      state: orders.state,
      subtotal: orders.subtotal,
      total: orders.total,
      balanceAmount: orders.balanceAmount,
      balanceDueAt: orders.balanceDueAt,
    })
    .from(orders)
    .where(eq(orders.eventId, eventId))
    .orderBy(asc(orders.createdAt), asc(orders.id));

  return rows;
}

export type PaymentSummaryRow = { captured: bigint; nextChargeAt: Date | null; nextCharge: bigint };

/**
 * What has been taken and what is coming.
 *
 * Captured is the payments that actually succeeded, summed from the payment
 * rows rather than from the orders' deposit columns — a deposit that was never
 * charged is a figure the order carries and the customer has not paid.
 */
export async function paymentSummary(db: DbExecutor, eventId: string): Promise<PaymentSummaryRow> {
  const [captured] = await db
    .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)::text` })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(and(eq(orders.eventId, eventId), eq(payments.state, "succeeded")));

  const [next] = await db
    .select({ due: orders.balanceDueAt, amount: orders.balanceAmount })
    .from(orders)
    .where(
      and(
        eq(orders.eventId, eventId),
        eq(orders.state, "balance_due"),
        sql`${orders.balanceDueAt} is not null`,
      ),
    )
    .orderBy(asc(orders.balanceDueAt))
    .limit(1);

  return {
    captured: BigInt(captured?.total ?? "0"),
    nextChargeAt: next?.due ?? null,
    nextCharge: next?.amount ?? 0n,
  };
}

/**
 * A service a customer may put in their plan, or nothing.
 *
 * The vendor's standing is the condition, which is the same one the checkout
 * applies — so a slot cannot be filled with something that would then refuse to
 * be bought. Read from the tables directly rather than through the catalogue's
 * pricing path, because what is needed here is one row and its category, not a
 * priced line.
 */
export async function loadBookableService(
  db: DbExecutor,
  serviceId: string,
): Promise<{ id: string; categoryId: string; vendorId: string } | undefined> {
  const [row] = await db
    .select({
      id: services.id,
      categoryId: services.categoryId,
      vendorId: services.vendorId,
    })
    .from(services)
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .where(
      and(
        eq(services.id, serviceId),
        eq(vendors.status, "approved"),
        isNotNull(services.publishedAt),
      ),
    )
    .limit(1);

  return row;
}

/** Whether the package is one of that service's, rather than another's. */
export async function packageBelongsToService(
  db: DbExecutor,
  servicePackageId: string,
  serviceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: servicePackages.id })
    .from(servicePackages)
    .where(and(eq(servicePackages.id, servicePackageId), eq(servicePackages.serviceId, serviceId)))
    .limit(1);

  return row !== undefined;
}

export async function loadCategory(
  db: DbExecutor,
  categoryId: string,
): Promise<CategoryRow | undefined> {
  const [row] = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      sortOrder: categories.sortOrder,
    })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);

  return row;
}
