import { vendors } from "@occasion/db/schema";
import { DataTable, EmptyState, PageHeader, StatusBadge, type Column } from "@occasion/ui";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Vendors · Occasion admin" };

/**
 * Every vendor on the platform.
 *
 * A list, not a row lookup, so the role gate is the whole authorization story
 * here — there is no entity id for an object policy to be asked about. The
 * moment this page grows a "view vendor" link, that page takes the actor as its
 * first argument and calls `assertCanReadVendorPrivately`.
 *
 * The query is inline because the vendor service does not exist yet. When it
 * lands, this reads from it and the columns below stay as they are.
 */

type VendorRow = {
  id: string;
  name: string;
  status: string;
  baseArea: string | null;
};

/**
 * `approved` is the only settled state, `blocked` the only bad one, and
 * `pending` is work waiting for somebody — which is why it is the warm tone
 * rather than the neutral one.
 */
function toneFor(status: string) {
  if (status === "approved") return "success" as const;
  if (status === "blocked" || status === "suspended") return "danger" as const;
  if (status === "pending") return "warn" as const;
  return "neutral" as const;
}

const COLUMNS: ReadonlyArray<Column<VendorRow>> = [
  {
    key: "name",
    header: "Business",
    width: "1.4fr",
    mobile: "title",
    render: (row) => <span className="font-bold">{row.name}</span>,
  },
  {
    key: "area",
    header: "Area",
    width: "1fr",
    mobile: "body",
    render: (row) => <span className="text-body">{row.baseArea ?? "—"}</span>,
  },
  {
    key: "status",
    header: "Status",
    width: "0.8fr",
    mobile: "badge",
    render: (row) => (
      <StatusBadge tone={toneFor(row.status)}>
        <span className="capitalize">{row.status}</span>
      </StatusBadge>
    ),
  },
];

export default async function AdminVendorsPage() {
  await requireAdminActor();

  const ctx = createRequestContext();
  const rows = await ctx.db
    .select({
      id: vendors.id,
      name: vendors.name,
      status: vendors.status,
      baseArea: vendors.baseArea,
    })
    .from(vendors);

  // Ordered here because `drizzle-orm` is not resolvable from this package —
  // only the schema is. The real screen orders in the query it replaces this
  // with.
  rows.sort((left, right) => left.name.localeCompare(right.name));

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <PageHeader
        title="Vendors"
        blurb={`${rows.length} ${rows.length === 1 ? "business" : "businesses"} on the platform.`}
      />

      <DataTable
        caption="Vendors"
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            title="No vendors yet"
            blurb="Businesses appear here once they have signed up, whether or not they have finished onboarding."
          />
        }
      />
    </main>
  );
}
