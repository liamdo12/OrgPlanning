import { index, integer, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { app, currency, money, timestamps, TABLE_PREFIX } from "./common.js";
import { quoteOfferState, quoteRequestState } from "./enums.js";
import { users, vendors } from "./identity.js";
import { events } from "./planning.js";
import { categories } from "./reference.js";

/**
 * A customer asking several vendors to price the same brief.
 *
 * Source: the quote flow, line 1069 — up to five vendors per request — and the
 * event hub, line 2398: "3 quotes in · best C$1,850 · closes Mar 13".
 */
export const quoteRequests = app.table(
  `${TABLE_PREFIX}quote_requests`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    state: quoteRequestState("state").notNull().default("open"),
    brief: text("brief"),
    /** Structured answers from the request form. */
    answers: jsonb("answers"),
    guestCount: integer("guest_count"),
    budget: money("budget"),
    currency,
    /** When the request stops accepting offers and the expiry job fires. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("quote_requests_user_idx").on(table.userId),
    index("quote_requests_state_idx").on(table.state),
    index("quote_requests_expires_idx").on(table.expiresAt),
    index("quote_requests_category_idx").on(table.categoryId),
    index("quote_requests_event_idx").on(table.eventId),
  ],
);

/** Which vendors were asked. */
export const quoteRequestInvites = app.table(
  `${TABLE_PREFIX}quote_request_invites`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteRequestId: uuid("quote_request_id")
      .notNull()
      .references(() => quoteRequests.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("quote_request_invites_request_vendor_key").on(table.quoteRequestId, table.vendorId),
    index("quote_request_invites_vendor_idx").on(table.vendorId),
  ],
);

/** A vendor's priced answer. */
export const quoteOffers = app.table(
  `${TABLE_PREFIX}quote_offers`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteRequestId: uuid("quote_request_id")
      .notNull()
      .references(() => quoteRequests.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    state: quoteOfferState("state").notNull().default("sent"),
    /** Pre-tax, like every other subtotal in the schema. */
    subtotal: money("subtotal").notNull(),
    currency,
    message: text("message"),
    lineItems: jsonb("line_items"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("quote_offers_request_vendor_key").on(table.quoteRequestId, table.vendorId),
    index("quote_offers_request_idx").on(table.quoteRequestId),
    index("quote_offers_vendor_idx").on(table.vendorId),
  ],
);
