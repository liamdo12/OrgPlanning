import { ValidationError } from "../errors.js";

/**
 * A complaint's own lifecycle, kept apart from the order's.
 *
 * An order can be delivered and complained about at the same time, so a dispute
 * is not an order state — `orders.state` says what the booking is doing and
 * this says what the platform is doing about a person who is unhappy with it.
 * The two are linked in one direction only: closing a case may move an order
 * out of `issue`, and resolving an order's issue closes its open cases.
 */

export const DISPUTE_STATES = ["open", "under_review", "resolved", "rejected"] as const;
export type DisputeState = (typeof DISPUTE_STATES)[number];

/**
 * What was done about it, once it is closed.
 *
 * Separate from the state because "closed" and "what was decided" are different
 * facts, and only the second answers a vendor asking why their payout was
 * reversed six weeks later.
 */
export const DISPUTE_RESOLUTIONS = ["refund_recorded", "vendor_warned", "dismissed"] as const;
export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

/** Which state a resolution puts the case in. The pairing the database checks. */
export function stateFor(resolution: DisputeResolution): Extract<
  DisputeState,
  "resolved" | "rejected"
> {
  return resolution === "dismissed" ? "rejected" : "resolved";
}

/** Whether a case is still somebody's to deal with. */
export function isOpen(state: DisputeState): boolean {
  return state === "open" || state === "under_review";
}

/**
 * Where a case may go from where it is.
 *
 * Reopening is deliberately absent. A case that was closed and is wrong again
 * is a new complaint with its own timeline; reopening the old one would leave
 * one row claiming two outcomes, and the second would overwrite the first
 * resolution note.
 */
const MOVES: Readonly<Record<DisputeState, readonly DisputeState[]>> = {
  open: ["under_review", "resolved", "rejected"],
  under_review: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
};

export function canTransition(from: DisputeState, to: DisputeState): boolean {
  return MOVES[from].includes(to);
}

export function assertTransition(from: DisputeState, to: DisputeState): void {
  if (!canTransition(from, to)) {
    throw new ValidationError(`A ${from} case cannot become ${to}.`, { state: "illegal" });
  }
}

export function parseDisputeState(value: string): DisputeState {
  const found = DISPUTE_STATES.find((state) => state === value);
  if (!found) throw new ValidationError(`${value} is not a case state.`, { state: "unknown" });
  return found;
}

export function parseDisputeResolution(value: string): DisputeResolution {
  const found = DISPUTE_RESOLUTIONS.find((resolution) => resolution === value);
  if (!found) {
    throw new ValidationError(`${value} is not a resolution.`, { resolution: "unknown" });
  }
  return found;
}

/** How each state reads on a badge. */
export function disputeStateLabel(state: DisputeState): string {
  switch (state) {
    case "open":
      return "Open";
    case "under_review":
      return "Investigating";
    case "resolved":
      return "Resolved";
    case "rejected":
      return "Dismissed";
  }
}

export function disputeResolutionLabel(resolution: DisputeResolution): string {
  switch (resolution) {
    case "refund_recorded":
      return "Refunded";
    case "vendor_warned":
      return "Vendor warned";
    case "dismissed":
      return "Dismissed";
  }
}
