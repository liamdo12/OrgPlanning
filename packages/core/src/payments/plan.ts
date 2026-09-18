import { ValidationError } from "../errors.js";
import { shiftCalendarDays } from "../ordering/schedule.js";
import { applyBps } from "./money.js";

/**
 * How a booking is paid for: a deposit now and a balance later, or all of it
 * now.
 *
 * A card hold cannot secure an event months away — authorizations expire in
 * seven days, thirty at the outside — so the platform charges a real deposit,
 * saves the card, and charges the balance off-session fourteen days before the
 * event. That is the rule the whole payments domain is shaped around, and this
 * module is the one place that decides which shape a given booking takes.
 *
 * Source: the architecture report §6.1–6.2. The deposit percentage belongs to
 * the cancellation policy the vendor chose (10 / 20 / 30%), and travels with
 * the order as `policy_template_id`.
 */

export type PaymentPlanKind = "deposit_then_balance" | "full";

export type PaymentPlan = {
  kind: PaymentPlanKind;
  /** Charged at checkout, with the card saved for the balance. */
  depositAmount: bigint;
  /** Charged off-session later. Zero when the whole total is taken now. */
  balanceAmount: bigint;
  /** When the balance is charged. Null when there is no balance step. */
  balanceDueAt: Date | null;
  /** When free cancellation ends and the deposit share becomes transferable. */
  coolingWindowEndsAt: Date;
  /** Why this shape, so a screen can say so rather than guess. */
  reason: "standard" | "short_notice" | "small_total";
};

export type PaymentPlanInput = {
  /** What the customer pays in total, tax included. */
  total: bigint;
  /** The domain clock's now — never `Date.now()`. */
  now: Date;
  /** When the event starts, as an instant. */
  eventStart: Date;
  /** The policy's deposit, in basis points of the total. */
  depositBps: number;
  /** Calendar days before the event that the balance is charged. */
  balanceLeadDays: number;
  /** Hours of free cancellation after the deposit. */
  coolingWindowHours: number;
  /**
   * Below this total the whole amount is taken at checkout.
   *
   * C$250 in the report. A balance step on a small booking costs a job, a
   * webhook, a retry path and an email for a few dollars of float.
   */
  fullPaymentBelow: bigint;
  timeZone: string;
};

/**
 * Decides the plan, and computes both dates.
 *
 * The two short-notice conditions are one rule with two reasons, and the
 * boundaries are deliberate:
 *
 * - **Event ≤ `balanceLeadDays` away → pay in full.** At exactly fourteen days
 *   the balance would be due now, and a "later" charge scheduled for this
 *   instant is not a plan, it is a second charge nobody expects. So the
 *   deposit-and-balance shape needs the event to be *more* than the lead time
 *   away.
 * - **Total < `fullPaymentBelow` → pay in full.** Strictly below: a booking at
 *   exactly C$250 splits, so the threshold reads the same way to a customer as
 *   it does here.
 */
export function buildPaymentPlan(input: PaymentPlanInput): PaymentPlan {
  const {
    total,
    now,
    eventStart,
    depositBps,
    balanceLeadDays,
    coolingWindowHours,
    fullPaymentBelow,
    timeZone,
  } = input;

  if (total <= 0n) {
    throw new ValidationError("An order must charge something.", { total: "empty" });
  }
  if (balanceLeadDays < 0) {
    throw new ValidationError("The balance lead time cannot be negative.", {
      balanceLeadDays: "negative",
    });
  }
  if (coolingWindowHours < 0) {
    // A window that closed before it opened is one no cancellation can ever be
    // inside, which is a policy nobody meant to write. Zero is legitimate — it
    // is what the strict template means.
    throw new ValidationError("A free-cancellation window cannot be negative.", {
      coolingWindowHours: "negative",
    });
  }

  const coolingWindowEndsAt = new Date(now.getTime() + coolingWindowHours * 60 * 60 * 1000);
  const balanceDueAt = shiftCalendarDays(eventStart, -balanceLeadDays, timeZone);

  const full = (reason: PaymentPlan["reason"]): PaymentPlan => ({
    kind: "full",
    depositAmount: total,
    balanceAmount: 0n,
    balanceDueAt: null,
    coolingWindowEndsAt,
    reason,
  });

  if (total < fullPaymentBelow) return full("small_total");
  if (balanceDueAt.getTime() <= now.getTime()) return full("short_notice");

  const depositAmount = applyBps(total, depositBps);

  // A deposit that rounds to nothing, or to everything, is not a deposit. Both
  // happen at the edges — a 10% deposit on a C$2.50 booking, or a policy
  // template someone set to 100% — and either would leave a balance step that
  // charges zero.
  if (depositAmount <= 0n || depositAmount >= total) return full("small_total");

  return {
    kind: "deposit_then_balance",
    depositAmount,
    balanceAmount: total - depositAmount,
    balanceDueAt,
    coolingWindowEndsAt,
    reason: "standard",
  };
}
