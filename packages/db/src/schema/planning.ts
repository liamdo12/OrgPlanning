import { date, index, integer, text, time, uuid } from "drizzle-orm/pg-core";
import { app, currency, isDemo, money, timestamps, TABLE_PREFIX } from "./common.js";
import { eventVisibility } from "./enums.js";
import { users } from "./identity.js";
import { neighbourhoods } from "./reference.js";
import { services } from "./catalog.js";

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
    categoryId: uuid("category_id").notNull(),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    orderId: uuid("order_id"),
    quoteRequestId: uuid("quote_request_id"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("event_items_event_idx").on(table.eventId),
    index("event_items_service_idx").on(table.serviceId),
  ],
);
