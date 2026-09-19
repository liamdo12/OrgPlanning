import type { EmailTemplate } from "../template.js";

/**
 * The prototype's "Payout notice" (line 2648).
 *
 * Operational mail to businesses, sent by an administrator rather than by a
 * timer, so `autoSend` is false. `{{bank_last4}}` is a restricted field and is
 * legal here because the class is `vendors`, not `broadcast`: this is rendered
 * once per recipient against that recipient's own payout. The same token in a
 * broadcast is refused when the template is saved.
 */
export const payoutNotice: EmailTemplate = {
  key: "payout_notice",
  name: "Payout notice",
  audience: "vendors",
  class: "vendors",
  trigger: "Send to vendors with a pending payout",
  autoSend: false,
  subject: "Your payout of {{payout_amount}} is on the way",
  body: [
    "Hi {{first_name}},",
    "",
    "{{payout_amount}} for {{order_count}} orders was released on {{payout_date}} and should land in {{bank_last4}} within two business days.",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: [
    "first_name",
    "payout_amount",
    "order_count",
    "payout_date",
    "bank_last4",
    "brand_name",
  ],
};
