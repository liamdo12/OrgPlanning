import type { StatusTone } from "@occasion/ui";
import type { OrderState } from "@occasion/core";

/**
 * How serious an order's state looks.
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
