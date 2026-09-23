import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * The provider's browser SDK, loaded once per key.
 *
 * **It reads no environment.** `getEnv()` parses the whole `process.env`
 * object, which Next cannot inline into a client bundle, and `env.ts` has no
 * `server-only` guard — importing it here would list every server key by name
 * in a file the browser downloads. A `NEXT_PUBLIC_` variable is no better: it
 * inlines at **build** time, and this app's container image is built with no
 * environment on purpose, so the deployed checkout would render with no card
 * field while `pnpm dev` and CI both looked healthy.
 *
 * So the key is read on the server and arrives here as an argument.
 *
 * Memoised because `loadStripe` injects a script tag: calling it on every
 * render would add one per render. Keyed by the key itself, so a page rendered
 * against a different account cannot be handed the wrong account's SDK — which
 * is not a thing this milestone does, and is one line rather than a comment
 * saying it must not.
 */
const loaded = new Map<string, Promise<Stripe | null>>();

export function stripeBrowser(publishableKey: string): Promise<Stripe | null> {
  const existing = loaded.get(publishableKey);
  if (existing) return existing;

  const pending = loadStripe(publishableKey);
  loaded.set(publishableKey, pending);
  return pending;
}
