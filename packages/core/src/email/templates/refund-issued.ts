import type { EmailTemplate } from "../template.js";

/** `completed → refunded` and `cancelled → refunded`: the money has actually moved. */
export const refundIssued: EmailTemplate = {
  key: "refund_issued",
  name: "Refund issued",
  audience: "customers",
  class: "automatic",
  trigger: "Sends when a refund settles",
  autoSend: true,
  subject: "Your refund for {{event_name}}",
  body: [
    "Hi {{customer_first_name}},",
    "",
    "{{refund_amount}} has been refunded to the card you paid with for {{event_name}}. It usually appears within five to ten business days, depending on your bank.",
    "",
    "Order {{order_reference}}.",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: [
    "customer_first_name",
    "event_name",
    "refund_amount",
    "order_reference",
    "brand_name",
  ],
};
