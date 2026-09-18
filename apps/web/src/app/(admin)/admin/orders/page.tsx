import Link from "next/link";
import { DataTable, EmptyState } from "@occasion/ui";
import {
  NotFoundError,
  ORDER_STATES,
  getOrderDetail,
  listOrderVendors,
  listOrdersForAdmin,
  orderStateLabel,
  type PaymentFilter,
} from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { OrderFilters, type Choice } from "./_components/order-filters";
import { orderColumns } from "./_components/order-columns";
import { OrderDrawer } from "./_components/order-drawer";
import { OrderDetailPanel } from "./_components/order-detail";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Orders and payments · Occasion admin" };

/**
 * Every order on the platform.
 *
 * The prototype's `a_orders` screen (lines 1796–1827): five columns above
 * 860px, the same rows as cards below it, both from one column spec. The
 * filters, the search, the pagination and the record drawer are additions,
 * recorded in `docs/design-gaps.md` — the prototype draws six fixed rows and
 * nothing to do with them.
 *
 * Which record is open is a query parameter rather than client state, so it is
 * server-rendered behind the same gate as the list and can be linked to. That
 * matters more here than on the account screen: the record carries payment
 * intent ids and transfer ids, and nothing on this page fetches on its own.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The chips: every state, plus an "all" that clears the filter. */
const STATE_CHOICES: readonly Choice[] = [
  { value: "", label: "All orders" },
  ...ORDER_STATES.map((state) => ({ value: state, label: orderStateLabel(state) })),
];

const PAYMENT_CHOICES: readonly Choice[] = [
  { value: "", label: "Any payment" },
  { value: "unpaid", label: "Awaiting payment" },
  { value: "deposit", label: "Deposit paid" },
  { value: "paid", label: "Paid in full" },
  { value: "balance-failed", label: "Balance failed" },
  { value: "refunded", label: "Refunded" },
] satisfies ReadonlyArray<Choice & { value: "" | PaymentFilter }>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const params = await searchParams;
  const values = {
    state: first(params["state"]),
    payment: first(params["payment"]),
    vendorId: first(params["vendorId"]),
    from: first(params["from"]),
    to: first(params["to"]),
    search: first(params["q"]),
  };
  const cursor = first(params["cursor"]);
  const openOrderId = first(params["order"]);

  const [list, vendors] = await Promise.all([
    listOrdersForAdmin(ctx, actor, {
      ...values,
      ...(cursor ? { cursor } : {}),
    }),
    listOrderVendors(ctx, actor),
  ]);

  // Carried onto every row's link so opening a record does not silently reset
  // the filters somebody was working under.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...values, q: values.search })) {
    if (key !== "search" && value) query.set(key, value);
  }

  // An order that has been removed, or an id somebody typed, closes the drawer
  // rather than failing the page: the list behind it is still useful.
  const detail = openOrderId
    ? await getOrderDetail(ctx, actor, openOrderId).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      })
    : null;

  const nextQuery = new URLSearchParams(query.toString());
  if (list.nextCursor) nextQuery.set("cursor", list.nextCursor);

  const filtered = Object.values(values).some(Boolean);

  return (
    <AdminPage
      title="Orders and payments"
      blurb="Every order on the platform, what has been paid, and what the platform and each vendor earned from it."
      toolbar={
        <OrderFilters
          values={values}
          states={STATE_CHOICES}
          payments={PAYMENT_CHOICES}
          vendors={[
            { value: "", label: "Any vendor" },
            ...vendors.map((vendor) => ({ value: vendor.id, label: vendor.name })),
          ]}
        />
      }
    >
      {/* Plain text, not a live region: this is the heading of a page that has
          just been rendered, and `loading.tsx` already announces the wait. Two
          things claiming `role="status"` on one navigation talk over each
          other. */}
      <p className="mt-0 mb-4 text-row text-body">
        {list.total} {list.total === 1 ? "order" : "orders"}
        {filtered ? " matching these filters" : ""}
      </p>

      <DataTable
        caption="Orders"
        columns={orderColumns(query.toString())}
        rows={list.rows}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            title="Nothing here"
            blurb={
              filtered
                ? "No order matches these filters. Clear them to see everything."
                : "No orders have been placed yet."
            }
          />
        }
      />

      {list.nextCursor ? (
        <div className="mt-4 flex justify-center">
          <Link
            href={`/admin/orders?${nextQuery.toString()}`}
            className="oc-button oc-button--secondary oc-button--md"
          >
            Next 25
          </Link>
        </div>
      ) : null}

      {detail ? (
        <OrderDrawer title={detail.order.reference}>
          <OrderDetailPanel detail={detail} />
        </OrderDrawer>
      ) : null}
    </AdminPage>
  );
}
