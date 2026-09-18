import Link from "next/link";
import { StatusBadge, type Column } from "@occasion/ui";
import type { AdminOrderListItem } from "@occasion/core";
import { toneFor } from "./state-tone";

/**
 * One column spec, two layouts.
 *
 * The widths and the headers are the prototype's, line 1798:
 * `0.8fr 1.5fr 0.8fr 1fr 0.9fr` over Order · Vendor / event · Total · Payment ·
 * State. `DataTable` assembles the phone's cards from the `mobile` slots, which
 * is why the card at line 1813 does not need writing twice — the reference and
 * the state share the top line, the vendor and event are the paragraph, and the
 * total and payment sit in the footer strip.
 *
 * The reference is a link rather than the row being clickable. A whole row that
 * navigates is the prototype's own shape, but the drawer is a query parameter
 * here — which makes the record linkable and server-rendered behind the same
 * gate as the list — and a `<Link>` is what lets somebody open one in a new tab.
 */
export function orderColumns(query: string): Array<Column<AdminOrderListItem>> {
  const href = (row: AdminOrderListItem) =>
    query ? `/admin/orders?${query}&order=${row.id}` : `/admin/orders?order=${row.id}`;

  return [
    {
      key: "reference",
      header: "Order",
      width: "0.8fr",
      mobile: "title",
      render: (row) => (
        <Link href={href(row)} scroll={false} className="font-bold">
          {row.reference}
        </Link>
      ),
    },
    {
      key: "who",
      header: "Vendor / event",
      width: "1.5fr",
      mobile: "body",
      render: (row) => <span className="block truncate">{row.who}</span>,
    },
    {
      key: "total",
      header: "Total",
      width: "0.8fr",
      mobile: "meta",
      render: (row) => <span className="font-bold">{row.total}</span>,
    },
    {
      key: "payment",
      header: "Payment",
      width: "1fr",
      mobile: "meta",
      render: (row) => <span className="text-ink">{row.payment.label}</span>,
    },
    {
      key: "state",
      header: "State",
      width: "0.9fr",
      mobile: "badge",
      render: (row) => <StatusBadge tone={toneFor(row.state)}>{row.stateLabel}</StatusBadge>,
    },
  ];
}
