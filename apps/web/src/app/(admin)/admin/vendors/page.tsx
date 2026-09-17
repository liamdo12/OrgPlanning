import { vendors } from "@occasion/db/schema";
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
 * lands, this reads from it and the table below becomes the real screen.
 */
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
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Vendors</h1>
      <p className="mt-3 text-sm opacity-70">{rows.length} businesses.</p>

      <table className="mt-8 w-full text-left text-sm">
        <thead className="border-b border-black/10 text-xs uppercase tracking-wide opacity-60">
          <tr>
            <th scope="col" className="py-2">
              Name
            </th>
            <th scope="col" className="py-2">
              Area
            </th>
            <th scope="col" className="py-2">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-black/5">
              <td className="py-2">{row.name}</td>
              <td className="py-2 opacity-70">{row.baseArea ?? "—"}</td>
              <td className="py-2 capitalize opacity-70">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
