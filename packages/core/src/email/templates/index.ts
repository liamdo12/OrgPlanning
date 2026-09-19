import { assertBodyFields, assertNoRestrictedFields } from "../render.js";
import type { EmailTemplate } from "../template.js";
import { accountVerification } from "./account-verification.js";
import { balanceCharged } from "./balance-charged.js";
import { balanceFailed } from "./balance-failed.js";
import { orderCancelled } from "./order-cancelled.js";
import { orderCompleted } from "./order-completed.js";
import { orderConfirmedInFull } from "./order-confirmed-in-full.js";
import { orderConfirmed } from "./order-confirmed.js";
import { payoutNotice } from "./payout-notice.js";
import { policyUpdate } from "./policy-update.js";
import { quoteExpiring } from "./quote-expiring.js";
import { refundIssued } from "./refund-issued.js";
import { vendorApproved } from "./vendor-approved.js";

/**
 * The library, in the order the screen lists it.
 *
 * The prototype's five admin templates come first because that is the screen
 * being built (lines 2647–2651); the lifecycle's own messages follow, in the
 * order an order meets them.
 */
const ALL: readonly EmailTemplate[] = [
  policyUpdate,
  payoutNotice,
  balanceFailed,
  accountVerification,
  vendorApproved,
  orderConfirmed,
  orderConfirmedInFull,
  balanceCharged,
  orderCancelled,
  orderCompleted,
  refundIssued,
  quoteExpiring,
];

/**
 * Every rule a template has to satisfy, asserted as this module loads.
 *
 * Importing anything in this package runs it, so a template that could never
 * render — a body referencing a field its own allowlist omits — fails at
 * startup rather than at send time. The two are worth distinguishing: a startup
 * failure is a deployment that does not happen, and a send-time failure is a
 * confirmation email that does not arrive for an order somebody already paid
 * for.
 *
 * `__tests__/render-allowlist.test.ts` asserts the same rules explicitly, so
 * the guarantee is legible without reading this file.
 */
function check(template: EmailTemplate): EmailTemplate {
  const where = `The "${template.name}" template`;

  assertBodyFields(template.subject, template.allowedFields, where);
  assertBodyFields(template.body, template.allowedFields, where);

  if (template.class === "broadcast") {
    assertNoRestrictedFields(template.subject, template.body, template.allowedFields, where);
  }

  return template;
}

const BY_KEY = new Map(ALL.map((template) => [template.key, check(template)]));

/** Every template the platform ships, before any administrator edit. */
export function builtInTemplates(): readonly EmailTemplate[] {
  return ALL;
}

export function builtInTemplate(key: string): EmailTemplate | undefined {
  return BY_KEY.get(key);
}

/**
 * The keys the lifecycle names, as a type.
 *
 * A job payload carries one of these, and a typo in an enqueue call would
 * otherwise become a job that fails every attempt until it is given up on —
 * with the order it was about long since past. Written out rather than derived
 * from `ALL`, because `EmailTemplate["key"]` is `string` and a type inferred
 * from it would accept every typo it exists to catch.
 */
export type TemplateKey =
  | "policy_update"
  | "payout_notice"
  | "balance_failed"
  | "account_verification"
  | "vendor_approved"
  | "order_confirmed"
  | "order_confirmed_in_full"
  | "balance_charged"
  | "order_cancelled"
  | "order_completed"
  | "refund_issued"
  | "quote_expiring";

/** The union above and the library agree, or nothing in this package loads. */
const KEYS: readonly TemplateKey[] = [
  "policy_update",
  "payout_notice",
  "balance_failed",
  "account_verification",
  "vendor_approved",
  "order_confirmed",
  "order_confirmed_in_full",
  "balance_charged",
  "order_cancelled",
  "order_completed",
  "refund_issued",
  "quote_expiring",
];

for (const key of KEYS) {
  if (!BY_KEY.has(key)) {
    throw new Error(`The template library is missing "${key}".`);
  }
}

if (BY_KEY.size !== KEYS.length) {
  throw new Error("The template library holds a template that TemplateKey does not name.");
}
