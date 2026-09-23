import Link from "next/link";
import { notFound } from "next/navigation";
import {
  NotFoundError,
  formatMoney,
  getOrderForCustomer,
  orderStateLabel,
  type CustomerOrderDetail,
} from "@occasion/core";
import { GlassPanel, PageHeader, StatusBadge } from "@occasion/ui";
import { requireCustomerPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { formatCalendarDay, formatDay, formatMoment } from "../../../../lib/format-moment";
import { toneFor } from "../../../../lib/order-state-tone";
import { CancelDialog } from "../_components/cancel-dialog";

export const metadata = { title: "Your booking · Occasion" };

export const dynamic = "force-dynamic";

/**
 * One booking, lines 1189–1203 of the canvas's confirmation, read back.
 *
 * **Keyed on the order id, never on the reference.** A reference is a
 * `nextval` on a sequence, so a route keyed on one is a route somebody can walk
 * — and it would be invisible to the mechanical gate that checks every
 * id-taking export has an authorization row, because `reference` is not an id
 * that regex knows.
 *
 * Another customer's booking answers exactly what a missing one answers. That
 * is the domain's refusal rather than this page's, and it is the same answer
 * either way so the URL cannot be used to find out which bookings exist.
 */
export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
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

  return (
    <>
      <PageHeader
        title={order.vendorName}
        actions={
          <>
            <StatusBadge tone={toneFor(order.state)}>{orderStateLabel(order.state)}</StatusBadge>
            <a
              href={`/orders/${order.id}/calendar`}
              className="oc-button oc-button--secondary oc-button--md no-underline"
            >
              Add to calendar
            </a>
          </>
        }
      />

      <p className="mt-0 mb-[22px] text-[15px] text-pretty text-body">
        {[
          order.reference,
          order.eventName,
          order.eventDate ? formatCalendarDay(order.eventDate) : null,
          order.policyName ? `${order.policyName} policy` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-[18px]">
        <Booked detail={detail} />
        <Money detail={detail} />
      </div>

      <Agreement detail={detail} />
      <Cancellation detail={detail} />
    </>
  );
}

/** What was bought, at the prices it was bought at. */
function Booked({ detail }: { detail: CustomerOrderDetail }) {
  return (
    <GlassPanel as="section" aria-labelledby="booked-heading" className="rounded-overlay p-5">
      <h2 id="booked-heading" className="m-0 mb-[14px] text-subhead">
        What you booked
      </h2>

      <dl className="m-0">
        {detail.items.map((item) => (
          <Line
            key={item.id}
            label={item.quantity > 1 ? `${item.description} × ${item.quantity}` : item.description}
            value={formatMoney(item.lineTotal, item.currency)}
          />
        ))}
        <Line label="Subtotal" value={formatMoney(detail.order.subtotal, detail.order.currency)} />
        <Line label="Tax" value={formatMoney(detail.order.tax, detail.order.currency)} />
        <Line
          label="Total"
          value={formatMoney(detail.order.total, detail.order.currency)}
          strong
        />
      </dl>
    </GlassPanel>
  );
}

/** What has moved, and what is still to. */
function Money({ detail }: { detail: CustomerOrderDetail }) {
  const { order, money } = detail;

  return (
    <GlassPanel as="section" aria-labelledby="money-heading" className="rounded-overlay p-5">
      <h2 id="money-heading" className="m-0 mb-[14px] text-subhead">
        Payments
      </h2>

      <dl className="m-0">
        {money.payments.map((payment) => (
          <Line
            key={payment.id}
            label={paymentLabel(payment.kind, payment.state, payment.cardLast4)}
            value={formatMoney(payment.amount, payment.currency)}
          />
        ))}

        {money.refunds.map((refund) => (
          <Line
            key={refund.id}
            label={refund.state === "requested" ? "Refund on its way" : "Refunded"}
            value={formatMoney(refund.amount, refund.currency)}
          />
        ))}

        {money.payments.length === 0 && money.refunds.length === 0 ? (
          <Line label="Nothing taken yet" value={formatMoney(0n, order.currency)} />
        ) : null}

        <Line label="Held now" value={formatMoney(money.captured, order.currency)} strong />

        {order.balanceAmount > 0n && order.balanceDueAt ? (
          <Line
            label={`Balance on ${formatDay(order.balanceDueAt)}`}
            value={formatMoney(order.balanceAmount, order.currency)}
          />
        ) : null}
      </dl>
    </GlassPanel>
  );
}

/** What the customer agreed to, as they were shown it. */
function Agreement({ detail }: { detail: CustomerOrderDetail }) {
  const { order } = detail;
  if (!order.agreement) return null;

  const agreed = order.agreement;

  return (
    <GlassPanel as="section" aria-labelledby="agreed-heading" className="mt-[18px] rounded-overlay p-5">
      <h2 id="agreed-heading" className="m-0 mb-[10px] text-subhead">
        What you agreed to
      </h2>

      <p className="m-0 text-[14px] text-pretty text-body">
        On {formatMoment(agreed.at)} you authorised a total of{" "}
        {formatMoney(agreed.total, order.currency)}, with{" "}
        {formatMoney(agreed.depositAmount, order.currency)} taken at checkout
        {agreed.balanceAmount > 0n && agreed.balanceDueAt
          ? ` and ${formatMoney(agreed.balanceAmount, order.currency)} on ${formatDay(agreed.balanceDueAt)}`
          : " and no balance to follow"}
        .
      </p>
    </GlassPanel>
  );
}

/** The free window, and the control it makes real. */
function Cancellation({ detail }: { detail: CustomerOrderDetail }) {
  const { order, money, freeCancellation } = detail;

  return (
    <GlassPanel
      as="section"
      aria-labelledby="cancel-heading"
      className="mt-[18px] flex flex-wrap items-center justify-between gap-4 rounded-overlay p-5"
    >
      <div>
        <h2 id="cancel-heading" className="m-0 mb-1 text-[16.5px]">
          Cancelling
        </h2>
        <p className="m-0 max-w-[52ch] text-row text-pretty text-body">
          {freeCancellation.open && freeCancellation.endsAt
            ? `Free until ${formatMoment(freeCancellation.endsAt)}. Everything taken so far goes back to the card it came from.`
            : order.policyName
              ? `The free window has closed, so ${order.policyName.toLowerCase()} terms now apply. Ask us and we will work out what is refundable.`
              : "The free window has closed. Ask us and we will work out what is refundable."}
        </p>
      </div>

      {freeCancellation.open && freeCancellation.endsAt ? (
        <CancelDialog
          orderId={order.id}
          reference={order.reference}
          vendorName={order.vendorName}
          refundAmount={formatMoney(money.captured, order.currency)}
          freeUntil={formatMoment(freeCancellation.endsAt)}
        />
      ) : (
        <Link href="/orders" className="oc-button oc-button--secondary oc-button--md">
          Back to your orders
        </Link>
      )}
    </GlassPanel>
  );
}

/** "Deposit · •••• 4242", or what the payment is actually doing. */
function paymentLabel(kind: string, state: string, cardLast4: string | null): string {
  const what = kind === "full" ? "Paid in full" : kind === "balance" ? "Balance" : "Deposit";
  const how =
    state === "pending"
      ? "not taken yet"
      : state === "failed"
        ? "did not go through"
        : state === "refunded"
          ? "refunded"
          : cardLast4
            ? `•••• ${cardLast4}`
            : "paid";

  return `${what} · ${how}`;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="mb-[7px] flex flex-wrap justify-between gap-3 text-[14px]">
      <dt className={strong ? "font-bold" : "text-body"}>{label}</dt>
      <dd className={`m-0 whitespace-nowrap ${strong ? "font-bold" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}
