import { releasesCapacity, type OrderState } from "../ordering/transitions.js";

/**
 * What an event has committed against what it set out to spend.
 *
 * **Pre-tax, always.** Commission is charged on the subtotal and HST follows the
 * vendor as supplier, so a total is the subtotal plus a tax the customer would
 * pay on any equivalent booking anywhere. Counting it here would tell someone
 * they had overspent on tax rather than on the party.
 *
 * `bigint` cents throughout. Never a float, and never a `number`: a budget of
 * C$40,000 in cents is still exact in a double, but a sum of line totals across
 * a season of events is how that stops being true quietly.
 */

/** An order placed against the event, as the budget needs to see it. */
export type BudgetOrder = {
  state: OrderState;
  /** Pre-tax. The column of the same name on the order. */
  subtotal: bigint;
};

/** A line chosen but not yet bought, priced the way the checkout would price it. */
export type BudgetLine = {
  /** The package's unit price when one is named, else the service's base price. */
  unitPrice: bigint;
  quantity: number;
};

export type EventBudget = {
  /** What the customer set, or nothing when they set none. */
  budget: bigint | null;
  committed: bigint;
  /** `null` when there is no budget to measure against — not zero. */
  remaining: bigint | null;
};

/**
 * One line's pre-tax subtotal.
 *
 * The checkout's own rule, so a slot in plan is costed at what buying it would
 * actually charge: the package's unit price when a package is named, the
 * service's base price otherwise, times the quantity.
 */
export function lineSubtotal(line: BudgetLine): bigint {
  return line.unitPrice * BigInt(line.quantity);
}

/**
 * Committed and remaining.
 *
 * Committed is every order that still holds its date, plus every line chosen
 * and not yet bought. `releasesCapacity` decides the first half — an order that
 * released the date released the money with it, so cancelled and refunded
 * bookings leave the figure, which is what makes "remaining" go back up when a
 * customer cancels rather than staying spent.
 *
 * Remaining may be negative. A customer who has committed past their budget has
 * done so, and clamping at zero would hide exactly the number they need.
 */
export function eventBudget(input: {
  budget: bigint | null;
  orders: readonly BudgetOrder[];
  inPlan: readonly BudgetLine[];
}): EventBudget {
  const booked = input.orders
    .filter((order) => !releasesCapacity(order.state))
    .reduce((sum, order) => sum + order.subtotal, 0n);

  const planned = input.inPlan.reduce((sum, line) => sum + lineSubtotal(line), 0n);

  const committed = booked + planned;

  return {
    budget: input.budget,
    committed,
    remaining: input.budget === null ? null : input.budget - committed,
  };
}
