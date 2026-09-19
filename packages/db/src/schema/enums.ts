import { app } from "./common.js";

/**
 * Every enum in one module so the whole state vocabulary is readable at once,
 * and so a phase that adds a state cannot add it in two spellings.
 *
 * Values are taken from the prototype where it defines them; the citations are
 * line numbers in `design/Event Marketplace Glass.dc.html`.
 */

/** Vendor approval state. Source: adminVendors, lines 2715–2720. */
export const vendorStatus = app.enum("vendor_status", [
  "pending",
  "approved",
  "suspended",
  "blocked",
]);

/**
 * Account state. Four values, not two: the prototype's user list shows Dae Kim
 * Pending, Jonah Tran Unverified and Bea Varga Suspended alongside the Active
 * accounts. Source: adminUsers, lines 2629–2634.
 */
export const userStatus = app.enum("user_status", ["active", "pending", "unverified", "suspended"]);

export const userRoleName = app.enum("user_role_name", ["customer", "vendor", "admin"]);

/**
 * Order lifecycle.
 *
 * `action_required` is the declined-balance state that holds capacity while the
 * customer pays through a link; `issue` is the human-attention state an admin
 * resolves. Both exist because the prototype's admin screen shows them and
 * nothing else in the lifecycle could represent them.
 */
export const orderState = app.enum("order_state", [
  "pending_payment",
  "confirmed",
  "balance_due",
  "action_required",
  "issue",
  "fulfilled",
  "completed",
  "cancelled",
  "refunded",
]);

export const paymentKind = app.enum("payment_kind", ["deposit", "balance", "full"]);

export const paymentState = app.enum("payment_state", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
]);

/**
 * Refund state.
 *
 * `needs_attention` exists because a refund and its transfer reversal are two
 * writes to two systems: when the money has left the customer but the vendor
 * side has not settled, that is a real state someone must clear, not a note in
 * a free-text field.
 */
export const refundState = app.enum("refund_state", ["requested", "settled", "needs_attention"]);

export const transferKind = app.enum("transfer_kind", ["deposit_share", "balance_share"]);

export const transferState = app.enum("transfer_state", [
  "pending",
  "paid",
  "held",
  "failed",
  "reversed",
]);

/**
 * Scheduled work. Each value is produced by a rule, never hand-queued.
 *
 * `expire_unpaid` releases the soft capacity hold a checkout takes: an order
 * sits in `pending_payment` holding its date, and if the deposit never arrives
 * nothing else would ever free it. The order lifecycle
 * (`packages/core/src/ordering/lifecycle.md`) schedules it thirty minutes out.
 */
export const jobType = app.enum("job_type", [
  "expire_unpaid",
  "cooling_window_transfer",
  "charge_balance",
  "expire_quote_request",
  "auto_complete_order",
  "balance_grace_expiry",
  "send_email",
]);

/** `held` means blocked by vendor status — a suspended vendor stops payouts. */
export const jobStatus = app.enum("job_status", ["queued", "running", "done", "failed", "held"]);

/** How a service is bought. Source: services list, lines 1950–1961. */
export const bookingMode = app.enum("booking_mode", ["book_now", "quote"]);

/** What a price is per. Source: `unit` on the services list, lines 1950–1961. */
export const priceUnit = app.enum("price_unit", [
  "event",
  "guest",
  "bouquet",
  "cake",
  "install",
  "arch",
  "table",
  "package",
  "hour",
]);

export const quoteRequestState = app.enum("quote_request_state", [
  "open",
  "closed",
  "expired",
  "booked",
]);

export const quoteOfferState = app.enum("quote_offer_state", [
  "sent",
  "accepted",
  "declined",
  "withdrawn",
  "expired",
]);

export const eventVisibility = app.enum("event_visibility", ["private", "shared"]);

/** Cancellation policy family. Source: policy selector, line 1889 (`Moderate`). */
export const policyTier = app.enum("policy_tier", ["flexible", "moderate", "strict"]);

/** Where a place sits in the search list. Source: places(), lines 1915–1932. */
export const placeKind = app.enum("place_kind", ["neighbourhood", "district", "venue", "city"]);

export const emailAudience = app.enum("email_audience", ["customers", "vendors", "admins", "all"]);

/**
 * What a template is for.
 *
 * `automatic` is transactional — the lifecycle sends it, the recipient asked
 * for it by placing an order, and it may carry per-recipient secrets.
 * `vendors` is operational mail to businesses on the platform. `broadcast` is
 * marketing: it needs express consent per recipient and may carry no secret at
 * all, because a broadcast body is written once and sent to everyone.
 */
export const emailTemplateClass = app.enum("email_template_class", [
  "automatic",
  "vendors",
  "broadcast",
]);

export const emailSendState = app.enum("email_send_state", [
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
]);

/**
 * Consent channel. Canadian anti-spam law distinguishes express from implied
 * consent and they expire differently, so consent is a row with a basis and a
 * timestamp rather than a boolean on the user.
 */
export const consentChannel = app.enum("consent_channel", ["marketing_email", "product_email"]);

export const consentBasis = app.enum("consent_basis", ["express", "implied", "withdrawn"]);

/** Who or what caused an audited change. */
export const jobTrigger = app.enum("job_trigger", ["cron", "admin_button", "system"]);

export const disputeState = app.enum("dispute_state", [
  "open",
  "under_review",
  "resolved",
  "rejected",
]);

export const moderationState = app.enum("moderation_state", ["pending", "approved", "rejected"]);

/**
 * How a dispute ended.
 *
 * Separate from `state` because "closed" and "what was done about it" are
 * different facts, and only the second one answers a vendor asking why their
 * payout was reversed. `dismissed` pairs with the `rejected` state and the
 * other two with `resolved`; the pairing is a check constraint rather than a
 * convention, so a case cannot be dismissed and refunded at once.
 */
export const disputeResolution = app.enum("dispute_resolution", [
  "refund_recorded",
  "vendor_warned",
  "dismissed",
  "settled_with_order",
]);

/**
 * What a content report is about.
 *
 * The three kinds of text a person can write that another person can see: a
 * review, a message in a thread, and the line a business writes about itself.
 */
export const contentTarget = app.enum("content_target", ["review", "message", "vendor_profile"]);

/**
 * A moderator's decision, and what it does to the content.
 *
 * `hide` unpublishes and keeps the words, `remove` unpublishes and redacts
 * them. Both are needed: hiding is reversible and is what a borderline call
 * deserves, while a defamatory or personal-information posting has to stop
 * existing in the row an administrator can read.
 */
export const contentDecision = app.enum("content_decision", ["keep", "hide", "remove"]);
