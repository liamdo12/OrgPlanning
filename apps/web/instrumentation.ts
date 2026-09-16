/**
 * Runs once when the server starts (not during `next build`).
 *
 * This is where environment validation becomes boot-time: a deployment with a
 * missing or contradictory variable — a production tier carrying a clock
 * override, a live Stripe key — dies here rather than serving requests.
 */
export async function register() {
  // Node runtime only; the Edge runtime has no access to the full env anyway.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("./src/lib/env");
  const env = getEnv();

  console.warn(`[occasion] booted APP_TIER=${env.APP_TIER}`);
}
