import type { EmailTemplate } from "../template.js";

/**
 * A quote request coming up on its deadline.
 *
 * Sent by the `expire_quote_request` job as it closes the request, so the
 * message is the notification of an ending rather than a reminder that races
 * one. A reminder scheduled separately is a second timer to keep in step with
 * the first, and the two drift the moment either deadline changes.
 */
export const quoteExpiring: EmailTemplate = {
  key: "quote_expiring",
  name: "Quote request closed",
  audience: "customers",
  class: "automatic",
  trigger: "Sends when a quote request reaches its deadline",
  autoSend: true,
  subject: "Your request for {{event_name}} has closed",
  body: [
    "Hi {{customer_first_name}},",
    "",
    "Your request for {{event_name}} on {{event_date}} reached its deadline of {{quote_expiry}}, so any offers on it have been withdrawn.",
    "",
    "If you still need somebody, starting a new request takes a minute and puts it back in front of businesses in {{city}}.",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: [
    "customer_first_name",
    "event_name",
    "event_date",
    "quote_expiry",
    "city",
    "brand_name",
  ],
};
