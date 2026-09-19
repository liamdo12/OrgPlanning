import { index, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { app, timestamps, TABLE_PREFIX } from "./common.js";
import { emailAudience, emailSendState, emailTemplateClass, moderationState } from "./enums.js";
import { users, vendors } from "./identity.js";
import { orders } from "./ordering.js";
import { quoteRequests } from "./quotes.js";

/** A conversation, optionally anchored to an order or a quote request. */
export const threads = app.table(
  `${TABLE_PREFIX}threads`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subject: text("subject"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    quoteRequestId: uuid("quote_request_id").references(() => quoteRequests.id, {
      onDelete: "set null",
    }),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("threads_order_idx").on(table.orderId),
    index("threads_vendor_idx").on(table.vendorId),
    index("threads_quote_request_idx").on(table.quoteRequestId),
  ],
);

export const threadParticipants = app.table(
  `${TABLE_PREFIX}thread_participants`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("thread_participants_thread_user_key").on(table.threadId, table.userId),
    index("thread_participants_user_idx").on(table.userId),
  ],
);

export const messages = app.table(
  `${TABLE_PREFIX}messages`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Whether a moderator has acted on this message.
     *
     * The same three columns a review carries, for the same reason: hiding is
     * reversible and removal is not, and a message that was taken down has to
     * be distinguishable from one nobody ever looked at.
     */
    moderation: moderationState("moderation").notNull().default("approved"),
    moderatedByUserId: uuid("moderated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("messages_thread_idx").on(table.threadId, table.sentAt),
    index("messages_sender_idx").on(table.senderUserId),
    index("messages_moderated_by_idx").on(table.moderatedByUserId),
  ],
);

export const notifications = app.table(
  `${TABLE_PREFIX}notifications`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    linkPath: text("link_path"),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("notifications_user_idx").on(table.userId, table.readAt)],
);

/**
 * A reusable message body.
 *
 * `allowedMergeFields` is the allowlist a send is checked against. Without it,
 * a template that can interpolate any field will eventually interpolate a
 * per-recipient secret into a message going to every account — so the permitted
 * fields are data on the template, not a convention in the rendering code.
 */
export const emailTemplates = app.table(`${TABLE_PREFIX}email_templates`, {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  audience: emailAudience("audience").notNull(),
  /**
   * Whether consent is required and whether secrets are permitted.
   *
   * Separate from `audience`, which is only who it goes to. A marketing message
   * addressed to vendors is still marketing.
   */
  class: emailTemplateClass("class").notNull(),
  /** What causes it to send, e.g. "Sends when a customer pays the deposit". */
  trigger: text("trigger"),
  /** Automatic templates fire from a job; manual ones an admin sends. */
  automatic: timestamp("automatic_since", { withTimezone: true }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  allowedMergeFields: jsonb("allowed_merge_fields").notNull(),
  ...timestamps,
});

/** One delivery. Also the ingress for provider delivery statistics. */
export const emailSends = app.table(
  `${TABLE_PREFIX}email_sends`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id").references(() => emailTemplates.id, {
      onDelete: "set null",
    }),
    /**
     * The send this row was part of, when it was part of one.
     *
     * A broadcast is one decision and many rows. Without a shared id the send
     * log can only count messages, and "how did that policy email do" has no
     * answer.
     */
    broadcastId: uuid("broadcast_id"),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    state: emailSendState("state").notNull().default("queued"),
    /** Stops a retried job sending the same message twice. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    providerMessageId: text("provider_message_id"),
    mergeValues: jsonb("merge_values"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
    /**
     * The secret that unsubscribes this recipient.
     *
     * Commercial email must carry a working unsubscribe, and it has to work for
     * somebody who is not signed in — so it is a per-send secret rather than a
     * link naming the account, which would unsubscribe anyone who edited it.
     * Null on transactional mail, which has nothing to unsubscribe from.
     */
    unsubscribeToken: text("unsubscribe_token").unique(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    index("email_sends_template_idx").on(table.templateId),
    index("email_sends_state_idx").on(table.state),
    index("email_sends_recipient_idx").on(table.recipientUserId),
    index("email_sends_broadcast_idx").on(table.broadcastId),
    index("email_sends_created_idx").on(table.createdAt.desc()),
  ],
);
