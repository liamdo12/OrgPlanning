import { EmptyState, GlassPanel } from "@occasion/ui";
import {
  DISPUTE_STATES,
  NotFoundError,
  disputeStateLabel,
  getDispute,
  listDisputes,
  type DisputeState,
} from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { DisputeFilters, type FilterChoice } from "./_components/dispute-filters";
import { DisputeRow } from "./_components/dispute-row";
import { DisputeDrawer } from "./_components/dispute-drawer";
import { DisputeDetailPanel } from "./_components/dispute-detail";
import { OpenCaseDialog } from "./_components/open-case-dialog";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Disputes · Occasion admin" };

/**
 * The complaints queue.
 *
 * A screen the prototype never drew — the business proposal asks for it and the
 * red team found it in a gap between "in scope" and "out of scope". It is built
 * from the same tokens, the same list surface and the same drawer as the four
 * screens beside it, and is recorded in `docs/design-gaps.md`.
 *
 * Which case is open is a query parameter rather than client state, so the file
 * is server-rendered behind the same gate as the queue and can be linked to.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * The filter from the URL.
 *
 * A value that is not a state is treated as no filter rather than refused. This
 * is a query parameter somebody may have edited or a link that outlived a
 * rename, and answering an error page for it would be a worse outcome than
 * showing the whole queue.
 */
function filterFrom(value: string): DisputeState | "all" | "unassigned" {
  if (value === "unassigned") return "unassigned";
  return DISPUTE_STATES.find((state) => state === value) ?? "all";
}

/** The chips, built here so the client component needs no runtime domain import. */
const FILTER_CHOICES: readonly FilterChoice[] = [
  { value: "all", label: "All" },
  ...DISPUTE_STATES.map((state) => ({ value: state, label: disputeStateLabel(state) })),
  { value: "unassigned", label: "Unassigned" },
];

export default async function AdminDisputesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const params = await searchParams;
  const active = filterFrom(first(params["state"]));
  const openCaseId = first(params["case"]);

  const list = await listDisputes(ctx, actor, {
    ...(active === "all" || active === "unassigned" ? {} : { state: active }),
    ...(active === "unassigned" ? { unassigned: true } : {}),
  });

  // The unassigned count is what the chip shows, and it is a property of the
  // whole queue rather than of the filtered view — so it is read from the same
  // rows when nothing is filtered, and from a second small list when something
  // is. Both are one query; neither is per row.
  const unassigned =
    active === "unassigned"
      ? list.rows.length
      : (await listDisputes(ctx, actor, { unassigned: true })).rows.length;

  const query = new URLSearchParams();
  if (active !== "all") query.set("state", active);

  // A case that has been removed, or an id somebody typed, closes the drawer
  // rather than failing the page: the queue behind it is still useful.
  const detail = openCaseId
    ? await getDispute(ctx, actor, openCaseId).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      })
    : null;

  return (
    <AdminPage
      title="Disputes"
      blurb="Complaints about a booking. Investigate one, keep the case notes with it, and close it — which also frees a booking that was held on it."
      actions={<OpenCaseDialog />}
      toolbar={
        <DisputeFilters
          active={active}
          choices={FILTER_CHOICES}
          counts={list.counts}
          total={list.total}
          unassigned={unassigned}
        />
      }
    >
      {list.rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          blurb={
            active === "all"
              ? "Complaints appear here when a customer raises one, or when an administrator records one that arrived another way."
              : "No case matches this filter. Clear it to see the whole queue."
          }
        />
      ) : (
        <GlassPanel as="section" className="overflow-hidden" aria-label="Complaints">
          <ul className="m-0 list-none p-0">
            {list.rows.map((dispute) => (
              <DisputeRow key={dispute.id} dispute={dispute} query={query.toString()} />
            ))}
          </ul>
        </GlassPanel>
      )}

      {detail ? (
        <DisputeDrawer title={detail.dispute.reason}>
          <DisputeDetailPanel detail={detail} meId={actor.userId} />
        </DisputeDrawer>
      ) : null}
    </AdminPage>
  );
}
