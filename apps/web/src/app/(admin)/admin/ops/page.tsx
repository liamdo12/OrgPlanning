import { getOpsView } from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { formatMoment } from "../../../../lib/format-moment";
import { ClockCard, type ClockChoice } from "./_components/clock-card";
import { QueueCard } from "./_components/queue-card";
import { JobHistory } from "./_components/job-history";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Automations · Occasion admin" };

/**
 * The prototype's `a_ops` screen, made real.
 *
 * Its explanatory paragraph is kept almost verbatim (line 1834) because it is
 * the best short statement of what the platform does on a timer, and one clause
 * is added: that the override is a preview. The prototype's clock jumps only
 * relabel a hard-coded list; here they change what is genuinely due, and the
 * button beside them genuinely charges cards — demo ones.
 */

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

export default async function AdminOpsPage() {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const view = await getOpsView(ctx, actor);

  // Line 2733: `Sep 15, 2026 · now`, with the marker in front. The date is
  // computed from the seed's anchor; the shorthand after it is the prototype's.
  const choices: ClockChoice[] = view.states.map((state) => ({
    key: state.key,
    label: `${dayFormat.format(state.at)} · ${state.name}`,
    at: state.at.toISOString(),
    selected: view.override?.effectiveAt.getTime() === state.at.getTime(),
  }));

  return (
    <AdminPage
      title="Automations"
      blurb="The platform runs five things on a timer: the 48-hour free-cancellation window, the balance charge 14 days before each event, quote requests expiring, unpaid holds being released, and orders auto-completing 72 hours after the event. This page shows what is queued — and the clock override previews any of those moments now instead of waiting for the date."
    >
      <div className="grid gap-[18px] desk:grid-cols-2">
        <ClockCard
          current={view.override ? formatMoment(view.asOf) : `${formatMoment(view.asOf)} · now`}
          choices={choices}
          allowed={view.overrideAllowed}
          expiresAt={view.override ? formatMoment(view.override.expiresAt) : null}
        />

        <QueueCard
          jobs={view.queue}
          dueNow={view.dueNow}
          asOf={formatMoment(view.asOf)}
          canRun={view.overrideAllowed}
          canReseed={view.reseedAllowed}
          tier={ctx.config.appTier}
        />
      </div>

      <JobHistory runs={view.runs} />
    </AdminPage>
  );
}
