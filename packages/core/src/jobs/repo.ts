import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { jobRuns, jobs, orders } from "@occasion/db/schema";
import type { CoreContext, DbExecutor } from "../context.js";
import type { ScheduledJobType } from "../ordering/transitions.js";

/**
 * Database access for the job queue.
 *
 * The one function here that carries the design is `claimDue`. Everything else
 * reads or records; that one decides what a runner is allowed to take, and it
 * is where two separate guarantees meet: no two runners take the same job, and
 * a run on a shifted clock can only ever take a demo row.
 */

/** Every job type the platform schedules, including the ones jobs schedule. */
export type JobType = ScheduledJobType | "expire_quote_request" | "send_email";

export type JobStatus = "queued" | "running" | "done" | "failed" | "held";

export type JobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  dedupeKey: string;
  runAfter: Date;
  payload: Record<string, unknown>;
  attempts: number;
  lastError: string | null;
  heldReason: string | null;
  isDemo: boolean;
};

const jobColumns = {
  id: jobs.id,
  type: jobs.type,
  status: jobs.status,
  dedupeKey: jobs.dedupeKey,
  runAfter: jobs.runAfter,
  payload: jobs.payload,
  attempts: jobs.attempts,
  lastError: jobs.lastError,
  heldReason: jobs.heldReason,
  isDemo: jobs.isDemo,
};

/** The order a job is about, when it is about one. */
export function orderIdOf(job: Pick<JobRow, "payload">): string | null {
  const id = (job.payload as { orderId?: unknown }).orderId;
  return typeof id === "string" ? id : null;
}

/**
 * Queues work, once.
 *
 * `(type, dedupe_key)` is unique and the key is derived from what the job is
 * about rather than when it was queued, so a second insert is a no-op instead
 * of a second charge. Every caller that schedules anything goes through here.
 */
export async function enqueue(
  db: DbExecutor,
  input: {
    type: JobType;
    dedupeKey: string;
    runAfter: Date;
    payload: Record<string, unknown>;
    isDemo: boolean;
  },
): Promise<boolean> {
  const inserted = await db
    .insert(jobs)
    .values({
      type: input.type,
      dedupeKey: input.dedupeKey,
      runAfter: input.runAfter,
      payload: input.payload,
      isDemo: input.isDemo,
    })
    // A job that is **parked or given up on** is re-armed when the lifecycle
    // asks for it again; one that **finished** is never touched.
    //
    // That asymmetry is the whole rule, and both halves are load-bearing. An
    // order can leave `fulfilled` for `issue` and come back: the auto-complete
    // job comes due in between, finds a state it cannot act on and parks, and
    // the re-entry has to be able to wake it — otherwise the order sits
    // `fulfilled` for ever, never completes, and the balance share, which is
    // the larger half of the vendor's money, is never transferred. Silently.
    //
    // Leaving `done` alone is what keeps the dedupe key a real guarantee: it is
    // the layer that stops a replayed confirmation charging a second time, and
    // a key that could be re-armed by an insert would stop being one.
    .onConflictDoUpdate({
      target: [jobs.type, jobs.dedupeKey],
      set: {
        status: "queued",
        runAfter: input.runAfter,
        payload: input.payload,
        heldReason: null,
        attempts: 0,
        updatedAt: new Date(),
      },
      setWhere: inArray(jobs.status, ["held", "failed"]),
    })
    .returning({ id: jobs.id });

  return inserted.length === 1;
}

