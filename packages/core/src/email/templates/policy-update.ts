import type { EmailTemplate } from "../template.js";

/**
 * The prototype's "Policy update" (line 2647), and the only broadcast that
 * ships with the platform.
 *
 * Its allowlist is four open fields, and that is the whole example: a body
 * written once and sent to an audience can only interpolate things the
 * recipient already knows. Adding `{{payment_link}}` to it is refused when the
 * template is saved, not when the send goes out.
 */
export const policyUpdate: EmailTemplate = {
  key: "policy_update",
  name: "Policy update",
  audience: "all",
  class: "broadcast",
  trigger: "Send to a whole audience",
  autoSend: false,
  subject: "Changes to the cancellation policy on {{effective_date}}",
  body: [
    "Hi {{first_name}},",
    "",
    "From {{effective_date}} the free-cancellation window moves to 48 hours after booking. Nothing changes for orders already placed.",
    "",
    "The full policy is here: {{policy_link}}",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: ["first_name", "effective_date", "policy_link", "brand_name"],
};
