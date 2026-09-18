import type { StatusChange } from "@occasion/core";

/**
 * What the platform just did, in a sentence.
 *
 * Its own module rather than a helper inside the server actions, because that
 * file cannot be imported outside Next — it reaches the request through
 * `next/headers` — and this is the one piece of the queue's wiring worth
 * asserting on its own.
 *
 * The counts are not decoration. Suspending a business stops money that was
 * already scheduled and signs its staff out, and an administrator is
 * answerable for both; a message that said only "suspended" would leave them
 * to guess whether a payout went out this morning.
 */
export function summarise(change: StatusChange): string {
  const parts: string[] = [`${change.name} is now ${change.to}.`];

  const held = change.heldTransfers + change.heldJobs;
  if (held > 0) {
    parts.push(`${held} queued ${held === 1 ? "payout is" : "payouts are"} on hold.`);
  }

  const released = change.releasedTransfers + change.releasedJobs;
  if (released > 0) {
    parts.push(`${released} held ${released === 1 ? "payout" : "payouts"} released.`);
  }

  if (change.endedSessions > 0) {
    const sessions = change.endedSessions === 1 ? "session" : "sessions";
    parts.push(`${change.endedSessions} staff ${sessions} ended.`);
  }

  return parts.join(" ");
}
