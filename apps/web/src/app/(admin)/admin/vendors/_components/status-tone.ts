import type { StatusTone } from "@occasion/ui";
import type { VendorStatus } from "@occasion/core";

/**
 * How serious a standing looks.
 *
 * One function, because the row and the record show the same vendor: reading
 * `Suspended` as a warning in the list and a danger in the drawer — or the
 * reverse — tells somebody two different things about one business.
 *
 * `approved` is the settled state, `blocked` and `suspended` the bad ones, and
 * `pending` is work waiting for somebody, which is the warm tone rather than
 * the neutral one. Source for the pairs: lines 2715–2720.
 */
export function toneFor(status: VendorStatus): StatusTone {
  if (status === "approved") return "success";
  if (status === "blocked" || status === "suspended") return "danger";
  return "warn";
}
