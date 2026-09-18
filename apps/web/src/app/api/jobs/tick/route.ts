import { NextResponse, type NextRequest } from "next/server";
import { BATCH_LIMIT, runDueJobs, sweepParkedWebhooks } from "@occasion/core";
import { createRequestContext } from "../../../../lib/core";
import { getEnv } from "../../../../lib/env";

/**
 * The platform's timer.
 *
 * **This is the only thing that ever runs a real customer's job**, and the one
 * property that makes that safe is what it does *not* do: it never reads the
 * admin clock override. It passes `ctx.clock.realNow()` and nothing else, so no
 * amount of time-shifting on any screen can make it claim work that is not
 * genuinely due.
 *
 * The admin button is the mirror image — a shifted clock, and `demoOnly` — and
 * between them the rule holds from both directions: the real clock touches real
 * rows, a moved clock touches only demo rows.
 *
 * It also sweeps the events that arrived before their order existed. A
 * confirmation can overtake the transaction that writes the order it confirms;
 * the webhook route parks such an event rather than losing it, and this is what
 * comes back for it.
 */

/** Node, not Edge: this opens a database connection and runs the domain. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Compares two secrets without leaking where they diverge.
 *
 * A plain `===` returns as soon as a byte differs, and the difference in timing
 * is enough to recover a secret one byte at a time from a few thousand
 * requests. The length check leaks only the length, which an attacker who can
 * count is going to learn anyway.
 */
function matches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;

  let difference = 0;
  for (let index = 0; index < given.length; index += 1) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export async function POST(request: NextRequest) {
  const env = getEnv();
  const given = request.headers.get("x-jobs-secret") ?? "";

  if (!matches(given, env.JOBS_TICK_SECRET)) {
    // No detail, and the same answer for a missing header as for a wrong one.
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const ctx = createRequestContext();

  // The real clock, always. Written out rather than defaulted, because the
  // default is the thing that must never quietly change.
  const asOf = ctx.clock.realNow();

  const sweep = await sweepParkedWebhooks(ctx);
  const summary = await runDueJobs(ctx, {
    asOf,
    demoOnly: false,
    trigger: "cron",
    limit: BATCH_LIMIT,
  });

  return NextResponse.json({
    asOf: asOf.toISOString(),
    webhooks: sweep,
    jobs: {
      claimed: summary.claimed,
      done: summary.done,
      held: summary.held,
      failed: summary.failed,
      // The detail is what a person reads when a tick did something
      // unexpected; the ids are what they search for afterwards.
      results: summary.results,
    },
  });
}
