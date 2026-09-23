import { index, integer, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { app, currency, money, timestamps, TABLE_PREFIX } from "./common.js";
import { paymentKind, paymentState, refundState, transferKind, transferState } from "./enums.js";
import { orders } from "./ordering.js";
import { users, vendors } from "./identity.js";

/**
 * One attempt to take money.
 *
 * The row is written in `pending` **before** the provider is called, and its id
 * is the idempotency key for that call. Keying on the order id instead would
 * double-charge once the provider's key window expires, and would collide the
 * moment an order needs a second attempt.
 */
export const payments = app.table(
  `${TABLE_PREFIX}payments`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    kind: paymentKind("kind").notNull(),
    state: paymentState("state").notNull().default("pending"),
    amount: money("amount").notNull(),
    currency,
    providerPaymentIntentId: text("provider_payment_intent_id").unique(),
    providerChargeId: text("provider_charge_id"),
    /** Whether the charge ran without the customer present. */
    offSession: timestamp("off_session_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    /**
     * The last four digits of the card this attempt settled on.
     *
     * The only thing about a payment instrument stored here, and the reason it
     * is stored at all is that a customer whose balance was declined has to be
     * told which card to fix, and the planner says which card the balance will
     * be taken on. Everything else about the card stays at the provider.
     *
     * Null while an attempt is still open, and null when the provider did not
     * report one — a declined off-session charge does not always come back with
     * a card attached, and the message says "your card" then.
     */
    cardLast4: text("card_last4"),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("payments_order_idx").on(table.orderId),
    index("payments_state_idx").on(table.state),
  ],
);

/**
 * Money moving to a vendor's connected account.
 *
 * Unique per order and kind, so a retried job cannot pay the same share twice.
 * `held` is the state a suspended vendor's payout sits in: suspension has to
 * stop money leaving, not merely hide the vendor from search.
 */
export const transfers = app.table(
  `${TABLE_PREFIX}transfers`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    kind: transferKind("kind").notNull(),
    state: transferState("state").notNull().default("pending"),
    amount: money("amount").notNull(),
    currency,
    providerTransferId: text("provider_transfer_id").unique(),
    heldReason: text("held_reason"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("transfers_order_kind_key").on(table.orderId, table.kind),
    index("transfers_vendor_idx").on(table.vendorId),
    index("transfers_state_idx").on(table.state),
  ],
);

/**
 * Money going back to a customer.
 *
 * Like payments, the row precedes the provider call and its id is the
 * idempotency key. `needs_attention` covers the case where the customer has
 * been refunded but the vendor side has not been reversed — two systems, two
 * writes, and a real state in between that someone has to clear.
 */
export const refunds = app.table(
  `${TABLE_PREFIX}refunds`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    state: refundState("state").notNull().default("requested"),
    amount: money("amount").notNull(),
    currency,
    reason: text("reason"),
    /** Set when an admin recorded a refund made in the provider dashboard. */
    recordedExternally: timestamp("recorded_externally_at", { withTimezone: true }),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    providerRefundId: text("provider_refund_id").unique(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("refunds_order_idx").on(table.orderId),
    index("refunds_state_idx").on(table.state),
    index("refunds_payment_idx").on(table.paymentId),
    index("refunds_requested_by_idx").on(table.requestedByUserId),
  ],
);

/**
 * A single-use link emailed to rescue a declined balance.
 *
 * The token is opaque and random rather than the order id, because an emailed
 * URL built from a domain id can be walked to every other order by changing a
 * number.
 */
export const paymentLinks = app.table(
  `${TABLE_PREFIX}payment_links`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    amount: money("amount").notNull(),
    currency,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set on first successful use; a second visit must not work. */
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("payment_links_order_idx").on(table.orderId)],
);

/**
 * Raw provider webhooks.
 *
 * Idempotency is `processedAt IS NOT NULL`, never the mere existence of the
 * row: a handler that fails halfway must be retried, and a row that exists but
 * was never processed is exactly that case. Events can also arrive before the
 * object they describe, so the payload is kept whole for replay.
 */
export const stripeEvents = app.table(
  `${TABLE_PREFIX}stripe_events`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull().unique(),
    type: text("type").notNull(),
    /** Connected account the event belongs to, when it is not the platform's. */
    account: text("account"),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    index("stripe_events_processed_idx").on(table.processedAt),
    index("stripe_events_type_idx").on(table.type),
  ],
);
