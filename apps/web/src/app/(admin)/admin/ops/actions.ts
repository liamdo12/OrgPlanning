"use server";

import { revalidatePath } from "next/cache";
import {
  AppError,
  assertReseedAllowed,
  clearAllOverrides,
  clearClockOverride,
  recordAudit,
  requeueJob,
  runDemoJobs,
  setClockOverride,
} from "@occasion/core";
import { reseedDemo } from "@occasion/db/demo";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { getEnv } from "../../../../lib/env";
import { formatMoment } from "../../../../lib/format-moment";
import { readString } from "../../../../lib/form-values";

/**
 * The automations screen's actions.
 *
 * Each calls `requireAdminActor()` as its first statement, and each is refused
 * again in the domain on the tier — a server action is reachable by a direct
 * POST that renders no layout, and `APP_TIER` is the thing standing between a
 * production deployment and a button that moves time or empties tables.
 */

export type OpsActionState = {
  error?: string;
  message?: string;
};

async function run(work: () => Promise<string>): Promise<OpsActionState> {
  try {
    const message = await work();
    revalidatePath("/admin/ops");
    return { message };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function setClockAction(
  _previous: OpsActionState,
  form: FormData,
): Promise<OpsActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const at = new Date(readString(form, "at"));
    if (Number.isNaN(at.getTime())) {
      throw new AppError("That is not one of the demo moments.");
    }

    const override = await setClockOverride(ctx, actor, at);
    return `The queue now reads as ${formatMoment(override.effectiveAt)}. Nothing has run; this is a preview, and it lapses on its own.`;
  });
}

export async function clearClockAction(
  _previous: OpsActionState,
  _form: FormData,
): Promise<OpsActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    await clearClockOverride(ctx, actor);
    return "Back on the real clock.";
  });
}

export async function runJobsAction(
  _previous: OpsActionState,
  _form: FormData,
): Promise<OpsActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    const summary = await runDemoJobs(ctx, actor);

    if (summary.claimed === 0) {
      return "Nothing was due on demo data at that moment.";
    }

    const parts = [`${summary.done} ran`];
    if (summary.held > 0) parts.push(`${summary.held} held`);
    if (summary.failed > 0) parts.push(`${summary.failed} failed`);

    // The as-of is in the message on purpose: a run under a shifted clock did
    // not happen "now", and the history row says so too.
    return `${parts.join(", ")} as of ${formatMoment(summary.asOf)}. Demo rows only.`;
  });
}

/**
 * Puts a parked job back in the queue.
 *
 * `held` is not a failure — a payout for a suspended vendor, an auto-complete
 * on a booking somebody has flagged — and nothing clears those reasons on its
 * own. Without a button the only way back was SQL against the jobs table, at
 * exactly the point where money has not moved.
 */
export async function requeueJobAction(
  _previous: OpsActionState,
  form: FormData,
): Promise<OpsActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    await requeueJob(ctx, actor, readString(form, "jobId"));
    return "Back in the queue. The next run decides whether the reason has gone.";
  });
}

/**
 * Rebuilds the demo data.
 *
 * Every guard is in the domain — the tier, the typed confirmation, a job
 * mid-flight, a payment with no outcome yet — so a direct POST meets the same
 * refusals as the dialog. This function's own job is the part the domain cannot
 * do: it holds the connection string, and `reseedDemo` takes one.
 *
 * The overrides go with the data. A reseed moves the anchor every seeded date
 * is measured from, so an override set against the old one points at a moment
 * that no longer means what it meant when somebody chose it.
 */
export async function reseedAction(
  _previous: OpsActionState,
  form: FormData,
): Promise<OpsActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  return run(async () => {
    await assertReseedAllowed(ctx, actor, readString(form, "confirmation"));

    const env = getEnv();
    const result = await reseedDemo({
      connectionString: env.DATABASE_URL,
      allowDestructive: env.ALLOW_DESTRUCTIVE_SEED,
      anchorAt: ctx.clock.realNow(),
    });

    // The override rows go with the data, and the reseed itself deletes them
    // inside its transaction; this is belt and braces for a partial failure.
    await clearAllOverrides(ctx);

    await recordAudit(ctx, actor, {
      action: "ops.demo.reseed",
      entityType: "platform",
      after: { anchorAt: result.anchorAt.toISOString(), counts: result.counts },
    });

    const total = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
    return `Demo data rebuilt: ${total} rows, anchored at ${formatMoment(result.anchorAt)}. Seeded accounts have no provider login until auth:provision runs.`;
  });
}
