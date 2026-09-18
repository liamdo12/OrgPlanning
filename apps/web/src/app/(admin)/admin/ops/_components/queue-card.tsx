"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Toast, ToastRegion } from "@occasion/ui";
import type { QueuedJob } from "@occasion/core";
import { requeueJobAction, runJobsAction, type OpsActionState } from "../actions";
import { ReseedDialog } from "./reseed-dialog";

/**
 * The job queue card.
 *
 * Line 1844: the one solid surface on the page — the role fill, not glass —
 * with the due list above two buttons. The prototype's rows are
 * `name · due`; ours add what a job is about and, where it is a charge, how
 * much, because an administrator deciding whether to press the button needs to
 * know what it will move.
 *
 * "Run due jobs" says what it will and will not touch. The prototype's button
 * is unlabelled beyond its name, and the difference between "run the platform's
 * timers" and "run the demo's timers" is the difference between a rehearsal and
 * charging somebody's card.
 */

const INITIAL: OpsActionState = {};

export function QueueCard({
  jobs,
  dueNow,
  asOf,
  canRun,
  canReseed,
  tier,
}: {
  jobs: readonly QueuedJob[];
  dueNow: number;
  /** The moment the list was read at, already formatted. */
  asOf: string;
  canRun: boolean;
  canReseed: boolean;
  /** The deployment name somebody has to type to reseed. */
  tier: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reported, setReported] = useState<OpsActionState | null>(null);

  const [state, submit, pending] = useActionState(
    async (previous: OpsActionState, form: FormData) => {
      const next = await runJobsAction(previous, form);
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );

  const outcome = reported ?? state;

  return (
    <section className="oc-queue-card">
      <h2 className="m-0 mb-1 text-[17px]">Job queue</h2>
      <p className="m-0 mb-4 text-row opacity-80">
        {dueNow === 0
          ? `As of ${asOf}, nothing is due.`
          : `As of ${asOf}, ${dueNow} ${dueNow === 1 ? "job is" : "jobs are"} due.`}
      </p>

      <div className="mb-4 grid gap-2">
        {jobs.length === 0 ? (
          <p className="m-0 text-row opacity-80">The queue is empty.</p>
        ) : (
          jobs.map((job) => (
            <p key={job.id} className="oc-queue-row">
              <span className="min-w-0">
                {job.describe}
                {job.subject ? ` · ${job.subject}` : ""}
                {job.heldReason ? (
                  <span className="block text-row opacity-75">{job.heldReason}</span>
                ) : null}
                {/* Why it is backing off. The runbook says to read this, so the
                    screen may as well be where it is read. */}
                {job.attempts > 0 && job.lastError ? (
                  <span className="block text-row opacity-75">
                    Attempt {job.attempts}: {job.lastError}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2 whitespace-nowrap opacity-80">
                {job.due}
                {job.status === "held" || job.status === "failed" ? (
                  <RequeueButton jobId={job.id} onDone={setReported} />
                ) : null}
              </span>
            </p>
          ))
        )}
      </div>

      {canRun ? (
        <form action={submit}>
          <button type="submit" className="oc-queue-button" disabled={pending}>
            {pending ? "Running…" : "Run due jobs"}
          </button>
        </form>
      ) : null}

      {canReseed ? (
        <button type="button" className="oc-queue-button--ghost" onClick={() => setAsking(true)}>
          Reseed demo data
        </button>
      ) : null}

      {!canRun && !canReseed ? (
        <p className="m-0 text-row opacity-80">
          Running and reseeding are limited to local and demo deployments. The platform&rsquo;s own
          timer still runs here.
        </p>
      ) : null}

      <ReseedDialog
        open={asking}
        tier={tier}
        onClose={() => setAsking(false)}
        onDone={(result) => {
          setAsking(false);
          setReported(result);
          router.refresh();
        }}
      />

      {outcome.error || outcome.message ? (
        <ToastRegion>
          <Toast tone={outcome.error ? "danger" : "success"} onDismiss={() => setReported(null)}>
            {outcome.error ?? outcome.message}
          </Toast>
        </ToastRegion>
      ) : null}
    </section>
  );
}

/**
 * Puts one parked job back in the queue.
 *
 * Deliberately not "run it now": the reason it parked may still be true, and
 * the next run is what finds out. Pressing this on a job whose vendor is still
 * suspended parks it again, with the same reason.
 */
function RequeueButton({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone: (state: OpsActionState) => void;
}) {
  const router = useRouter();

  const [, submit, pending] = useActionState(async (previous: OpsActionState, form: FormData) => {
    const next = await requeueJobAction(previous, form);
    onDone(next);
    if (!next.error) router.refresh();
    return next;
  }, INITIAL);

  return (
    <form action={submit}>
      <input type="hidden" name="jobId" value={jobId} />
      <button type="submit" className="oc-queue-requeue" disabled={pending}>
        {pending ? "…" : "Re-queue"}
      </button>
    </form>
  );
}
