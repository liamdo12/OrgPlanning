import type { StripePort } from "@occasion/core";

/**
 * Stripe adapter.
 *
 * `mode()` is real from the start because admin screens label rows by the mode
 * that produced them, and because it makes the test-mode-only rule observable:
 * the environment schema refuses anything but a test key, and this reports what
 * the process is actually holding.
 */
export function createStripe(secretKey: string): StripePort {
  const mode = secretKey.startsWith("sk_live_") ? "live" : "test";

  return {
    mode: () => mode,
  };
}
