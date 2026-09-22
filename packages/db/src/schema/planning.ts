import {
  date,
  index,
  integer,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, currency, isDemo, money, timestamps, TABLE_PREFIX } from "./common.js";
import { eventVisibility } from "./enums.js";
import { users } from "./identity.js";
import { categories, neighbourhoods } from "./reference.js";
import { services, servicePackages } from "./catalog.js";

/**
 * A customer's event. Source: the seeded event, line 1887 — "Sarah's 30th",
 * 2027-03-20 17:00, Liberty Village loft, 60 guests, C$4,000 budget, Private.
 *
 * Date and time are stored apart from the timezone on purpose: an event happens
 * at 5pm local, and storing a single instant would move the party if the
 * timezone rules ever changed.
 */
export const events = app.table(
  `${TABLE_PREFIX}events`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    eventDate: date("event_date").notNull(),
    startTime: time("start_time"),
    timezone: text("timezone").notNull().default("America/Toronto"),
    venueName: text("venue_name"),
    neighbourhoodId: uuid("neighbourhood_id").references(() => neighbourhoods.id, {
      onDelete: "set null",
    }),
    guestCount: integer("guest_count"),
    budget: money("budget"),
    currency,
    visibility: eventVisibility("visibility").notNull().default("private"),
    /**
     * An event ends by being closed, not by being deleted: its orders, its
     * payments and its audit trail all still have to be explainable afterwards.
     */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    isDemo,
    ...timestamps,
  },
  (table) => [
    index("events_owner_idx").on(table.ownerUserId),
    index("events_date_idx").on(table.eventDate),
    index("events_neighbourhood_idx").on(table.neighbourhoodId),
  ],
);

/**
 * A category slot on an event, filled or not.
 *
 * The prototype's event hub shows all six categories with three states —
 * booked, quotes in, and empty — so an unfilled slot is a row, not an absence.
 * Source: the event hub list, lines 2397–2402.
 */
export const eventItems = app.table(
  `${TABLE_PREFIX}event_items`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    servicePackageId: uuid("service_package_id").references(() => servicePackages.id, {
      onDelete: "set null",
    }),
    /** What a price is multiplied by. The check constraint keeps it at least 1. */
    quantity: integer("quantity").notNull().default(1),
    /**
     * When this part of the event turns up.
     *
     * A time, not an instant, for the same reason `events.start_time` is one:
     * it is read in the event's timezone on the event's date.
     */
    arrivalTime: time("arrival_time"),
    /**
     * Which order was placed from this slot.
     *
     * Provenance, not liveness: nothing clears it, and whether the slot is
     * still taken is the order's own state read at the point the slot is drawn.
     * The key is declared in SQL rather than here because `ordering.ts` already
     * imports this module, and a `.references(() => orders.id)` would make the
     * two circular.
     */
    orderId: uuid("order_id"),
    quoteRequestId: uuid("quote_request_id"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("event_items_event_idx").on(table.eventId),
    index("event_items_service_idx").on(table.serviceId),
    index("event_items_service_package_idx").on(table.servicePackageId),
    index("event_items_order_idx").on(table.orderId),
    index("event_items_category_idx").on(table.categoryId),
    /**
     * One slot per category, so "update the existing row" is an invariant
     * rather than a rule each caller has to remember.
     */
    uniqueIndex("event_items_event_category_key").on(table.eventId, table.categoryId),
  ],
);
