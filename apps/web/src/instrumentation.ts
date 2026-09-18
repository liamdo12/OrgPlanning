/**
 * Runs once when the server starts (not during `next build`).
 *
 * This is where environment validation becomes boot-time: a deployment with a
 * missing or contradictory variable — a production tier carrying a clock
 * override, a live Stripe key — dies here rather than serving requests.
 *
 * It has to exit the process to do that. Throwing out of `register()` is not
 * enough: Next logs the error and carries on, so the container stays up and
 * answers every request with a 500 instead of refusing to be one. That is the
 * worst of both — a deployment that looks alive to an orchestrator, fails every
 * health check it is given, and never says why except in a stack trace nobody
 * is reading.
 */
export async function register() {
  // Node runtime only; the Edge runtime has no access to the full env anyway.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("./lib/env");

  try {
    const env = getEnv();
    console.warn(`[occasion] booted APP_TIER=${env.APP_TIER}`);
  } catch (error) {
    // The message is the whole point of failing here — it names the variable
    // and what was wrong with it — so it is printed rather than rethrown.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
