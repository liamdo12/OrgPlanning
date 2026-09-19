import type { EmailTemplate } from "../template.js";

/**
 * Every ending that is not delivery: a cooling-window cancellation, a grace
 * window that ran out, or an administrator calling it off.
 *
 * `{{refund_amount}}` is always filled, with a zero amount where nothing goes
 * back, rather than being left out of the body when there is no refund. A
 * customer whose card was charged reads this message specifically to find out
 * what happens to the money, and silence is the answer they assume is bad.
 */
export const orderCancelled: EmailTemplate = {
  key: "order_cancelled",
  name: "Booking cancelled",
  audience: "customers",
  class: "automatic",
  trigger: "Sends when an order is cancelled",
  autoSend: true,
  subject: "{{event_name}} with {{vendor_name}} is cancelled",
  body: [
    "Hi {{customer_first_name}},",
    "",
    "Your booking of {{service_name}} for {{event_name}} on {{event_date}} has been cancelled.",
    "",
    "{{refund_amount}} is being returned to the card you paid with. Refunds usually take five to ten business days to appear.",
    "",
    "Order {{order_reference}}.",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: [
    "customer_first_name",
    "vendor_name",
    "service_name",
    "event_name",
    "event_date",
    "refund_amount",
    "order_reference",
    "brand_name",
  ],
};
