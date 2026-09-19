import type { EmailTemplate } from "../template.js";

/**
 * The prototype's "Account verification" (line 2650).
 *
 * It sits in the library so an administrator can read and edit the words, but
 * the platform does not send it: address confirmation is the auth provider's,
 * and it is the provider confirming an address that the identity layer relies
 * on before it will bind a provider subject to an existing account. A second
 * verification path of this platform's own would be a second answer to "is this
 * address really theirs", and the weaker of the two would be the one that
 * mattered.
 *
 * So `autoSend` is false and nothing enqueues it. That is a deliberate gap, not
 * an unfinished one.
 */
export const accountVerification: EmailTemplate = {
  key: "account_verification",
  name: "Account verification",
  audience: "all",
  class: "automatic",
  trigger: "Sent by the sign-in provider, not by this platform",
  autoSend: false,
  subject: "Confirm your email to finish signing up",
  body: [
    "Hi {{first_name}},",
    "",
    "Confirm your email to finish setting up your {{brand_name}} account.",
    "",
    "{{verify_link}}",
    "",
    "The link expires in 24 hours.",
  ].join("\n"),
  allowedFields: ["first_name", "brand_name", "verify_link"],
};
