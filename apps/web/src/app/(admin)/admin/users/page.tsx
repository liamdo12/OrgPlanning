import Link from "next/link";
import { EmptyState, GlassPanel, ListStack } from "@occasion/ui";
import { NotFoundError, getUserDetail, listUsersForAdmin, type UserFilter } from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { ClearSecondFactorForm } from "../../_components/clear-second-factor-form";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { entityIdOr } from "../../../../lib/entity-id";
import { createRequestContext } from "../../../../lib/core";
import { UserFilters, type FilterChoice } from "./_components/user-filters";
import { UserRow } from "./_components/user-row";
import { UserDrawer } from "./_components/user-drawer";
import { UserDetailPanel } from "./_components/user-detail";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Users · Occasion admin" };

/**
 * Every account on the platform.
 *
 * Customers who book and the people behind each vendor, in one list, because
 * that is what the prototype shows (line 1663) and because a support question
 * does not arrive labelled with which kind of account it is about.
 *
 * Which record is open is a query parameter rather than client state, so it is
 * server-rendered behind the same gate as the list and can be linked to.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTERS: readonly UserFilter[] = ["all", "customers", "vendor-staff", "suspended"];

/** Source: the chips at line 2624, in the prototype's order and wording. */
const FILTER_CHOICES: readonly FilterChoice[] = [
  { value: "all", label: "All accounts" },
  { value: "customers", label: "Customers" },
  { value: "vendor-staff", label: "Vendor staff" },
  { value: "suspended", label: "Suspended" },
];

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * The filter from the URL.
 *
 * An unknown value falls back to every account rather than refusing. This is a
 * query parameter somebody may have edited, or a link that outlived a rename,
 * and an error page is a worse answer than the whole list.
 */
function filterFrom(value: string): UserFilter {
  return FILTERS.find((filter) => filter === value) ?? "all";
}

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const params = await searchParams;
  const filter = filterFrom(first(params["filter"]));
  const search = first(params["q"]);
  const cursor = first(params["cursor"]);
  // Narrowed to a uuid first: Postgres refuses a malformed one with a driver
  // error rather than "no such row", which the catch below cannot recognise.
  const openUserId = entityIdOr(first(params["user"]));

  const list = await listUsersForAdmin(ctx, actor, {
    filter,
    ...(search ? { search } : {}),
    ...(cursor ? { cursor } : {}),
  });

  // Carried onto every row's link so opening a record does not silently reset
  // the filter the person was working under.
  const query = new URLSearchParams();
  if (filter !== "all") query.set("filter", filter);
  if (search) query.set("q", search);

  // A record that has been removed, or an id somebody typed, closes the drawer
  // rather than failing the page: the list behind it is still useful.
  const detail = openUserId
    ? await getUserDetail(ctx, actor, openUserId).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      })
    : null;

  const nextQuery = new URLSearchParams(query.toString());
  if (list.nextCursor) nextQuery.set("cursor", list.nextCursor);

  return (
    <AdminPage
      title="Users"
      blurb="Every account on the platform: customers who book, and the people behind each vendor."
      actions={
        // Line 1662: the prototype's own header button.
        <Link href="/admin/email" className="oc-button oc-button--primary oc-button--md">
          Email users
        </Link>
      }
      toolbar={<UserFilters filter={filter} search={search} choices={FILTER_CHOICES} />}
    >
      {/* Plain text, not a live region: this is the heading of a page that has
          just been rendered, and `loading.tsx` already announces the wait. Two
          things claiming `role="status"` on one navigation talk over each
          other. */}
      <p className="mt-0 mb-4 text-row text-body">
        {list.total} {list.total === 1 ? "account" : "accounts"}
        {filter === "all" && !search ? "" : " matching this filter"}
      </p>

      {list.rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          blurb="No account matches this filter. Clear it to see everyone."
        />
      ) : (
        <ListStack as="ul" className="m-0 list-none p-0">
          {list.rows.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              query={query.toString()}
              isSelf={user.id === actor.userId}
            />
          ))}
        </ListStack>
      )}

      {list.nextCursor ? (
        <div className="mt-4 flex justify-center">
          <Link
            href={`/admin/users?${nextQuery.toString()}`}
            className="oc-button oc-button--secondary oc-button--md"
          >
            Next 25
          </Link>
        </div>
      ) : null}

      <GlassPanel as="section" className="mt-8 p-6">
        <h2 className="m-0 text-[17px] font-bold">Account recovery</h2>
        <p className="mt-1 mb-0 max-w-[66ch] text-row text-body">
          Clears two-step verification for someone who has lost their authenticator, and ends their
          sessions. Confirm who they are first.
        </p>
        <ClearSecondFactorForm />
      </GlassPanel>

      {detail ? (
        <UserDrawer title={detail.user.fullName}>
          <UserDetailPanel detail={detail} isSelf={detail.user.id === actor.userId} />
        </UserDrawer>
      ) : null}
    </AdminPage>
  );
}
