import { releasesCapacity, type OrderState } from "../ordering/transitions.js";

/**
 * What a category slot on an event currently is.
 *
 * Derived, never stored. `event_items` carries no status column, and these four
 * values exist only as the return type below: a stored copy would be a second
 * source of truth that can disagree with the order it was copied from, and the
 * disagreement would show as a booking the planner calls "In plan" while the
 * vendor's calendar is blocked for it.
 */

/**
 * The states a quote request can be in.
 *
 * Only `open` is still collecting offers — `quotes/service.ts` refuses to act on
 * anything else — so only `open` draws a quotes badge. The rest are history the
 * slot falls back past.
 *
 * Core's own copy of the vocabulary, the way `OrderState` is: the domain states
 * what it means by a state rather than importing the storage layer's spelling.
 */
export type QuoteState = "open" | "closed" | "expired" | "booked";

/**
 * A slot's state, with the one number a caller cannot recompute.
 *
 * `quotes` carries its count, zero included — whether zero reads "Awaiting
 * quotes" or "0 quotes" is a wording decision for the screen, not a different
 * state.
 */
export type SlotState =
  { kind: "booked" } | { kind: "in_plan" } | { kind: "quotes"; count: number } | { kind: "empty" };

/**
 * What the derivation needs, as facts rather than ids.
 *
 * No entity id appears here on purpose. A slot's state does not depend on which
 * row it came from, and a signature that took ids would be an id-taking export
 * that asks nobody's permission — the shape the authorization gates exist to
 * catch.
 */
export type SlotFacts = {
  /** The state of the order placed from this slot, if one ever was. */
  orderState?: OrderState | undefined;
  /** Whether a service has been chosen for the category. */
  hasService: boolean;
  /** The state of the quote request raised for the category, if any. */
  quoteState?: QuoteState | undefined;
  /** Offers received on that request. */
  offerCount: number;
};

/**
 * The slot's state, from the lifecycle rather than from a list of states.
 *
 * **Booked is "the order still holds the date"**, which `releasesCapacity`
 * already answers: it is true only for `cancelled` and `refunded`. Asking the
 * lifecycle rather than restating a set of states is what stops a tenth order
 * state silently reverting a booked slot — the failure a hand-written list
 * produces the first time one is added, and produces silently, because a slot
 * that quietly reads "In plan" draws a Check out button over a booking the
 * customer already has and whose deposit is already on the vendor's calendar.
 *
 * So `pending_payment` is Booked: a checkout in flight holds its date, and a
 * second attempt would collide with the first's capacity block. `completed` is
 * Booked too — the date was used, not freed. `cancelled` and `refunded` release
 * it, and the slot falls back on whatever else it still holds, which is why
 * nothing has to clear `order_id` when an order ends.
 *
 * **Precedence is Booked, In plan, quotes, Empty.** A customer who has chosen a
 * service for a category has made the more definite decision and must be able
 * to check out from the planner; the open request stays reachable from the
 * comparison screen. The other ordering hides the checkout behind "Compare".
 */
export function slotState(facts: SlotFacts): SlotState {
  if (facts.orderState !== undefined && !releasesCapacity(facts.orderState)) {
    return { kind: "booked" };
  }

  if (facts.hasService) return { kind: "in_plan" };

  if (facts.quoteState === "open") return { kind: "quotes", count: facts.offerCount };

  return { kind: "empty" };
}
