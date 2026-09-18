import { index, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, currency, isDemo, money, timestamps, TABLE_PREFIX } from "./common.js";
import { orderState } from "./enums.js";
import { users, vendors } from "./identity.js";
import { events } from "./planning.js";
import { services, servicePackages } from "./catalog.js";
import { policyTemplates } from "./reference.js";

/** A cart in progress. Becomes an order when the deposit succeeds. */
export const checkouts = app.table(
  `${TABLE_PREFIX}checkouts`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    /** Snapshot of the priced lines, so an abandoned cart stays explainable. */
    draft: jsonb("draft").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("checkouts_user_idx").on(table.userId),
    index("checkouts_event_idx").on(table.eventId),
  ],
);

/**
 * A booking with one vendor.
 *
 * Money is decomposed rather than stored as a single total, because the split
 * has to reconcile three ways. `subtotal` is pre-tax; `commission` is charged
 * on the subtotal alone; `tax` is the vendor's HST on their own supply and is
 * theirs to remit, so it is tracked separately from the platform's cut.
 *
 * Source for the seeded figures: the checkout summary, lines 1172–1178 —
 * subtotal C$290.00, HST 13% C$37.70, total C$327.70, deposit C$65.54,
 * balance C$262.16.
 */
export const orders = app.table(
  `${TABLE_PREFIX}orders`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human reference shown to customers and admins, e.g. "TO-4192". */
    reference: text("reference").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    state: orderState("state").notNull().default("pending_payment"),

    subtotal: money("subtotal").notNull(),
    /** The vendor's HST on their supply. Zero when the vendor is unregistered. */
    tax: money("tax").notNull(),
    total: money("total").notNull(),
    /** Platform commission on the pre-tax subtotal. */
    commission: money("commission").notNull(),
    /** HST the platform charges the vendor on that commission. */
    commissionTax: money("commission_tax").notNull(),
    depositAmount: money("deposit_amount").notNull(),
    balanceAmount: money("balance_amount").notNull(),
    currency,

    policyTemplateId: uuid("policy_template_id").references(() => policyTemplates.id, {
      onDelete: "set null",
    }),
    /** When free cancellation ends and the deposit becomes transferable. */
    coolingWindowEndsAt: timestamp("cooling_window_ends_at", { withTimezone: true }),
    /** When the balance is charged off-session. */
    balanceDueAt: timestamp("balance_due_at", { withTimezone: true }),
    /** Deadline for a customer to rescue a declined balance before release. */
    graceExpiresAt: timestamp("grace_expires_at", { withTimezone: true }),
    /** When an untouched fulfilled order completes itself. */
    autoCompleteAt: timestamp("auto_complete_at", { withTimezone: true }),

    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    issueNote: text("issue_note"),
    isDemo,
    ...timestamps,
  },
  (table) => [
    index("orders_user_idx").on(table.userId),
    index("orders_vendor_idx").on(table.vendorId),
    index("orders_event_idx").on(table.eventId),
    index("orders_state_idx").on(table.state),
    index("orders_balance_due_idx").on(table.balanceDueAt),
    index("orders_policy_template_idx").on(table.policyTemplateId),
    // The admin list's sort and its keyset cursor. Both columns, both
    // descending, because a cursor on `(created_at, id)` can only be satisfied
    // by an index in the same order — with one on `created_at` alone, every
    // page after the first re-sorts the ties.
    //
    // `nullsFirst` is not cosmetic and neither column is nullable: plain
    // `order by x desc` means `desc nulls first` in Postgres, and an index
    // built `desc nulls last` cannot satisfy that ordering, so the planner
    // ignores it and sorts the whole table for every page. Verified with
    // `explain` at fifty thousand orders — the same query picks an index-only
    // scan with this and a sequential scan without it.
    index("orders_created_idx").on(
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
  ],
);

export const orderItems = app.table(
  `${TABLE_PREFIX}order_items`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    servicePackageId: uuid("service_package_id").references(() => servicePackages.id, {
      onDelete: "set null",
    }),
    /** Copied at purchase: the catalogue may change, the receipt may not. */
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: money("unit_price").notNull(),
    lineTotal: money("line_total").notNull(),
    currency,
    ...timestamps,
  },
  (table) => [
    index("order_items_order_idx").on(table.orderId),
    index("order_items_service_idx").on(table.serviceId),
    index("order_items_service_package_idx").on(table.servicePackageId),
  ],
);
