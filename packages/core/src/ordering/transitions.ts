import { ValidationError } from "../errors.js";

/**
 * What an order may become, and what follows from it.
 *
 * Pure: no context, no database, no actor. The service decides whether a caller
 * may ask; this decides whether the answer is a legal move. Keeping the two
 * apart is what lets the whole table be asserted in a test that needs nothing
 * running.
 *
 * This module is `lifecycle.md` in code. That file is the specification the
 * admin screens, the job runner and the transactional emails all cite; the
 * table below is transcribed from it and `transitions.test.ts` asserts the two
 * agree edge for edge. Change the file and this module together or the reason
 * for having one description stops applying.
 */

export type OrderState =
  | "pending_payment"
  | "confirmed"
  | "balance_due"
  | "action_required"
  | "issue"
  | "fulfilled"
  | "completed"
  | "cancelled"
  | "refunded";

export const ORDER_STATES = [
  "pending_payment",
  "confirmed",
  "balance_due",
  "action_required",
  "issue",
  "fulfilled",
  "completed",
  "cancelled",
  "refunded",
] as const;

/**
 * The legal moves, and only these. Anything not here throws.
 *
 * The omissions carry as much of the rule as the entries do, and each is argued
 * in `lifecycle.md`: captured money is not un-captured by a state change, a
 * delivered booking that goes wrong is an `issue` before it is anything else,
 * and the only thing that may still happen to a finished order is money going
 * back.
 */
const ALLOWED: Record<OrderState, readonly OrderState[]> = {
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["balance_due", "fulfilled", "issue", "cancelled"],
  balance_due: ["confirmed", "action_required", "issue", "cancelled"],
  action_required: ["confirmed", "issue", "cancelled"],
  issue: ["confirmed", "fulfilled", "cancelled"],
  fulfilled: ["completed", "issue"],
  completed: ["refunded"],
  cancelled: ["refunded"],
  refunded: [],
};

/** Whether `from → to` is a move the platform recognises. */
export function canTransition(from: OrderState, to: OrderState): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Throws unless the move is legal.
 *
 * Called before anything is written, so an illegal move is refused by the
 * domain rather than merely hidden by a button the UI did not draw. A second
 * tab showing a stale row is the ordinary way that happens, and a webhook
 * arriving twice is the other.
 */
export function assertTransition(from: OrderState, to: OrderState): void {
  if (from === to) {
    throw new ValidationError(`This order is already ${to}.`, { state: "unchanged" });
  }

  if (!canTransition(from, to)) {
    throw new ValidationError(`A ${from} order cannot become ${to}.`, { state: "illegal" });
  }
}

/** What the booked slot is doing while an order sits in a state. */
export type CapacityEffect = "held" | "locked" | "consumed" | "released";

const CAPACITY: Record<OrderState, CapacityEffect> = {
  pending_payment: "held",
  confirmed: "locked",
  balance_due: "locked",
  action_required: "locked",
  issue: "locked",
  fulfilled: "consumed",
  completed: "consumed",
  cancelled: "released",
  refunded: "released",
};

export function capacityIn(state: OrderState): CapacityEffect {
  return CAPACITY[state];
}

/**
 * Whether entering this state frees the date the order was holding.
 *
 * The rule the red team found nowhere: every way an order can end without being
 * delivered releases its slot. A date held by a cancelled order is one the
 * vendor can never sell again, and nothing on any screen would say why.
 */
export function releasesCapacity(state: OrderState): boolean {
  return capacityIn(state) === "released";
}

/**
 * Whether an order in this state is finished.
 *
 * `completed` is an ending too — it just keeps its slot, because the date was
 * used rather than freed.
 */
export function isTerminal(state: OrderState): boolean {
  return ALLOWED[state].length === 0 || state === "completed" || releasesCapacity(state);
}

/**
 * Whether money may move to the vendor while an order is in this state.
 *
 * `issue` is the state this function exists for. It looks like `confirmed` on
 * every other axis — capacity locked, booking alive — and a transfer that ran
 * anyway would pay out the order somebody has just disputed.
 */
export function payoutAllowed(state: OrderState): boolean {
  return state === "confirmed" || state === "fulfilled" || state === "completed";
}

/**
 * Work that becomes due on entering a state.
 *
 * Data rather than branching, so the job runner and the tests read the same
 * table. `anchor` names what the offset is measured from, because three of the
 * five are not measured from now: a balance is charged fourteen calendar days
 * before the event, and auto-complete lands three days after it ends.
 */
export type ScheduledJobType =
  | "expire_unpaid"
  | "cooling_window_transfer"
  | "charge_balance"
  | "balance_grace_expiry"
  | "auto_complete_order";

