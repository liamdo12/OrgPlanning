import { Suspense } from "react";
import { SkeletonRows } from "@occasion/ui";
import {
  ORDER_STATES,
  PERIODS,
  VENDOR_STATUSES,
  getAnalytics,
  orderStateLabel,
  parsePeriod,
  periodLabel,
  type Period,
} from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { formatMoment } from "../../../../lib/format-moment";
import { PeriodTabs, type PeriodChoice } from "./_components/period-tabs";
import { Breakdown, Figure } from "./_components/figures";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Analytics · Occasion admin" };

/**
 * What an operator needs to know about the platform.
 *
 * A screen the prototype never drew. It is a fixed list of counts rather than a
 * query builder — anything beyond the list goes to the backlog, because a
 * screen that can ask anything becomes a reporting product and this one exists
 * so somebody can see that four vendors are waiting and one balance in nine is
 * being declined.
 *
 * The figures are streamed behind a boundary rather than cached. The
 * requirement is that they are not on the page's critical render path, and the
 * honest way to do that here is to render the page and let the aggregates
 * arrive: a cache would have to be invalidated by everything that writes an
 * order, and a stale number on an operations screen is worse than a slow one.
 * The whole set is one read-only snapshot, so the numbers agree with each
 * other.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * The period from the URL.
 *
 * Anything unrecognised falls back to the default rather than an error page:
 * this is a parameter somebody may have edited or a link that outlived a
 * rename.
 */
function periodFrom(value: string): Period {
  try {
    return parsePeriod(value);
  } catch {
    return "30d";
  }
}

const PERIOD_CHOICES: readonly PeriodChoice[] = PERIODS.map((period) => ({
  value: period,
  label: periodLabel(period),
}));

const USER_STATUSES = ["active", "pending", "unverified", "suspended"] as const;

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  // The gate, first and unbound: this half of the page renders nothing that
  // needs an actor, and the figures below run it again for themselves. It is
  // `cache()`d per render pass, so the second call is free.
  await requireAdminPage();

  const params = await searchParams;
  const period = periodFrom(first(params["period"]));

  return (
    <AdminPage
      title="Analytics"
      blurb="Counts and totals an operator needs. The standing populations are as of now; everything that happens is over the period chosen."
      toolbar={<PeriodTabs active={period} choices={PERIOD_CHOICES} />}
    >
      <Suspense key={period} fallback={<SkeletonRows rows={6} />}>
        <Figures period={period} />
      </Suspense>
    </AdminPage>
  );
}

/**
 * The aggregates.
 *
 * A separate component so the boundary above has something to wait on — the
 * page renders its heading and its period tabs immediately, and the six
 * aggregates arrive when they arrive.
 */
async function Figures({ period }: { period: Period }) {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const view = await getAnalytics(ctx, actor, period);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 desk:grid-cols-4">
        <Figure
          label="Gross bookings"
          value={view.bookings.grossDisplay}
          note={`${view.bookings.orders} order${view.bookings.orders === 1 ? "" : "s"} placed`}
        />
        <Figure
          label="Commission earned"
          value={view.bookings.commissionDisplay}
          note="Including the tax charged on it"
        />
        <Figure
          label="Balance charges declined"
          value={view.balanceFailures.display}
          note={
            view.balanceFailures.denominator === 0
              ? "No balance was attempted in this period"
              : `${view.balanceFailures.numerator} of ${view.balanceFailures.denominator} attempts`
          }
        />
        <Figure
          label="Jobs that failed"
          value={view.jobFailures.display}
          note={
            view.jobFailures.denominator === 0
              ? "Nothing ran in this period"
              : `${view.jobFailures.numerator} of ${view.jobFailures.denominator} runs · ${view.jobsHeld} held now`
          }
        />
      </div>

      <div className="grid gap-4 desk:grid-cols-3">
        <Breakdown
          title="Vendors, now"
          counts={view.vendorsByStatus}
          order={VENDOR_STATUSES}
          label={(key) => key[0]!.toUpperCase() + key.slice(1)}
        />
        <Breakdown
          title="Accounts, now"
          counts={view.usersByStatus}
          order={USER_STATUSES}
          label={(key) => key[0]!.toUpperCase() + key.slice(1)}
        />
        <Breakdown
          title={`Orders placed · ${view.periodLabel.toLowerCase()}`}
          counts={view.ordersByState}
          order={ORDER_STATES}
          label={(key) => orderStateLabel(key as (typeof ORDER_STATES)[number])}
        />
      </div>

      {/* The moment the snapshot was taken, on the domain clock — so an
          administrator previewing a shifted time can see that is what they are
          looking at. */}
      <p className="m-0 text-sm opacity-70">
        As of {formatMoment(view.asOf)} · {view.periodLabel.toLowerCase()}
      </p>
    </div>
  );
}
