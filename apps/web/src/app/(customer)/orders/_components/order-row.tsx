import Link from "next/link";
import { ListRow, StatusBadge, Swatch } from "@occasion/ui";
import { formatMoney, orderStateLabel, type CustomerOrderRow } from "@occasion/core";
import { toneFor } from "../../../../lib/order-state-tone";
import { formatCalendarDay } from "../../../../lib/format-moment";

/**
 * One booking, lines 1210–1219.
 *
 * `ListRow` with a `Swatch` in front, a badge and a link behind — the shape the
 * planner's slots and six admin lists already compose. The canvas draws a bare
 * coloured square; the swatch is the same square with the business's initials
 * in it, which is what makes the row readable when four of them are stacked.
 *
 * **The badge comes from the shared mapping**, so this screen and the admin
 * queue cannot end up calling the same state two different things — and the
 * spelling comes from the domain for the same reason.
 *
 * Every amount is formatted by the one formatter. Nothing here multiplies.
 */
export function OrderRow({ order }: { order: CustomerOrderRow }) {
  return (
    <ListRow
      leading={<Swatch name={order.vendorName} size={42} />}
      title={order.vendorName}
      subtitle={detail(order)}
      trailing={
        <>
          <span className="text-[14.5px] font-bold whitespace-nowrap">
            {formatMoney(order.total, order.currency)}
          </span>
          <StatusBadge tone={toneFor(order.state)}>{orderStateLabel(order.state)}</StatusBadge>
          <Link
            href={`/orders/${order.id}`}
            aria-label={`View ${order.reference} with ${order.vendorName}`}
            className="oc-button oc-button--ghost oc-button--sm"
          >
            View
          </Link>
        </>
      }
    />
  );
}

/** What the row says under the business's name. Facts only, in one line. */
function detail(order: CustomerOrderRow): string {
  return [
    order.summary,
    order.itemCount > 1 ? `and ${order.itemCount - 1} more` : null,
    order.eventName,
    order.eventDate ? formatCalendarDay(order.eventDate) : null,
    order.reference,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}