/**
 * Moves a **queued** job's deadline forward, and nothing else.
 *
 * `enqueue` cannot do this. Its upsert carries
 * `setWhere: inArray(jobs.status, ["held", "failed"])`, so a live `queued` job
 * conflicts, updates nothing and returns `false` — a re-arm written through it
 * moves no deadline and says nothing about having failed to. The obvious second
 * attempt is worse: `cancelQueuedJobs` sets `done`, which is the one status
 * `enqueue` will never re-arm, so cancel-then-enqueue destroys the job
 * permanently and whatever it was going to release is never released.
 *
 * So this is a narrower statement than either. It cannot resurrect a `done`
 * row, cannot reach a `held` one, cannot reset `attempts` and cannot create a
 * job. `greatest` is what keeps it a re-arm rather than a reschedule: a
 * deadline only ever moves later, so a caller asking for an earlier one leaves
 * the later one standing rather than quietly pulling a charge forward.
 *
 * Answers the row's deadline as it now stands, or nothing at all when no
 * `queued` row matched — a job already claimed by a runner is an ordinary
 * answer here, not a fault.
 */
export async function rearmQueuedJob(
  db: DbExecutor,
  input: { type: JobType; dedupeKey: string; runAfter: Date },
): Promise<Date | undefined> {
  const [row] = await db
    .update(jobs)
    .set({
      runAfter: sql`greatest(${jobs.runAfter}, ${input.runAfter.toISOString()}::timestamptz)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.type, input.type),
        eq(jobs.dedupeKey, input.dedupeKey),
        eq(jobs.status, "queued"),
      ),
    )
    .returning({ runAfter: jobs.runAfter });

  return row?.runAfter;
}

/**
 * Puts the job a handler is **running** back in the queue, later.
 *
 * The handler's own row is `running` while it executes — `claimDue` sets that
 * in the same statement it takes the job with — so `rearmQueuedJob` matches
 * nothing from inside a handler. This is the statement that does.
 *
 * It exists for the outcome that is neither success nor failure: work that
 * cannot finish yet because something outside this platform is mid-flight, and
 * which must be asked about again rather than waited on. `attempts` is
 * incremented so the loop is bounded by the same ceiling a failing job has, and
 * at the ceiling the job is **held** with its reason rather than `failed` —
 * "waiting on the provider" is not a fault, and an operator reading a failure
 * list should not have to work out that it was never one.
 *
 * `last_error` is deliberately not written. Nothing went wrong.
 */
export async function rearmRunningJob(
  db: DbExecutor,
  jobId: string,
  input: { runAfter: Date; attempts: number; reason: string; now: Date },
): Promise<{ status: JobStatus; runAfter: Date }> {
  const attempts = input.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;

  const [row] = await db
    .update(jobs)
    .set(
      exhausted
        ? { status: "held", heldReason: input.reason, attempts, updatedAt: input.now }
        : {
            status: "queued",
            heldReason: null,
            attempts,
            runAfter: sql`greatest(${jobs.runAfter}, ${input.runAfter.toISOString()}::timestamptz)`,
            updatedAt: input.now,
          },
    )
    .where(eq(jobs.id, jobId))
    .returning({ runAfter: jobs.runAfter });

  return { status: exhausted ? "held" : "queued", runAfter: row?.runAfter ?? input.runAfter };
}

/**
 * Takes up to `limit` jobs that are due, and marks them `running`.
 *
 * Three things happen in one statement, and each of them has to:
 *
 * **The status moves to `running` inside the same statement.** This is what
 * makes the claim exclusive: a claim that selected first and updated afterwards
 * leaves a window in which a second runner sees the same `queued` row and takes
 * it too. Two runners — a cron tick and an administrator pressing the button —
 * overlap routinely.
 *
 * **`skip locked` is about throughput, not correctness.** Without it the second
 * runner would still be safe: it blocks on the locked rows, and by the time it
 * proceeds they are no longer `queued`, so it takes none of them. What it would
 * not be is quick — it would wait out the first batch to discover there is
 * nothing to do. With it, it takes the next unlocked jobs instead.
 *
 * **`demoOnly` filters on the job *and* on its order.** A job row carries
 * `is_demo`, but the row that gets charged is the order, and the two can
 * disagree — a job scheduled by the lifecycle copies the order's flag at the
 * time it was queued. So this checks the order as well, and a job whose order
 * cannot be found is not taken. That is the guard that makes a shifted clock
 * safe: it cannot reach a real customer's card however far time is moved.
 */
/**
 * How long a job may sit `running` before another runner may take it.
 *
 * Nothing here takes minutes: the longest is a charge, and the provider's own
 * timeout is far below this. What the window is really sized for is the gap
 * between a process dying and anybody noticing — a deploy, an out-of-memory
 * kill, a platform function timeout — because without it those jobs are
 * `running` for ever and nothing reclaims them. A balance never collected and a
 * vendor never paid, with no error anywhere.
 *
 * Re-running a job that was in fact still working is survivable: every handler
 * asks the current state rather than assuming the one it was queued under.
 */
export const LEASE_MS = 15 * 60_000;

export async function claimDue(
  db: DbExecutor,
  input: { asOf: Date; limit: number; demoOnly: boolean },
): Promise<JobRow[]> {
  // "Demo-flagged, and if it names an order that order is demo-flagged too."
  //
  // Both halves are load-bearing. The job's own flag is copied from the order
  // when the lifecycle queues it, and the two can drift; the order's is what
  // decides whose card gets charged, so it is checked at claim time rather than
  // trusted. And a job that names no order — a quote expiring — is not exempt
  // from the first half, only from the second, or the demo could never run one.
  const demoFilter = input.demoOnly
    ? sql`and ${jobs.isDemo}
          and (
            ${jobs.payload} ->> 'orderId' is null
            or exists (
              -- The order's id as text, rather than the payload cast to uuid.
              -- The payload is jsonb written by several callers, and casting a
              -- value that is not a uuid raises — which aborts the whole claim,
              -- so one malformed row would stop every job on the platform being
              -- claimed, permanently, and never back off because it was never
              -- claimed either.
              select 1 from ${orders} o
              where o.id::text = ${jobs.payload} ->> 'orderId' and o.is_demo
            )
          )`
    : sql``;

  const claimed = await db.execute<JobRow>(sql`
    update ${jobs}
    set status = 'running', updated_at = now()
    where ${jobs.id} in (
      select ${jobs.id} from ${jobs}
      where (
          -- Due.
          --
          -- The instant is bound as text and cast, not as a Date: this
          -- statement is raw SQL rather than a query builder, so the driver has
          -- no column to infer the type from and it is stated.
          (${jobs.status} = 'queued' and ${jobs.runAfter} <= ${input.asOf.toISOString()}::timestamptz)
          -- Or abandoned: claimed by a process that never came back.
          or (${jobs.status} = 'running' and ${jobs.updatedAt} < now() - ${`${LEASE_MS} milliseconds`}::interval)
        )
        ${demoFilter}
      order by ${jobs.runAfter} asc
      for update skip locked
      -- Written into the statement rather than bound: the driver sends a bound
      -- integer as int8, which limit refuses. Coerced to a whole number first,
      -- and it never comes from a request in any case.
      limit ${sql.raw(String(Math.max(1, Math.trunc(input.limit))))}
    )
    returning
      ${jobs.id} as "id",
      ${jobs.type}::text as "type",
      ${jobs.status}::text as "status",
      ${jobs.dedupeKey} as "dedupeKey",
      ${jobs.runAfter} as "runAfter",
      ${jobs.payload} as "payload",
      ${jobs.attempts} as "attempts",
      ${jobs.lastError} as "lastError",
      ${jobs.heldReason} as "heldReason",
      ${jobs.isDemo} as "isDemo"
  `);

  // `execute` returns driver rows: the timestamp arrives as a string and the
  // flags as booleans, so the one column anything reads as a date is converted
  // here rather than at each call site.
  return claimed.map((row) => ({ ...row, runAfter: new Date(row.runAfter as unknown as string) }));
}

/** A job that did what it was for. */
/**
 * Finished, and the message body dropped.
 *
 * Dropping `html` is the security half. An email job's payload carries the
 * rendered message, and one of those messages — the declined-balance email —
 * contains a single-use payment link in plaintext. Everywhere else that link is
 * a hash, deliberately, so that reading a table hands nobody the capability it
 * describes; a `done` row keeping the rendered body for ever is the way around
 * that rule. Once the message has been handed to the provider the body has no
 * further reader, and `email_sends` holds the record that it was sent.
 *
 * Only that one key. The rest of the payload is what the queue is *about* —
 * `orderId` is how the admin screen labels a run "Charge balance · TO-4192" —
 * and emptying the whole thing takes that away.
 *
 * `done` only: a `failed` or `held` job still has to be retried from what it
 * was given, which for an email is the body.
 */
export async function markDone(db: DbExecutor, jobId: string, now: Date): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "done",
      payload: sql`${jobs.payload} - 'html'`,
      lastError: null,
      heldReason: null,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));
}

/**
 * A job that could not run yet, and is not the job's fault.
 *
 * `held` rather than `failed`: a transfer for a suspended vendor is correct
 * behaviour, not an error, and it must not burn an attempt or disappear into a
 * failure list nobody reads. It goes back to `queued` when the reason clears —
 * which nothing does automatically yet, so it sits in the admin queue with its
 * reason beside it.
 */
export async function markHeld(
  db: DbExecutor,
  jobId: string,
  input: { reason: string; now: Date },
): Promise<void> {
  await db
    .update(jobs)
    .set({ status: "held", heldReason: input.reason, updatedAt: input.now })
    .where(eq(jobs.id, jobId));
}

/**
 * Puts a parked or abandoned job back in the queue.
 *
 * Only `held` and `failed`, and never `done`: a job that finished is finished,
 * and re-queueing one would be a second charge or a second payout. Answers
 * whether it moved, so a caller can tell a refusal from a no-op.
 */
/** What the job looked like before it was put back, or undefined if it was not. */
export type Requeued = { status: JobStatus; heldReason: string | null; attempts: number };

export async function requeue(
  db: DbExecutor,
  jobId: string,
  now: Date,
): Promise<Requeued | undefined> {
  // `returning` reports the row as it is *after* the update, so the state being
  // left behind is read first. It is the only copy: re-queueing clears
  // `held_reason`, and without this the answer to "why was this parked" is gone
  // the moment somebody acts on it — from the row and from the log alike.
  //
  // Locked, and therefore only correct inside a transaction — which is why the
  // caller opens one. Unlocked, the runner can move the job between this read
  // and the update below: the update still succeeds, because `failed` is also
  // re-queueable, and the entry then records a reason that was already stale
  // when it was written.
  const [before] = await db
    .select({ status: jobs.status, heldReason: jobs.heldReason, attempts: jobs.attempts })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .for("update");

  const moved = await db
    .update(jobs)
    .set({ status: "queued", heldReason: null, attempts: 0, runAfter: now, updatedAt: now })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["held", "failed"])))
    .returning({ id: jobs.id });

  return moved.length === 1 ? before : undefined;
}

/**
 * How long to wait after the nth failure. Doubles, capped at six hours.
 *
 * The six-hour ceiling on a single wait is the payments domain's, and it has to
 * be a rule rather than a decoration — a cap that no wait ever reaches is a
 * comment pretending to be code. Fifteen minutes doubling gives 15, 30, 60,
 * 120, 240 and then 480, which is clamped to 360. So the last wait before a job
 * is abandoned is the one the ceiling binds, which is the only version of it
 * worth writing down.
 *
 * Six waits, then `failed`: about fourteen hours in all. Long enough to ride
 * out a provider outage overnight; short enough that a genuinely broken job is
 * on the failed list the next morning rather than the next week. A retry past
 * the provider's own idempotency window is handled where that matters, by the
 * attempt row's age rather than by this schedule.
 */
export function backoffMs(attempts: number): number {
  const base = 15 * 60_000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 6 * 3_600_000);
}

export const MAX_ATTEMPTS = 7;

/**
 * A job that threw.
 *
 * Re-queued with a doubling delay until the attempts run out, then `failed` and
 * left for a person. The delay matters more than the ceiling on attempts: a job
 * that retries immediately against a provider that is down turns one outage
 * into a rate-limit ban.
 */
export async function markFailed(
  db: DbExecutor,
  jobId: string,
  input: { error: string; attempts: number; now: Date },
): Promise<{ status: JobStatus; runAfter: Date }> {
  const attempts = input.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const runAfter = new Date(input.now.getTime() + backoffMs(attempts));

  await db
    .update(jobs)
    .set({
      status: exhausted ? "failed" : "queued",
      attempts,
      lastError: input.error.slice(0, 1000),
      runAfter,
      updatedAt: input.now,
    })
    .where(eq(jobs.id, jobId));

  return { status: exhausted ? "failed" : "queued", runAfter };
}

/**
 * Records one execution: what time it believed it was, and who told it so.
 *
 * Written whatever the outcome. A run that failed is the one somebody needs the
 * provenance for.
 */
export async function recordRun(
  db: DbExecutor,
  input: {
    jobId: string;
    result: string;
    error: string | null;
    effectiveNow: Date;
    realNow: Date;
    clockOverrideActorId: string | null;
    triggeredByUserId: string | null;
    triggeredBy: "cron" | "admin_button" | "system";
    startedAt: Date;
  },
): Promise<void> {
  await db.insert(jobRuns).values({
    jobId: input.jobId,
    startedAt: input.startedAt,
    finishedAt: input.realNow,
    result: input.result,
    error: input.error?.slice(0, 1000) ?? null,
    effectiveNow: input.effectiveNow,
    realNow: input.realNow,
    clockOverrideActorId: input.clockOverrideActorId,
    triggeredByUserId: input.triggeredByUserId,
    triggeredBy: input.triggeredBy,
  });
}

/** Everything queued or parked, soonest first. */
export function listQueue(ctx: CoreContext, limit = 50): Promise<JobRow[]> {
  return ctx.db
    .select(jobColumns)
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "held", "running"]))
    .orderBy(jobs.runAfter)
    .limit(limit) as Promise<JobRow[]>;
}

/** How many of those are due at a given moment. */
export async function countDue(ctx: CoreContext, asOf: Date): Promise<number> {
  const [row] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), lte(jobs.runAfter, asOf)));

  return row?.total ?? 0;
}

export type JobRunRow = {
  id: string;
  jobId: string;
  type: JobType;
  dedupeKey: string;
  result: string | null;
  error: string | null;
  effectiveNow: Date;
  realNow: Date;
  clockOverrideActorId: string | null;
  /** Whoever pressed the button. Null for a run on the timer. */
  triggeredByUserId: string | null;
  triggeredBy: string;
  startedAt: Date;
};

/** The last runs, newest first, with the job each one was for. */
export function listRuns(ctx: CoreContext, limit = 20): Promise<JobRunRow[]> {
  return ctx.db
    .select({
      id: jobRuns.id,
      jobId: jobRuns.jobId,
      type: jobs.type,
      dedupeKey: jobs.dedupeKey,
      result: jobRuns.result,
      error: jobRuns.error,
      effectiveNow: jobRuns.effectiveNow,
      realNow: jobRuns.realNow,
      clockOverrideActorId: jobRuns.clockOverrideActorId,
      triggeredByUserId: jobRuns.triggeredByUserId,
      triggeredBy: sql<string>`${jobRuns.triggeredBy}::text`,
      startedAt: jobRuns.startedAt,
    })
    .from(jobRuns)
    .innerJoin(jobs, eq(jobs.id, jobRuns.jobId))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit);
}

/** Whether anything is mid-flight, which a reseed must refuse to interrupt. */
export async function anyRunning(ctx: CoreContext): Promise<boolean> {
  const [row] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.status, "running"));

  return (row?.total ?? 0) > 0;
}
