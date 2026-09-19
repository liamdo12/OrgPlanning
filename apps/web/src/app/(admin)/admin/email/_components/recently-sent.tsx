import { EmptyState, GlassPanel, StatusBadge } from "@occasion/ui";
import type { SentSummary } from "@occasion/core";

/**
 * The send log (line 1778).
 *
 * One row per decision rather than per message: a broadcast to eleven hundred
 * accounts is one thing somebody did, and the prototype's own log says "All
 * accounts · 1,204" rather than listing them.
 *
 * The stats column says what the provider actually reported. Where it has
 * reported nothing — no delivery webhook configured, or the events have not
 * arrived yet — it says so. The prototype's "92% delivered · 61% opened" is an
 * invented number, and an invented number on an operations screen is worse than
 * a blank one, because somebody will act on it.
 */

const whenFormat = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  timeZone: "America/Toronto",
});

export function RecentlySent({
  sends,
  statsAvailable,
}: {
  sends: readonly SentSummary[];
  statsAvailable: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3 mt-[26px] text-[19px]">Recently sent</h2>

      {statsAvailable ? null : (
        <p className="m-0 mb-3 max-w-[64ch] text-pretty text-[13px] text-muted">
          Delivery and open rates come from the provider&rsquo;s webhook. None have arrived on this
          deployment, so that column is left empty rather than filled with a plausible number.
        </p>
      )}

      {sends.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          blurb="Every message the platform sends — the lifecycle's own and anything sent from this screen — is recorded here."
        />
      ) : (
        <div className="grid gap-[9px]">
          {sends.map((send) => (
            <GlassPanel key={send.key} className="flex flex-wrap items-center gap-[14px] p-[14px]">
              <span className="min-w-0 flex-[1_1_220px]">
                <span className="block text-[14px] font-bold">{send.subject}</span>
                <span className="block text-[13px] text-muted">
                  {send.toEmail ?? `${send.recipients.toLocaleString("en-CA")} recipients`} ·{" "}
                  {whenFormat.format(send.at)}
                </span>
              </span>

              <span className="whitespace-nowrap text-[13px] text-row">{send.stats}</span>

              <StatusBadge
                tone={
                  send.status === "Failed" ? "danger" : send.status === "Sent" ? "success" : "warn"
                }
              >
                {send.status}
              </StatusBadge>
            </GlassPanel>
          ))}
        </div>
      )}
    </section>
  );
}
