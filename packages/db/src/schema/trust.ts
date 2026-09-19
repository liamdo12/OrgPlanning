import { index, integer, text, timestamp, unique, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/pg-core";
import { app, currency, money, timestamps, TABLE_PREFIX } from "./common.js";
import {
  contentDecision,
  contentTarget,
  disputeResolution,
  disputeState,
  moderationState,
} from "./enums.js";
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
  `${TABLE_PREFIX}reviews`,
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
  `${TABLE_PREFIX}disputes`,
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
    /** What was done about it, once it is closed. */
    resolution: disputeResolution("resolution"),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("disputes_order_idx").on(table.orderId),
    index("disputes_state_idx").on(table.state),
    index("disputes_raised_by_idx").on(table.raisedByUserId),
    index("disputes_assigned_to_idx").on(table.assignedToUserId),
    // A closed case says how it closed, an open one does not, and dismissal is
    // the rejected state under another name. Three facts that would otherwise
    // be three conventions, each of which drifts the first time a screen writes
    // one of the columns without the other.
    check(
      "disputes_resolution_matches_state",
      sql`(${table.state} in ('resolved', 'rejected')) = (${table.resolution} is not null)
          and (${table.resolution} is not distinct from 'dismissed') = (${table.state} = 'rejected')`,
    ),
  ],
);

/**
 * The correspondence on a case.
 *
 * Internal only in this milestone: there is no customer-facing view of a
 * dispute yet, so a message written here is read by administrators and nobody
 * else. It is a table rather than a growing text column because who wrote what
 * and when is the whole value of a case file — a single `notes` field records
 * the last person to save it and loses everyone before them.
 */
export const disputeMessages = app.table(
  `${TABLE_PREFIX}dispute_messages`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disputeId: uuid("dispute_id")
      .notNull()
      .references(() => disputes.id, { onDelete: "cascade" }),
    /**
     * Null once the author's account is deleted. The note stays: a case file
     * that loses its content when somebody leaves the company is not a record.
     */
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    ...timestamps,
  },
  (table) => [
    index("dispute_messages_dispute_idx").on(table.disputeId, table.createdAt),
    index("dispute_messages_author_idx").on(table.authorUserId),
  ],
);

/**
 * Something a person wrote that another person reported.
 *
 * The target is polymorphic — a review, a message, a vendor's own profile line
 * — so there is no foreign key to follow. That is the trade for one queue over
 * three kinds of content, and the cost is that a target can be deleted out from
 * under a report; the service reads the target through a union and says so when
 * it has gone, rather than pretending the report is about nothing.
 */
export const contentReports = app.table(
  `${TABLE_PREFIX}content_reports`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: contentTarget("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reporterUserId: uuid("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    detail: text("detail"),
    decision: contentDecision("decision"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (table) => [
    index("content_reports_target_idx").on(table.targetType, table.targetId),
    index("content_reports_open_idx")
      .on(table.createdAt)
      .where(sql`${table.decidedAt} is null`),
    index("content_reports_reporter_idx").on(table.reporterUserId),
    index("content_reports_decided_by_idx").on(table.decidedByUserId),
    // A decision and the moment it was taken arrive together or not at all.
    // Half of a decision is a queue entry that has left the queue and cannot
    // say when.
    check(
      "content_reports_decided_together",
      sql`(${table.decision} is null) = (${table.decidedAt} is null)`,
    ),
    // One open report per person per item. A double-submitted form is the
    // ordinary way to file the same complaint twice, and the queue is a list of
    // things to look at rather than a tally of how often each was reported.
    // Partial, so the same content can be reported again after a decision —
    // which is the case where a second look really is warranted.
    uniqueIndex("content_reports_one_open_per_reporter")
      .on(table.targetType, table.targetId, table.reporterUserId)
      .where(sql`${table.decidedAt} is null`),
  ],
);
