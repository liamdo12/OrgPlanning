import { ValidationError } from "../errors.js";

/**
 * What a vendor's standing may become, and what follows from it.
 *
 * Pure: no context, no database, no actor. The service decides whether a caller
 * may ask; this decides whether the answer is a legal move. Keeping the two
 * apart is what lets the whole table be asserted in a test that needs nothing
 * running.
 *
 * Source for the states: `vendor_status`, and the four the prototype's queue
 * renders (lines 2715–2720).
 */

export type VendorStatus = "pending" | "approved" | "suspended" | "blocked";

export const VENDOR_STATUSES = ["pending", "approved", "suspended", "blocked"] as const;

/**
 * The legal moves, and only those.
 *
 * `blocked → pending` is the "Review" path: a business that was refused and has
 * since done the work goes back into the queue rather than straight to
 * approved, so a person still looks at it. There is no `under_review` state to
 * move to — the review itself is somebody opening the record, not a status the
 * platform holds.
 *
 * Nothing leaves `approved` except `suspended`, and nothing deletes a vendor:
 * orders and transfers reference them, and a business that has taken money is
 * not a row to remove.
 */
const ALLOWED: Record<VendorStatus, readonly VendorStatus[]> = {
  pending: ["approved", "blocked"],
  approved: ["suspended"],
  suspended: ["approved"],
  blocked: ["pending", "approved"],
};

/** Whether `from → to` is a move the platform recognises. */
export function canTransition(from: VendorStatus, to: VendorStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Throws unless the move is legal.
 *
 * The service calls this before it writes anything, so an illegal move is
 * refused by the domain rather than merely hidden by a button the UI did not
 * draw. A second tab showing a stale row is the ordinary way that happens.
 */
export function assertTransition(from: VendorStatus, to: VendorStatus): void {
  if (from === to) {
    throw new ValidationError(`This vendor is already ${to}.`, { status: "unchanged" });
  }

  if (!canTransition(from, to)) {
    throw new ValidationError(`A ${from} vendor cannot become ${to}.`, { status: "illegal" });
  }
}

/**
 * Whether money may move to a vendor in this state.
 *
 * Approval is the whole condition. Suspension that only hides a business from
 * search is not suspension: the payouts it already has scheduled would keep
 * landing, which is precisely the money the platform suspended them to stop.
 */
export function payoutAllowed(status: VendorStatus): boolean {
  return status === "approved";
}

/**
 * Whether a move into this state has to stop money that is already scheduled.
 *
 * Every state that is not `approved`, rather than suspension alone — a vendor
 * sent back to `pending` for review has not been cleared to be paid either.
 */
export function payoutsStopOnEntering(status: VendorStatus): boolean {
  return !payoutAllowed(status);
}

/**
 * Whether entering this state takes vendor capability away from its staff.
 *
 * `suspended` and `blocked` do; `pending` does not. A business awaiting its
 * first approval has staff who are still setting it up, and cutting their
 * sessions every time an administrator moves the row would make the queue
 * unusable for the people in it.
 */
export function capabilityEndsOnEntering(status: VendorStatus): boolean {
  return status === "suspended" || status === "blocked";
}

/**
 * Whether a move into this state has to be explained.
 *
 * The two that take something away. A reason is what the vendor is later told
 * and what the next administrator reads; an unexplained suspension is one
 * nobody can safely undo.
 */
export function reasonRequiredOnEntering(status: VendorStatus): boolean {
  return status === "suspended" || status === "blocked";
}

/**
 * Whether this vendor's services may appear in public listings.
 *
 * The same condition as payouts and deliberately a separate function: they are
 * two different promises — one about money, one about what a customer can find
 * and book — and a later change to either must not silently move the other.
 */
export function publiclyListable(status: VendorStatus): boolean {
  return status === "approved";
}

/** Narrows text off the wire to a status, or throws. */
export function parseVendorStatus(value: unknown): VendorStatus {
  const match = VENDOR_STATUSES.find((status) => status === value);
  if (!match) {
    throw new ValidationError("Unknown vendor status.", { status: "invalid" });
  }
  return match;
}

/**
 * The marker every hold written for a vendor's standing carries.
 *
 * Re-exported from `@occasion/db` rather than declared here, because the seed
 * writes these rows too and cannot import this package. Two spellings of the
 * prefix would mean a reinstatement that silently fails to release what a
 * suspension parked.
 */
export { STANDING_HOLD, standingHoldReason } from "@occasion/db/schema";
