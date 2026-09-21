import type { EmailTemplate } from "../template.js";

/**
 * `balance_due → confirmed`, and `action_required → confirmed`.
 *
 * A separate message from the booking confirmation, although both land the
 * order in `confirmed`. Sending "your booking is confirmed" a second time,
 * when the balance is taken weeks later, reads as a duplicate and buries the
 * one fact the customer needs: money has just left their card.
 */
export const balanceCharged: EmailTemplate = {
  key: "balance_charged",
  name: "Balance charged",
  audience: "customers",
  class: "automatic",
  // No number here, and that is deliberate. How far ahead of the event the
  // balance is charged is a platform setting an administrator edits, so a
  // figure written into this line contradicts the settings screen the moment
  // anyone changes it.
  //
  // Interpolating the live value would be worse, not better: this string is
  // persisted onto the template row by every save, including the save that a
  // single click on the auto-send toggle performs, and a saved row wins over
  // the shipped module from then on. The number would be frozen into a row
  // nobody thinks to look at, still claiming to describe a setting.
  trigger: "Sends when the balance is captured, the configured number of days before the event",
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
