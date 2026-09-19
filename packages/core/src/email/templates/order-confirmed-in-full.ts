import type { EmailTemplate } from "../template.js";

/**
 * `pending_payment → confirmed` for a booking that was paid in full.
 *
 * A short-notice or small booking takes the whole total at checkout, so there
 * is no balance, no balance date and no charge coming. The other confirmation's
 * body promises all three.
 *
 * A second template rather than a conditional inside one, for the same reason
 * `jobsOnEntering` takes an `OrderShape`: the difference is what the order *is*,
 * not a detail of how it is worded, and a template with a branch in it is a
 * template an administrator cannot safely edit. It also keeps the invariant
 * that every field an automatic template may use is one the lifecycle always
 * supplies — the alternative is a body referencing `{{balance_date}}` for an
 * order that has no such date, which refuses the send and, because the message
 * is queued inside the transaction that confirmed the order, rolls back the
 * confirmation of a booking somebody has already paid for.
 */
export const orderConfirmedInFull: EmailTemplate = {
  key: "order_confirmed_in_full",
  name: "Booking confirmed (paid in full)",
  audience: "customers",
  class: "automatic",
  trigger: "Sends when a booking is paid in full at checkout",
  autoSend: true,
  subject: "Your booking with {{vendor_name}} is confirmed",
  body: [
    "Hi {{customer_first_name}},",
    "",
    "Thanks for booking {{service_name}} for {{event_name}} on {{event_date}}.",
    "",
    "This one was paid in full at checkout, so nothing further is owed. You can cancel free of charge for the next 48 hours.",
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
    "order_reference",
    "brand_name",
  ],
};
