import type { StatusTone } from "@occasion/ui";

/**
 * How serious an account's status looks.
 *
 * One function, because the row and the record show the same person. Source for
 * the pairs: lines 2629–2634 — Active is the settled state, Pending is work
 * waiting for somebody, and Unverified and Suspended are both the neutral wash
 * rather than an alarm, because neither is the platform's emergency.
 */
export function toneFor(status: string): StatusTone {
  if (status === "active") return "success";
  if (status === "pending") return "warn";
  return "neutral";
}
