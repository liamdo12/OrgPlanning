import type { EmailTemplate } from "../template.js";

/** `pending_payment → confirmed`. The deposit is captured and the date is held. */
export const orderConfirmed: EmailTemplate = {
  key: "order_confirmed",
  name: "Booking confirmed",
  audience: "customers",
  class: "automatic",
  trigger: "Sends when a customer pays the deposit",
  autoSend: true,
  subject: "Your booking with {{vendor_name}} is confirmed",
  body: [
    "Hi {{customer_first_name}},",
    "",
    "Thanks for booking {{service_name}} for {{event_name}} on {{event_date}}.",
    "",
    "Your deposit of {{deposit_amount}} is paid and the balance of {{balance_amount}} will be charged on {{balance_date}}. You can cancel free of charge for the next 48 hours.",
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
    "deposit_amount",
    "balance_amount",
    "balance_date",
    "order_reference",
    "brand_name",
  ],
};
