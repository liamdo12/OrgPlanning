import { index, integer, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { app, isDemo, timestamps, TABLE_PREFIX } from "./common.js";
import { jobStatus, jobTrigger, jobType } from "./enums.js";
import { users } from "./identity.js";

/**
 * Scheduled work.
 *
 * `dedupeKey` is unique per type, which is the layer that stops the same
 * balance being charged twice however many times the runner is triggered. It is
 * derived from what the job is about — an order id and a purpose — never from
 * the time it was queued.
 */
export const jobs = app.table(
  `${TABLE_PREFIX}jobs`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: jobType("type").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    dedupeKey: text("dedupe_key").notNull(),
    /** When the job becomes eligible, measured on the domain clock. */
    runAfter: timestamp("run_after", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Why a payout-bearing job is parked, e.g. a suspended vendor. */
    heldReason: text("held_reason"),
    isDemo,
    ...timestamps,
  },
  (table) => [
    unique("jobs_type_dedupe_key").on(table.type, table.dedupeKey),
    index("jobs_due_idx").on(table.status, table.runAfter),
  ],
);

/**
 * One execution of a job.
 *
 * `effectiveNow` and `clockOverrideActorId` are the provenance that makes the
 * admin clock override auditable: every run records what time the system
 * believed it was and who told it so. A run with an override and a
 * non-demo row is the signal that the safety filter has failed.
 */
export const jobRuns = app.table(
  `${TABLE_PREFIX}job_runs`,
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    result: text("result"),
    error: text("error"),
    /** The time the run used, shifted when an override was in effect. */
    effectiveNow: timestamp("effective_now", { withTimezone: true }).notNull(),
    /** The real wall clock, never shifted. */
    realNow: timestamp("real_now", { withTimezone: true }).notNull(),
    clockOverrideActorId: uuid("clock_override_actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Whoever asked for this run. Null when the timer did.
     *
     * Separate from the override's actor, because they answer different
     * questions and are routinely different people — or, for a run with no
     * override at all, one of them is nobody. "An administrator ran this" and
     * "an administrator had moved the clock" both have to be answerable from
     * this row alone, months later.
     */
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    triggeredBy: jobTrigger("triggered_by").notNull(),
    ...timestamps,
  },
  (table) => [
    index("job_runs_job_idx").on(table.jobId),
    index("job_runs_started_idx").on(table.startedAt),
    index("job_runs_clock_actor_idx").on(table.clockOverrideActorId),
    index("job_runs_triggered_by_idx").on(table.triggeredByUserId),
  ],
);
