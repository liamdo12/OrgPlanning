import type { EmailTemplate } from "../template.js";

/**
 * The prototype's "Failed payment" (line 2649), and the one message on the
 * platform that carries a bearer credential.
 *
 * `{{payment_link}}` is a single-use token minted when the charge declined, and
 * `{{grace_deadline}}` is the instant the `balance_grace_expiry` job will
 * cancel the order — the same instant the link expires, because both come from
 * one reading of the clock rather than two. A deadline written a few minutes
 * either side of the job would either promise time the customer does not have
 * or cancel a booking while the email still says it is safe.
 *
 * Restricted fields are legal here because the class is `automatic`: this body
 * is rendered once per recipient, against that recipient's own order.
 */
export const balanceFailed: EmailTemplate = {
  key: "balance_failed",
  name: "Failed payment",
  audience: "customers",
  class: "automatic",
  trigger: "Sends when a balance charge fails",
  autoSend: true,
  subject: "We could not charge your card for {{event_name}}",
  body: [
    "Hi {{first_name}},",
    "",
    "The balance of {{balance_amount}} for {{event_name}} could not be charged to {{card_last4}}. Your booking is safe until {{grace_deadline}}.",
    "",
    "Update your card: {{payment_link}}",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: [
    "first_name",
    "event_name",
    "balance_amount",
    "card_last4",
    "grace_deadline",
    "payment_link",
    "brand_name",
  ],
};
