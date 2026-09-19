import type { EmailTemplate } from "../template.js";

/** The prototype's "Vendor approved" (line 2651), sent when a business passes review. */
export const vendorApproved: EmailTemplate = {
  key: "vendor_approved",
  name: "Vendor approved",
  audience: "vendors",
  class: "vendors",
  trigger: "Sends when a business passes review",
  autoSend: true,
  subject: "You are live on {{brand_name}}",
  body: [
    "Hi {{first_name}},",
    "",
    "{{vendor_name}} is approved and your services are live. Customers in {{city}} can book you from today.",
    "",
    "Set your availability before your first request: {{calendar_link}}",
    "",
    "The {{brand_name}} team",
  ].join("\n"),
  allowedFields: ["first_name", "vendor_name", "city", "calendar_link", "brand_name"],
};
