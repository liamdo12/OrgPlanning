import type { CoreContext } from "../context.js";
import { AppError } from "../errors.js";
import { SYSTEM, type Actor } from "../identity/actor.js";
import { HANDLERS } from "./handlers.js";
import * as repo from "./repo.js";

/**
 * The job runner.
 *
 * Two callers, and the difference between them is the whole safety story:
 *
 * - **The tick** passes the real clock and `demoOnly: false`. It is the only
 *   thing that ever touches a real customer's order, and it cannot be reached
 *   with a shifted time because it never reads the override.
 * - **The admin button** passes the preview clock and `demoOnly: true`. A
 *   shifted clock can move an hour or a year, and the filter is what stops that
 *   from claiming every future balance charge on the platform — which would
 *   charge those cards *and* consume their dedupe keys, so the real run on the
 *   real date would find nothing to do and say so cheerfully.
 *
 * Neither is allowed to let one bad job stop the queue. Each is claimed,
 * executed and recorded on its own; a handler that throws backs its job off and
 * the loop moves to the next.
 */

export type RunTrigger = "cron" | "admin_button" | "system";

export type JobResult = {
  jobId: string;
  type: repo.JobType;
  outcome: "done" | "held" | "retrying" | "failed";
  detail: string;
};

export type RunSummary = {
  /** The time the run was made against — shifted, when an override was used. */
  asOf: Date;
  claimed: number;
  done: number;
  held: number;
  /** Backing off, and will be tried again. */
  retrying: number;
  failed: number;
  results: JobResult[];
};

export type RunOptions = {
  /** The moment to treat as now when deciding what is due. */
  asOf: Date;
  /** Refuse any job whose order is not demo-flagged. */
  demoOnly: boolean;
  trigger: RunTrigger;
  /** The administrator whose override is in effect, recorded on every run. */
  overrideActorId?: string | null;
  /**
   * Whoever pressed the button, recorded on every run.
   *
   * Separate from the override's actor, and set even when no override is in
   * effect: "an administrator ran this" and "an administrator had moved the
   * clock" are different facts, and a run attributable to nobody is one that
   * cannot be explained from the history alone.
   */
  triggeredByUserId?: string | null;
  limit?: number;
};

/** How many to take in one pass. Small enough that a tick stays a tick. */
export const BATCH_LIMIT = 20;

/**
 * Claims what is due and runs it.
 *
 * The actor is `SYSTEM` throughout, whoever pressed the button: the platform's
 * timers are not an administrator's actions, and an audit trail naming a person
 * for a charge they did not make is worse than one naming nobody. Who was
 * responsible for it *happening* is recorded separately, on the run —
 * `triggered_by_user_id` for whoever pressed the button, and
 * `clock_override_actor_id` for whoever had moved the clock.
 */
export async function runDueJobs(ctx: CoreContext, options: RunOptions): Promise<RunSummary> {
  const limit = options.limit ?? BATCH_LIMIT;
  const claimed = await repo.claimDue(ctx.db, {
    asOf: options.asOf,
    limit,
    demoOnly: options.demoOnly,
  });

  const summary: RunSummary = {
    asOf: options.asOf,
    claimed: claimed.length,
    done: 0,
    held: 0,
    retrying: 0,
    failed: 0,
    results: [],
  };

  for (const job of claimed) {
    const result = await runOne(ctx, SYSTEM, job, options);
    summary.results.push(result);
    if (result.outcome === "done") summary.done += 1;
    else if (result.outcome === "held") summary.held += 1;
    // A job backing off has not failed — it is going to run again, and
    // reporting it as a failure on the screen is how somebody goes looking for
    // a problem that is already handling itself.
    else if (result.outcome === "retrying") summary.retrying += 1;
    else summary.failed += 1;
  }

  return summary;
}

/**
 * One job, with its provenance written whatever happens.
 *
 * The run row is the point: a payout made under a demo clock has to be
 * explainable from the record alone, months later, without anybody
 * remembering. It carries the time the run believed it was, the real time it
 * happened, and the administrator whose override supplied the difference.
 */
async function runOne(
  ctx: CoreContext,
  actor: Actor,
  job: repo.JobRow,
  options: RunOptions,
): Promise<JobResult> {
  const startedAt = ctx.clock.realNow();
  const handler = HANDLERS[job.type];

  /**
   * The provenance row, which must not be able to undo the job's outcome.
   *
   * Written after the job's own status, and its failure is swallowed. The
   * alternative was worse: with this inside the same `try`, a `job_runs` insert
   * that failed sent a job whose work had already committed down the retry
   * path — set back to `queued` with an attempt burned, to run again. Losing a
   * history row is bad; re-running a completed charge because the history row
   * was lost is a different order of bad.
   */
  const write = async (result: string, error: string | null) => {
    try {
      await repo.recordRun(ctx.db, {
        jobId: job.id,
        result,
        error,
        effectiveNow: options.asOf,
        realNow: ctx.clock.realNow(),
        clockOverrideActorId: options.overrideActorId ?? null,
        triggeredByUserId: options.triggeredByUserId ?? null,
        triggeredBy: options.trigger,
        startedAt,
      });
    } catch {
      // Nothing to do about it here, and nothing worth failing the job over.
    }
  };

  try {
    const outcome = await handler(ctx, actor, job);

    if (outcome.kind === "held") {
      await repo.markHeld(ctx.db, job.id, { reason: outcome.reason, now: ctx.clock.realNow() });
      await write("held", null);
      return { jobId: job.id, type: job.type, outcome: "held", detail: outcome.reason };
    }

    await repo.markDone(ctx.db, job.id, ctx.clock.realNow());
    await write("done", null);
    return { jobId: job.id, type: job.type, outcome: "done", detail: outcome.detail };
  } catch (error) {
    // Everything is caught, including a fault: a job that throws must back off
    // and let the next one run, not take the queue down with it. The message is
    // kept on the row and on the run, which is where somebody looks.
    const message = error instanceof AppError || error instanceof Error ? error.message : "Failed.";

    const { status } = await repo.markFailed(ctx.db, job.id, {
      error: message,
      attempts: job.attempts,
      now: ctx.clock.realNow(),
    });

    await write(status === "failed" ? "failed" : "retrying", message);

    return {
      jobId: job.id,
      type: job.type,
      outcome: status === "failed" ? "failed" : "retrying",
      detail: message,
    };
  }
}
