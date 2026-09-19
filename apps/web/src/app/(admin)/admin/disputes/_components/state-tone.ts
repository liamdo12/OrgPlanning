import type { StatusTone } from "@occasion/ui";
import type { DisputeState } from "@occasion/core";

/**
 * How serious a case looks.
 *
 * A complaint nobody has picked up is the one that should catch the eye, so
 * `open` is the danger tone and `under_review` the amber: somebody is on it.
 * Both endings are neutral — a case that was dismissed is as finished as one
 * that was refunded, and colouring the two differently would editorialise
 * about which outcome the platform preferred.
 */
export function toneFor(state: DisputeState): StatusTone {
  switch (state) {
    case "open":
      return "danger";
    case "under_review":
      return "warn";
    case "resolved":
    case "rejected":
      return "neutral";
  }
}
