import { and, eq, inArray, or, sql } from "drizzle-orm";
import { orders, payments, users, vendors } from "@occasion/db/schema";
import { demoClockStates, type DemoClockState } from "../clock/demo-states.js";
import {
  assertOverrideAllowed,
  clearOverride,
  previewNow,
  readOverride,
  setOverride,
  type StoredOverride,
} from "../clock/override.js";
import type { CoreContext } from "../context.js";
import { ValidationError } from "../errors.js";
import { isAuthenticated, type Actor } from "../identity/actor.js";
import { requireAdmin } from "../identity/service.js";
import { record } from "../audit/service.js";
import { formatMoney } from "../payments/money.js";
import { describeJob } from "./handlers.js";
import * as repo from "./repo.js";
import { runDueJobs, type RunSummary } from "./runner.js";

/**
 * The automations screen.
 *
 * It reads on the preview clock and writes on the real one. Every function here
 * says which it is using, because the whole point of the split is that nobody
 * has to guess: listing what is due is a question about a hypothetical moment,
 * and running something is an event in the present.
 */

export type QueuedJob = {
  id: string;
  type: repo.JobType;
  /** What it will do, in words. */
  describe: string;
  /** The order or request it is about, when the payload names one. */
  subject: string | null;
  runAfter: Date;
  /** `due now`, or the date it becomes due. The prototype's own shape. */
  due: string;
  status: repo.JobStatus;
  heldReason: string | null;
  attempts: number;
  lastError: string | null;
  isDemo: boolean;
};

export type OpsView = {
  /** The moment the queue below is read at. */
  asOf: Date;
  override: StoredOverride | null;
  /** Whether this deployment may move time at all. */
  overrideAllowed: boolean;
  states: DemoClockState[];
  queue: QueuedJob[];
  dueNow: number;
  runs: repo.JobRunRow[];
  /** Whether the reseed button may be offered. */
  reseedAllowed: boolean;
};

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

/** Everything the ops screen renders, read at the preview clock. */
export async function getOpsView(ctx: CoreContext, actor: Actor): Promise<OpsView> {
  requireAdmin(actor);

  const override = isAuthenticated(actor) ? await readOverride(ctx, actor.userId) : null;
  const asOf = previewNow(ctx, override);

  const [states, rows, runs] = await Promise.all([
    demoClockStates(ctx),
    repo.listQueue(ctx),
    repo.listRuns(ctx),
  ]);

  const subjects = await subjectsFor(ctx, rows);

  const queue = rows.map((job) => ({
    id: job.id,
    type: job.type,
    describe: describeJob(job.type),
    subject: subjects.get(job.id) ?? null,
    runAfter: job.runAfter,
    due:
      job.status === "held"
        ? "held"
        : job.runAfter.getTime() <= asOf.getTime()
          ? "due now"
          : dateFormat.format(job.runAfter),
    status: job.status,
    heldReason: job.heldReason,
    attempts: job.attempts,
    lastError: job.lastError,
    isDemo: job.isDemo,
  }));

  return {
    asOf,
    override,
    overrideAllowed: ctx.config.allowClockOverride && ctx.config.appTier !== "production",
    states,
    queue,
    dueNow: queue.filter((job) => job.due === "due now").length,
    runs,
    reseedAllowed: ctx.config.allowDestructiveSeed && ctx.config.appTier !== "production",
  };
}

/**
 * What each queued job is about, in one query.
 *
 * The prototype writes `Charge balance · TO-4192 · C$262.16` (line 2157). The
 * reference and the amount come off the order rather than out of the job's
 * payload: a payload is a snapshot of what was true when the job was queued,
 * and the queue is read to find out what is true now.
 */
async function subjectsFor(ctx: CoreContext, rows: repo.JobRow[]): Promise<Map<string, string>> {
  const byOrder = new Map<string, string[]>();
  for (const job of rows) {
    const orderId = repo.orderIdOf(job);
    if (!orderId) continue;
    byOrder.set(orderId, [...(byOrder.get(orderId) ?? []), job.id]);
  }

  const subjects = new Map<string, string>();
  if (byOrder.size === 0) return subjects;

  const found = await ctx.db
    .select({
      id: orders.id,
      reference: orders.reference,
      balanceAmount: orders.balanceAmount,
      currency: orders.currency,
    })
    .from(orders)
    // Parameterised, not interpolated. These ids come out of a `jsonb` payload,
    // which is to say out of whatever wrote the job — and a query built by
    // string concatenation from a payload is one payload away from being
    // something else.
    .where(inArray(orders.id, [...byOrder.keys()]));

  for (const order of found) {
    for (const jobId of byOrder.get(order.id) ?? []) {
      const job = rows.find((row) => row.id === jobId);
      const amount =
        job?.type === "charge_balance" && order.balanceAmount > 0n
          ? ` · ${formatMoney(order.balanceAmount, order.currency)}`
          : "";
      subjects.set(jobId, `${order.reference}${amount}`);
    }
  }

  return subjects;
}

/** Moves this administrator's preview clock to one of the demo states. */
export async function setClockOverride(
  ctx: CoreContext,
  actor: Actor,
  effectiveAt: Date,
): Promise<StoredOverride> {
  return setOverride(ctx, actor, effectiveAt);
}

export async function clearClockOverride(ctx: CoreContext, actor: Actor): Promise<void> {
  return clearOverride(ctx, actor);
}

