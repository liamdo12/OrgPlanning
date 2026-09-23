import Link from "next/link";
import { notFound } from "next/navigation";
import {
  NotFoundError,
  formatMoney,
  getOrderForCustomer,
  orderStateLabel,
  type CustomerOrderDetail,
} from "@occasion/core";
import { GlassPanel } from "@occasion/ui";
import { requireCustomerPage } from "../../../../../lib/auth-guard";
import { createRequestContext } from "../../../../../lib/core";
import { formatCalendarDay, formatDay, formatMoment } from "../../../../../lib/format-moment";

export const metadata = { title: "Booking confirmed · Occasion" };

/** Rendered per request: the whole point is to report what is true now. */
export const dynamic = "force-dynamic";

/**
 * The confirmation, lines 1224–1245.
 *
 * **It reports the order's state, never the browser's result.** A successful
 * card confirmation means the provider accepted the card; the booking is
 * confirmed by the webhook that follows, which can be a second or two behind
 * and occasionally longer. So this reads the row: if the webhook has not landed
 * yet the screen says the payment is going through and the page is worth
 * refreshing, and it never claims a booking that does not exist yet.
 *
 * Keyed on the order id, like every other route here.
 */
export default async function ConfirmedPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const actor = await requireCustomerPage();
  const ctx = createRequestContext();
  const { orderId } = await params;

  let detail;
  try {
    detail = await getOrderForCustomer(ctx, actor, orderId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { order } = detail;
  const settled = order.state !== "pending_payment";

  return (
    <section className="max-w-[640px]" aria-labelledby="confirmed-heading">
      <span
        aria-hidden="true"
        className={`mb-[18px] grid h-[56px] w-[56px] place-items-center rounded-full text-[25px] ${
          settled ? "bg-status-success-bg text-status-success-fg" : "bg-glass-wash text-body"
        }`}
      >
        {settled ? "✓" : "…"}
      </span>

      <h1
        id="confirmed-heading"
        className="m-0 mb-[8px] font-display text-[clamp(27px,4vw,40px)] leading-[1.08] font-normal"
      >
        {settled ? `${order.vendorName} is booked.` : `Paying ${order.vendorName}…`}
      </h1>

      <p className="mt-0 mb-[22px] text-[15px] text-pretty text-body">
        {settled
          ? summary(detail)
          : "Your card has been accepted and we are waiting for the payment to settle. Nothing else is needed from you — refresh this page in a moment and it will say so."}
      </p>

      <GlassPanel as="div" className="mb-[18px] rounded-overlay p-5">
        <Row label="Order" value={order.reference} />
        <Row label="Booking" value={orderStateLabel(order.state)} />
        <Row label="Business" value={order.vendorName} />
        {order.eventName ? <Row label="Event" value={order.eventName} /> : null}
        {order.eventDate ? (
          <Row label="Date" value={formatCalendarDay(order.eventDate)} />
        ) : null}
        <Row
          label="Paid so far"
          value={formatMoney(detail.money.captured, order.currency)}
        />
        {order.balanceAmount > 0n && order.balanceDueAt ? (
          <Row
            label={`Balance on ${formatDay(order.balanceDueAt)}`}
            value={formatMoney(order.balanceAmount, order.currency)}
          />
        ) : null}
      </GlassPanel>

      <div className="flex flex-wrap gap-[10px]">
        {order.eventId ? (
          <Link
            href={`/events/${order.eventId}`}
            className="oc-button oc-button--primary oc-button--md"
          >
            Back to event hub
          </Link>
        ) : null}

        <a
          href={`/orders/${order.id}/calendar`}
          className="oc-button oc-button--secondary oc-button--md no-underline"
        >
          Add to calendar
        </a>

        <Link href={`/orders/${order.id}`} className="oc-button oc-button--ghost oc-button--md">
          See the booking
        </Link>
      </div>
    </section>
  );
}

/** Line 1228: what was paid, and until when it can be undone for nothing. */
function summary(detail: CustomerOrderDetail): string {
  const { order, money, freeCancellation } = detail;
  const paid = `${formatMoney(money.captured, order.currency)} paid.`;

  return freeCancellation.open && freeCancellation.endsAt
    ? `${paid} You can cancel free of charge until ${formatMoment(freeCancellation.endsAt)}. Order ${order.reference}.`
    : `${paid} Order ${order.reference}.`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="m-0 flex justify-between gap-[14px] border-b border-hairline py-[9px] text-[14px] last:border-b-0">
      <span className="text-body">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </p>
  );
}
