import type { EmailTemplate } from "../template.js";

/**
 * `fulfilled → completed`, 72 hours after the event ends.
 *
 * The lifecycle table calls this "review unlocked", and that is what the
 * message is for: the same job releases the vendor's balance share, so this is
 * the first moment a review can be written by somebody whose booking is
 * genuinely finished and paid for.
 *
 * It carries no `{{review_link}}`, and that is deliberate. The customer views
 * that would hold a review form are a later milestone, so a link here would
 * point at a page that does not exist — a plausible-looking URL in a real email
 * to a real customer, which is worse than saying less. The field stays in the
 * catalogue and the sentence arrives with the page. Recorded in
 * `docs/design-gaps.md`.
 */
export const orderCompleted: EmailTemplate = {
  key: "order_completed",
  name: "Thank you and review",
  audience: "customers",
  class: "automatic",
  trigger: "Sends 72 hours after the event",
  autoSend: true,
  subject: "How was {{vendor_name}}?",
  body: [
    "Hi {{customer_first_name}},",
    "",
    "It was a pleasure being part of {{event_name}}. Your booking is complete and {{vendor_name}} has been paid.",
    "",
    "If you have two minutes, a review helps other people in {{city}} find them. You can leave one from your bookings.",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: ["customer_first_name", "vendor_name", "event_name", "city", "brand_name"],
};
