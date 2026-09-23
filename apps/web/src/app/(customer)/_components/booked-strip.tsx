import Link from "next/link";
import { Swatch } from "@occasion/ui";
import type { CustomerOrderRow } from "@occasion/core";

/**
 * The booked-services strip, line 465.
 *
 * Three real bookings, from one bounded read. It arrives with the customer
 * order read it needs rather than earlier: a strip filled with anything else
 * would be three rows of fiction in the chrome of every screen.
 *
 * Not drawn at all when there is nothing booked. An empty strip in the header
 * of every page is a permanent reminder of an absence, and the shell already
 * has an Orders control that says where bookings live.
 *
 * Scrolls sideways rather than wrapping, so the header keeps its height on a
 * phone. Its own labelled region, so it is skippable rather than three
 * unexplained links between the tabs and the page.
 */
export function BookedStrip({ orders }: { orders: readonly CustomerOrderRow[] }) {
  if (orders.length === 0) return null;

  return (
    <nav
      aria-label="Your recent bookings"
      className="mx-auto flex max-w-[1240px] gap-[8px] overflow-x-auto px-[clamp(14px,3.5vw,32px)] pb-[8px]"
    >
      {orders.map((order) => (
        <Link
          key={order.id}
          href={`/orders/${order.id}`}
          className="oc-chip flex flex-none items-center gap-[8px] no-underline"
        >
          <Swatch name={order.vendorName} size={22} />
          <span className="truncate text-[13px] font-semibold">{order.vendorName}</span>
        </Link>
      ))}
    </nav>
  );
}
