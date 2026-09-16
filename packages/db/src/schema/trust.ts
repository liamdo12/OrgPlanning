import { index, integer, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { app, currency, money, timestamps } from "./common.js";
import { disputeState, moderationState } from "./enums.js";
import { users, vendors } from "./identity.js";
import { orders } from "./ordering.js";
import { services } from "./catalog.js";

/**
 * A review, unlocked by a completed order.
 *
 * One per order, enforced by the database: a review that can be written twice
 * is a rating that can be inflated at will.
 */
export const reviews = app.table(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    rating: integer("rating").notNull(),
    body: text("body"),
    moderation: moderationState("moderation").notNull().default("approved"),
    moderatedByUserId: uuid("moderated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("reviews_order_key").on(table.orderId),
    check("reviews_rating_range", sql`${table.rating} between 1 and 5`),
    index("reviews_vendor_idx").on(table.vendorId),
    index("reviews_author_idx").on(table.authorUserId),
    index("reviews_service_idx").on(table.serviceId),
    index("reviews_moderated_by_idx").on(table.moderatedByUserId),
  ],
);

/**
 * A contested charge or a complaint an admin has to resolve.
 *
 * Separate from `orders.state`: an order can be fulfilled and disputed at the
 * same time, so the dispute is its own record with its own lifecycle.
 */
export const disputes = app.table(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    raisedByUserId: uuid("raised_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    state: disputeState("state").notNull().default("open"),
    reason: text("reason").notNull(),
    detail: text("detail"),
    /** Set when the dispute originated at the payment provider. */
    providerDisputeId: text("provider_dispute_id").unique(),
    amount: money("amount"),
    currency,
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("disputes_order_idx").on(table.orderId),
    index("disputes_state_idx").on(table.state),
    index("disputes_raised_by_idx").on(table.raisedByUserId),
    index("disputes_assigned_to_idx").on(table.assignedToUserId),
  ],
);