/**
 * The administrator's "Run due jobs".
 *
 * Always `demoOnly`. An administrator with a shifted clock who could claim real
 * jobs would charge every card whose balance falls due before the moment they
 * jumped to — and consume the dedupe keys, so the real run on the real date
 * would find nothing and report success.
 */
export async function runDemoJobs(ctx: CoreContext, actor: Actor): Promise<RunSummary> {
  requireAdmin(actor);
  assertOverrideAllowed(ctx);

  const override = isAuthenticated(actor) ? await readOverride(ctx, actor.userId) : null;

  return runDueJobs(ctx, {
    asOf: previewNow(ctx, override),
    demoOnly: true,
    trigger: "admin_button",
    overrideActorId: override?.actorUserId ?? null,
    // Whoever pressed it, whether or not they had moved the clock. Most runs
    // have no override, and without this the record would say a person did it
    // and be unable to say which person.
    triggeredByUserId: isAuthenticated(actor) ? actor.userId : null,
  });
}

/**
 * Puts a parked job back in the queue.
 *
 * `held` means the job ran and could not finish for a reason that was not its
 * fault — a suspended vendor, an order in a state it could not act on. Nothing
 * clears those reasons automatically, so without this the only way back was
 * hand-written SQL against the jobs table, which is not a thing to ask of
 * somebody at the point where money has not moved.
 *
 * It re-queues rather than runs: the next tick, or the next press of the
 * button, decides whether the reason has actually gone.
 */
export async function requeueJob(ctx: CoreContext, actor: Actor, jobId: string): Promise<void> {
  requireAdmin(actor);

  // One transaction, because the entry describes a state that is read before
  // the write and destroyed by it. Outside one, the lock the read takes is
  // released immediately and the audit row can commit on its own.
  await ctx.db.transaction(async (tx) => {
    const before = await repo.requeue(tx, jobId, ctx.clock.realNow());
    if (!before) {
      throw new ValidationError("That job is not parked.", { job: "not_held" });
    }

    await record(
      ctx,
      actor,
      {
        action: "ops.job.requeue",
        entityType: "job",
        entityId: jobId,
        before,
        after: { status: "queued", heldReason: null, attempts: 0 },
      },
      tx,
    );
  });
}

/**
 * Everything standing between the reseed button and the data it rebuilds.
 *
 * Checked here rather than in the caller so the answer is the same whoever
 * asks, and returned as a list rather than thrown one at a time so the screen
 * can say all of it at once.
 */
export type ReseedBlocker = { code: string; message: string };

export async function reseedBlockers(
  ctx: CoreContext,
  actor: Actor,
  typed: string,
): Promise<ReseedBlocker[]> {
  requireAdmin(actor);

  const blockers: ReseedBlocker[] = [];

  if (!ctx.config.allowDestructiveSeed || ctx.config.appTier === "production") {
    blockers.push({
      code: "tier",
      message: "Reseeding is not available on this deployment.",
    });
  }

  // The tier name, typed out. Not a checkbox: the point is to make somebody
  // read which deployment they are about to empty.
  if (typed.trim() !== ctx.config.appTier) {
    blockers.push({
      code: "confirmation",
      message: `Type ${ctx.config.appTier} to confirm which deployment this is.`,
    });
  }

  if (await repo.anyRunning(ctx)) {
    blockers.push({
      code: "running",
      message: "A job is running. Reseeding now would delete rows it is halfway through.",
    });
  }

  const [pending] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(payments)
    .where(eq(payments.state, "pending"));

  if ((pending?.total ?? 0) > 0) {
    blockers.push({
      code: "pending_payment",
      message:
        "A payment attempt has no outcome yet. Deleting it would lose the only record of a charge that may still settle.",
    });
  }

  // A real booking attached to a demo row. The reseed deletes demo rows and
  // leaves everything else standing, which it cannot do here: the vendor or the
  // customer is on its list and the order referencing them is not, so the
  // delete is refused by the foreign key — as a Postgres error, several layers
  // below the button.
  //
  // **Both sides**, because the customer is the likelier one. `createCheckout`
  // writes `is_demo: false` on every order it makes, and the ordinary way to
  // try the deployed demo is to sign in as a seeded account and book something.
  // That produces a real order owned by a demo user on the first attempt.
  //
  // Refused with a sentence instead. Deleting the order is not on offer: it is
  // somebody's booking, and the contract of this operation is that it touches
  // demo rows only.
  const [attached] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(orders)
    .innerJoin(vendors, eq(vendors.id, orders.vendorId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(and(eq(orders.isDemo, false), or(eq(vendors.isDemo, true), eq(users.isDemo, true))));

  if ((attached?.total ?? 0) > 0) {
    blockers.push({
      code: "real_orders_on_demo_rows",
      message: `${attached?.total} order(s) that are not demo data belong to a demo account or a demo business. Reseeding would have to delete those rows out from under them.`,
    });
  }

  return blockers;
}

/** Refuses unless nothing is in the way. */
export async function assertReseedAllowed(
  ctx: CoreContext,
  actor: Actor,
  typed: string,
): Promise<void> {
  const blockers = await reseedBlockers(ctx, actor, typed);
  if (blockers.length > 0) {
    throw new ValidationError(blockers.map((blocker) => blocker.message).join(" "), {
      reseed: blockers[0]?.code ?? "refused",
    });
  }
}
