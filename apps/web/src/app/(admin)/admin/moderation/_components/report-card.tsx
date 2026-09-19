import { GlassCard, StatusBadge } from "@occasion/ui";
import type { ReportSummary } from "@occasion/core";
import { formatMoment } from "../../../../../lib/format-moment";
import { DecisionForm } from "./decision-form";

/**
 * One report, with the words it is about.
 *
 * A card rather than a table row: the thing being decided is a paragraph
 * somebody wrote, and a moderator cannot decide anything without reading it.
 * The reported text is quoted in full — truncating it is how a decision gets
 * made about the first eighty characters of a complaint.
 */
export function ReportCard({ report }: { report: ReportSummary }) {
  return (
    <GlassCard as="article" className="grid gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={report.open ? "warn" : "neutral"}>
            {report.decisionLabel ?? "Waiting"}
          </StatusBadge>
          <span className="text-sm opacity-70">{report.content.context}</span>
        </div>
        <span className="text-sm opacity-70">{formatMoment(report.createdAt)}</span>
      </header>

      <div className="grid gap-1">
        <h3 className="m-0 text-base font-semibold">{report.reason}</h3>
        <p className="m-0 text-sm opacity-80">
          Reported by {report.reporterName ?? "an account since removed"} · about{" "}
          {report.targetLabel}
        </p>
        {report.detail ? <p className="m-0 text-sm opacity-80">{report.detail}</p> : null}
      </div>

      {report.content.present ? (
        <blockquote className="m-0 border-l-2 border-[color:var(--color-hairline)] pl-3 text-sm">
          {report.content.body ? (
            report.content.body
          ) : (
            <span className="opacity-70">No words — a rating on its own.</span>
          )}
          {report.content.authorName ? (
            <footer className="mt-1 text-xs opacity-70">— {report.content.authorName}</footer>
          ) : null}
        </blockquote>
      ) : (
        // Said out loud rather than rendered as a blank quote, which looks like
        // a bug rather than like a report somebody can close in a second.
        <p className="m-0 text-sm opacity-70">
          This content is no longer on the platform. Nothing needs to be done to it.
        </p>
      )}

      {report.open ? (
        // Offered even when the content has gone. There is nothing to do *to*
        // it, but the report is still an open queue entry: without a control it
        // sits at the top of the waiting list and in its count for ever, which
        // is the dead-control shape inverted.
        <DecisionForm
          reportId={report.id}
          choices={report.content.present ? report.choices : ["keep"]}
          {...(report.content.present
            ? {}
            : { hint: "The content is gone. Closing this only clears the queue entry." })}
        />
      ) : null}

      {!report.open ? (
        <p className="m-0 text-sm opacity-70">
          {report.decisionLabel} by {report.decidedByName ?? "an account since removed"}
          {report.decidedAt ? ` · ${formatMoment(report.decidedAt)}` : ""}
          {report.decisionNote ? ` · ${report.decisionNote}` : ""}
        </p>
      ) : null}
    </GlassCard>
  );
}
