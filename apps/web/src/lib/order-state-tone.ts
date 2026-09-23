import type { StatusTone } from "@occasion/ui";
import type { OrderState } from "@occasion/core";

/**
 * How serious an order's state looks.
 *
 * Shared rather than per screen, now that the customer's own list and the
 * admin queue both draw a badge for the same nine values. A second mapping is
 * how one screen learns about a state the other does not: a booking whose
 * balance was declined is `action_required` on both, and a screen that had
 * never heard of it would render a bare badge on the one state somebody has to
 * act on.
 *
 * Three of the pairs are the prototype's own, lines 2723–2728: `confirmed` is
 * the settled green, `fulfilled` and `action req.` are the amber, and
 * `cancelled` and `completed` are both the neutral wash — an ended booking is
 * not an alarm whichever way it ended.
 *
 * The rest are states the prototype's six fixed rows never contain. They follow
 * the same reading: amber is work waiting on somebody, and `issue` is the one
 * state that is actually wrong rather than merely unfinished, so it is the only
 * one that gets the danger tone.
 */
export function toneFor(state: OrderState): StatusTone {
  switch (state) {
    case "confirmed":
      return "success";
    case "issue":
      return "danger";
    case "pending_payment":
    case "balance_due":
    case "action_required":
    case "fulfilled":
      return "warn";
    case "completed":
    case "cancelled":
    case "refunded":
      return "neutral";
  }
}
