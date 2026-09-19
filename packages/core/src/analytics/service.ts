import type { CoreContext } from "../context.js";
import { ValidationError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import { requireAdmin } from "../identity/service.js";
import { formatMoney } from "../payments/money.js";
import * as repo from "./repo.js";

/**
 * What an operator needs to know about the platform this month.
 *
 * A fixed list of counts, not a query builder. The plan says so and the reason
 * is worth keeping in front of whoever adds the next one: a screen that can ask
 * anything becomes a reporting product, and this one exists so somebody can see
 * that four vendors are waiting for approval and one in nine balances is being
 * declined.
 *
 * **Every number comes from one snapshot.** The six aggregates run inside a
 * single read-only, repeatable-read transaction, which is what makes them
 * consistent with each other — gross bookings and orders-by-state read a moment
 * apart can disagree, and two numbers on one screen that cannot both be true is
 * worse than either being slightly stale. `READ ONLY` is also the strongest
 * statement a single-database deployment can make about not disturbing the
 * operational tables: the transaction cannot take a row lock or write anything,
 * whatever a future aggregate here tries to do.
 */

export const PERIODS = ["7d", "30d", "90d", "12m", "all"] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(value: string): Period {
  const found = PERIODS.find((period) => period === value);
  if (!found) throw new ValidationError(`${value} is not a period.`, { period: "unknown" });
  return found;
}

export function periodLabel(period: Period): string {
  switch (period) {
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "12m":
      return "Last 12 months";
    case "all":
      return "All time";
  }
}

/**
 * The window a period covers, ending now.
 *
 * `now` is the domain clock, so an administrator previewing a shifted moment
 * sees the figures as of that moment — the same rule the queue screen follows,
 * and the reason the returned window is shown on the screen rather than left
 * implicit.
 */
export function windowFor(period: Period, now: Date): repo.Window {
  // A day past the end, so "today" is included: the column is a timestamp and a
  // strict upper bound at this instant drops everything booked in the last
  // fraction of a second.
  const to = new Date(now.getTime() + 1_000);

  const days = (count: number) => new Date(to.getTime() - count * 86_400_000);

  switch (period) {
    case "7d":
      return { from: days(7), to };
    case "30d":
      return { from: days(30), to };
    case "90d":
      return { from: days(90), to };
    case "12m":
      return { from: days(365), to };
    case "all":
      // The epoch rather than a nullable bound: one shape of query, and no
      // branch that could apply the period to one aggregate and not another.
      return { from: new Date(0), to };
  }
}

export type Rate = {
  numerator: number;
  denominator: number;
  /** `—` when nothing happened, rather than a rate computed from zero. */
  display: string;
};

function rate(numerator: number, denominator: number): Rate {
  return {
    numerator,
    denominator,
    display:
      denominator === 0 ? "—" : `${Number(((numerator / denominator) * 100).toFixed(1))}%`,
  };
}

export type PlatformAnalytics = {
  period: Period;
  periodLabel: string;
  window: repo.Window;
  /** The moment the snapshot was taken, on the domain clock. */
  asOf: Date;
  vendorsByStatus: Record<string, number>;
  usersByStatus: Record<string, number>;
  ordersByState: Record<string, number>;
  bookings: {
    gross: bigint;
    grossDisplay: string;
    commission: bigint;
    commissionDisplay: string;
    orders: number;
  };
  balanceFailures: Rate;
  jobFailures: Rate;
  /** Jobs parked right now, which is a standing condition rather than a rate. */
  jobsHeld: number;
};

export async function getAnalytics(
  ctx: CoreContext,
  actor: Actor,
  period: Period = "30d",
): Promise<PlatformAnalytics> {
  requireAdmin(actor);

  const asOf = ctx.clock.now();
  const window = windowFor(period, asOf);

  const snapshot = await ctx.db.transaction(
    async (tx) => {
      // Sequential rather than `Promise.all`: they share one transaction, and a
      // single connection runs one statement at a time whatever the caller
      // does. Six round trips, fixed, whatever the platform's size.
      const vendorsByStatus = await repo.vendorsByStatus(tx);
      const usersByStatus = await repo.usersByStatus(tx);
      const ordersByState = await repo.ordersByState(tx, window);
      const bookings = await repo.bookings(tx, window);
      const balances = await repo.balanceOutcomes(tx, window);
      const jobOutcomes = await repo.jobOutcomes(tx, window);

      return { vendorsByStatus, usersByStatus, ordersByState, bookings, balances, jobOutcomes };
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );

  return {
    period,
    periodLabel: periodLabel(period),
    window,
    asOf,
    vendorsByStatus: snapshot.vendorsByStatus,
    usersByStatus: snapshot.usersByStatus,
    ordersByState: snapshot.ordersByState,
    bookings: {
      gross: snapshot.bookings.gross,
      grossDisplay: formatMoney(snapshot.bookings.gross, ctx.config.currency),
      commission: snapshot.bookings.commission,
      commissionDisplay: formatMoney(snapshot.bookings.commission, ctx.config.currency),
      orders: snapshot.bookings.orders,
    },
    balanceFailures: rate(snapshot.balances.failed, snapshot.balances.attempted),
    jobFailures: rate(snapshot.jobOutcomes.failed, snapshot.jobOutcomes.runs),
    jobsHeld: snapshot.jobOutcomes.held,
  };
}
