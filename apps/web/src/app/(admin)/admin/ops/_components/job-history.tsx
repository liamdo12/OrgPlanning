import { GlassPanel } from "@occasion/ui";
import { describeJob, type JobRunRow } from "@occasion/core";
import { formatMoment } from "../../../../../lib/format-moment";

/**
 * What has actually run.
 *
 * Not in the prototype, and the reason it is here is the clock override: a
 * payout made under a shifted clock has to be explainable from the record
 * alone, months later, by somebody who was not in the room. So each row carries
 * both times — the moment the run believed it was, and the moment it really
 * happened — and says when they differ.
 *
 * That pair is the whole point. "The vendor was paid on the 6th of March" and
 * "somebody demonstrated the March payout in September" are different facts,
 * and a history with one timestamp cannot tell them apart.
 */

const TRIGGERS: Record<string, string> = {
  cron: "on the timer",
  admin_button: "by hand",
  system: "by the platform",
};

export function JobHistory({ runs }: { runs: readonly JobRunRow[] }) {
  return (
    <GlassPanel as="section" className="mt-6 p-5">
      <h2 className="m-0 mb-1 text-[17px] font-bold">Recent runs</h2>
      <p className="mt-0 mb-4 max-w-[66ch] text-row text-pretty text-body">
        Every run records the time it was made against as well as the time it happened. When the two
        differ, somebody had moved the clock — and only demo rows can be reached that way.
      </p>

      {runs.length === 0 ? (
        <p className="m-0 text-[14px] text-body">Nothing has run yet.</p>
      ) : (
        <ol className="m-0 grid list-none gap-2 p-0 text-[14px]">
          {runs.map((run) => {
            // A tolerance, not an equality. Even an unshifted run has two
            // readings a few milliseconds apart — the batch takes its as-of
            // once and each job stamps the wall clock as it finishes — so
            // exact inequality would label every ordinary run as time-shifted.
            const shifted = Math.abs(run.effectiveNow.getTime() - run.realNow.getTime()) > 60_000;

            return (
              <li key={run.id}>
                <span className="font-bold">{describeJob(run.type)}</span>
                <span className="text-body">
                  {" "}
                  · {run.result ?? "unknown"} · {TRIGGERS[run.triggeredBy] ?? run.triggeredBy}
                </span>
                {run.error ? <span className="block text-ink">{run.error}</span> : null}
                <span className="block text-row text-body">
                  {formatMoment(run.realNow)}
                  {shifted ? `, as of ${formatMoment(run.effectiveNow)}` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </GlassPanel>
  );
}
