import type { EmailTemplate } from "../template.js";

/**
 * `balance_due → confirmed`, and `action_required → confirmed`.
 *
 * A separate message from the booking confirmation, although both land the
 * order in `confirmed`. Sending "your booking is confirmed" a second time,
 * fourteen days before the event, reads as a duplicate and buries the one fact
 * the customer needs: money has just left their card.
 */
export const balanceCharged: EmailTemplate = {
  key: "balance_charged",
  name: "Balance charged",
  audience: "customers",
  class: "automatic",
  trigger: "Sends when the balance is captured, 14 days before the event",
  autoSend: true,
  subject: "The balance for {{event_name}} is paid",
  body: [
    "Hi {{customer_first_name}},",
    "",
    "The balance of {{balance_amount}} for {{event_name}} on {{event_date}} has been charged. Nothing further is owed.",
    "",
    "{{vendor_name}} will be in touch before the day about timings and access.",
    "",
    "Order {{order_reference}}.",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: [
    "customer_first_name",
    "vendor_name",
    "event_name",
    "event_date",
    "balance_amount",
    "order_reference",
    "brand_name",
  ],
};
