import { and, gte, lt, sql } from "drizzle-orm";
import {
  jobRuns,
  jobs,
  orders,
  payments,
  users,
  vendors,
} from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";

/**
 * The operator's counts.
 *
 * Reads only, and every one of them a single grouped aggregate — no per-row
 * query anywhere, which is what keeps the screen's cost independent of how many
 * orders the platform has taken.
 *
 * The period applies to the things that happen (orders, payments, job runs) and
 * not to the standing populations (vendors and accounts by status), because
 * "vendors pending approval last month" is not a number an operator can act on:
 * what they need to know is how many are pending now.
 */

export type Window = { from: Date; to: Date };

export async function vendorsByStatus(db: DbExecutor): Promise<Record<string, number>> {
  const rows = await db
    .select({ key: vendors.status, total: sql<number>`count(*)::int` })
    .from(vendors)
    .groupBy(vendors.status);

  return tally(rows);
}

export async function usersByStatus(db: DbExecutor): Promise<Record<string, number>> {
  const rows = await db
    .select({ key: users.status, total: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.status);

  return tally(rows);
}

export async function ordersByState(
  db: DbExecutor,
  window: Window,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ key: orders.state, total: sql<number>`count(*)::int` })
    .from(orders)
    .where(within(orders.createdAt, window))
    .groupBy(orders.state);

  return tally(rows);
}

export type Bookings = {
  /** What customers were charged, across every order placed in the window. */
  gross: bigint;
  /** The platform's cut of those orders, including the tax on the commission. */
  commission: bigint;
  orders: number;
};

/**
 * Gross bookings and commission.
 *
 * Summed off the orders rather than the payments: the question is what was
 * booked in the period, and a booking whose balance falls due in three months
 * is still business the platform won this month. What was actually collected is
 * a different number, and it is the payments below.
 */
export async function bookings(db: DbExecutor, window: Window): Promise<Bookings> {
  const [row] = await db
    .select({
      gross: sql<string>`coalesce(sum(${orders.total}), 0)::text`,
      commission: sql<string>`coalesce(sum(${orders.commission} + ${orders.commissionTax}), 0)::text`,
      orders: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(within(orders.createdAt, window));

  return {
    gross: BigInt(row?.gross ?? "0"),
    commission: BigInt(row?.commission ?? "0"),
    orders: row?.orders ?? 0,
  };
}

export type BalanceOutcome = {
  attempted: number;
  failed: number;
};

/**
 * How often a balance charge is declined.
 *
 * Counted over payment rows of kind `balance`, because the attempt row is
 * written before the provider is called — a timeout leaves evidence, and a
 * failure rate computed from orders that reached `action_required` would miss
 * every decline the customer then rescued.
 */
export async function balanceOutcomes(db: DbExecutor, window: Window): Promise<BalanceOutcome> {
  const [row] = await db
    .select({
      attempted: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${payments.state} = 'failed')::int`,
    })
    .from(payments)
    .where(and(sql`${payments.kind} = 'balance'`, within(payments.createdAt, window)));

  return { attempted: row?.attempted ?? 0, failed: row?.failed ?? 0 };
}

export type JobOutcome = {
  runs: number;
  failed: number;
  /** Work parked for a reason that is not the job's fault. */
  held: number;
};

export async function jobOutcomes(db: DbExecutor, window: Window): Promise<JobOutcome> {
  const [runs] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${jobRuns.error} is not null)::int`,
    })
    .from(jobRuns)
    .where(within(jobRuns.startedAt, window));

  // Held is a standing condition rather than an event: a job parked three weeks
  // ago is still parked, and counting only the ones parked inside the window
  // would report zero on the morning somebody most needs to see them.
  const [held] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(jobs)
    .where(sql`${jobs.status} = 'held'`);

  return { runs: runs?.runs ?? 0, failed: runs?.failed ?? 0, held: held?.total ?? 0 };
}

function within(column: Parameters<typeof gte>[0], window: Window) {
  return and(gte(column, window.from), lt(column, window.to));
}

function tally(rows: readonly { key: string; total: number }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.key] = row.total;
  return counts;
}
