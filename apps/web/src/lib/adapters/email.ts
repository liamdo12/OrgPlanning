import type { EmailPort } from "@occasion/core";
import { notImplemented } from "./not-implemented";

/**
 * Resend adapter.
 *
 * Sends to a sandbox recipient with no domain verification until the live
 * pilot. Consent and the merge-field allowlist are enforced in the service
 * layer above this port, not here.
 */
export function createEmail(): EmailPort {
  return {
    send: () => notImplemented("Email delivery"),
  };
}