export type ScheduledJob = {
  type: ScheduledJobType;
  /** What the offset is measured from. */
  anchor: "now" | "event_start" | "event_end";
  /** Whole calendar days, applied in the event's timezone. */
  offsetDays?: number;
  /** Minutes, applied as elapsed time. */
  offsetMinutes?: number;
};

const ON_ENTERING: Record<OrderState, readonly ScheduledJob[]> = {
  pending_payment: [{ type: "expire_unpaid", anchor: "now", offsetMinutes: 30 }],
  confirmed: [
    { type: "cooling_window_transfer", anchor: "now", offsetMinutes: 48 * 60 },
    { type: "charge_balance", anchor: "event_start", offsetDays: -14 },
  ],
  balance_due: [],
  action_required: [{ type: "balance_grace_expiry", anchor: "now", offsetMinutes: 72 * 60 }],
  issue: [],
  fulfilled: [{ type: "auto_complete_order", anchor: "event_end", offsetMinutes: 72 * 60 }],
  completed: [],
  cancelled: [],
  refunded: [],
};

/** What the order looks like, for the scheduling decisions that depend on it. */
export type OrderShape = {
  /** Whether anything is still to be charged after the deposit. */
  hasBalance: boolean;
};

/**
 * What entering `to` from `from` schedules.
 *
 * The `from` argument is the whole reason this is a function rather than a
 * lookup. `confirmed` is entered three ways — a first deposit, a balance that
 * succeeded, and a link that was paid — and only the first is a new booking.
 * Re-enqueueing on the other two would schedule a second balance charge for an
 * order that has just paid one. The jobs table's unique `(type, dedupe_key)`
 * would refuse the duplicate, but a caller that relies on a constraint to
 * absorb a mistake it keeps making has not stopped making it.
 *
 * `shape` carries the one fact the table cannot: a short-notice or small
 * booking is paid in full at checkout and has no balance. Scheduling
 * `charge_balance` for one anyway is not merely redundant — its due date is
 * `event − 14 days`, which for a short-notice booking is **in the past**, so it
 * is immediately due and throws every time the runner picks it up, for ever.
 */
export function jobsOnEntering(
  from: OrderState,
  to: OrderState,
  shape: OrderShape,
): readonly ScheduledJob[] {
  if (to === "confirmed" && from !== "pending_payment") return [];

  return ON_ENTERING[to].filter(
    (job) => job.type !== "charge_balance" || shape.hasBalance,
  );
}

/**
 * Whether entering this state cancels the order's queued work.
 *
 * Every ending, including `completed`: an auto-complete job that fires against
 * an order which reached `completed` by another route is at best a no-op, and
 * at worst the second half of a race nobody will reproduce.
 */
export function cancelsQueuedJobs(state: OrderState): boolean {
  return isTerminal(state);
}

/**
 * Whether this move retires the links emailed to rescue a balance.
 *
 * A link is payable only while the order is waiting for one, so **leaving
 * `action_required` retires it**, however it leaves. That is not a detail of
 * the balance-capture path: it is the rule, and expressing it here rather than
 * at each call site is what closes the two ways a live link outlives its
 * purpose.
 *
 * Both were real. A balance that succeeds on a later attempt moves the order
 * back to `confirmed` and left the link payable for the rest of its 72 hours —
 * the customer could then pay the whole balance a second time. And an
 * administrator cancelling an order in `action_required` left a link that
 * charges a booking nobody has any more; the resulting webhook would find a
 * `cancelled → confirmed` move that the lifecycle refuses, and Stripe would
 * retry that failure for days.
 *
 * Terminal states are included for the case where a link exists on an order
 * that is not in `action_required` — nothing mints one there today, and a rule
 * that depends on that staying true is a rule waiting to be broken.
 */
export function retiresPaymentLinks(from: OrderState, to: OrderState): boolean {
  return from === "action_required" || isTerminal(to);
}

/**
 * Work that stops being due because the order has left a state.
 *
 * `expire_unpaid` is the whole of it, and it is not covered by the rule above:
 * leaving `pending_payment` for `confirmed` is not an ending, so nothing would
 * call the job off — and a job whose entire purpose is "cancel this if nobody
 * has paid" would still be sitting there, due, against an order somebody has
 * just paid for. The job's own handler must check the state too; this is what
 * stops it having to.
 */
export function jobsCancelledOnLeaving(from: OrderState): readonly ScheduledJobType[] {
  return from === "pending_payment" ? ["expire_unpaid"] : [];
}

/** Narrows text off the wire to a state, or throws. */
export function parseOrderState(value: unknown): OrderState {
  const match = ORDER_STATES.find((state) => state === value);
  if (!match) {
    throw new ValidationError("Unknown order state.", { state: "invalid" });
  }
  return match;
}
