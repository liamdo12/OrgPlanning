import { EmptyState, GlassPanel } from "@occasion/ui";
import {
  NotFoundError,
  VENDOR_STATUSES,
  getVendorDetail,
  listVendorsForAdmin,
  type VendorStatus,
} from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { VendorFilters, type FilterChoice } from "./_components/vendor-filters";
import { VendorRow } from "./_components/vendor-row";
import { VendorDrawer } from "./_components/vendor-drawer";
import { VendorDetailPanel } from "./_components/vendor-detail";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Vendors · Occasion admin" };

/**
 * The vendor approval queue.
 *
 * Every business on the platform, not the six the prototype draws: nothing in
 * the schema separates "in the queue" from "in the catalogue", and an approval
 * queue that hides businesses is not one. The states the prototype shows are
 * intact — two applications waiting and one refused — and the divergence is
 * recorded in `docs/design-gaps.md`.
 *
 * Which vendor's record is open is a query parameter rather than client state,
 * so the record is server-rendered behind the same gate as the list and can be
 * linked to.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * The status filter from the URL.
 *
 * A value that is not a status is treated as no filter rather than refused.
 * This is a query parameter somebody may have edited or a link that outlived a
 * rename, and answering an error page for it would be a worse outcome than
 * showing the whole queue.
 */
function statusFrom(value: string): VendorStatus | "all" {
  return VENDOR_STATUSES.find((status) => status === value) ?? "all";
}

/** The chips, built here so the client component needs no runtime domain import. */
const FILTER_CHOICES: readonly FilterChoice[] = [
  { value: "all", label: "All" },
  ...VENDOR_STATUSES.map((status) => ({
    value: status,
    label: status[0]!.toUpperCase() + status.slice(1),
  })),
];

export default async function AdminVendorsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const params = await searchParams;
  const status = statusFrom(first(params["status"]));
  const search = first(params["q"]);
  const openVendorId = first(params["vendor"]);

  const list = await listVendorsForAdmin(ctx, actor, {
    ...(status === "all" ? {} : { status }),
    ...(search ? { search } : {}),
  });

  // Carried onto every row's link so opening a record does not silently reset
  // the filter the person was working under.
  const query = new URLSearchParams();
  if (status !== "all") query.set("status", status);
  if (search) query.set("q", search);

  // A record that has been removed, or an id somebody typed, closes the drawer
  // rather than failing the page: the list behind it is still useful.
  const detail = openVendorId
    ? await getVendorDetail(ctx, actor, openVendorId).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      })
    : null;

  return (
    <AdminPage
      title="Vendors"
      blurb="Every business on the platform. Approve the ones waiting, and suspend the ones that have to stop taking work."
      toolbar={
        <VendorFilters
          status={status}
          search={search}
          choices={FILTER_CHOICES}
          counts={list.counts}
          total={list.total}
        />
      }
    >
      {list.rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          blurb={
            search || status !== "all"
              ? "No business matches this filter. Clear it to see the whole queue."
              : "Businesses appear here once they have signed up, whether or not they have finished onboarding."
          }
        />
      ) : (
        <GlassPanel as="section" className="overflow-hidden" aria-label="Vendors">
          <ul className="m-0 list-none p-0">
            {list.rows.map((vendor) => (
              <VendorRow key={vendor.id} vendor={vendor} query={query.toString()} />
            ))}
          </ul>
        </GlassPanel>
      )}

      {detail ? (
        <VendorDrawer title={detail.vendor.name}>
          <VendorDetailPanel detail={detail} />
        </VendorDrawer>
      ) : null}
    </AdminPage>
  );
}
