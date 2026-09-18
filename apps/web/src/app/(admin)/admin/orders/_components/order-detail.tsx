import Link from "next/link";
import { StatusBadge } from "@occasion/ui";
import { formatMoney, orderPayoutAllowed, type AdminOrderDetail } from "@occasion/core";
import { OrderActions } from "./order-actions";
import { toneFor } from "./state-tone";

/**
 * One order's whole record.
 *
 * An addition beyond the prototype, which draws `a_orders` read-only with no
 * row click and no detail view at all — recorded in `docs/design-gaps.md`. It
 * exists because every question an administrator is asked about an order is a
 * question about something the list cannot show: what was booked, where the
 * money went, what is still scheduled, and who decided what.
 *
 * Nine sections, and the order of them is the order somebody reads in: what
 * this is, what can be done about it, what was bought, how the money splits,
 * what has actually moved, what is queued, the terms, who is involved, and the
 * history.
 */

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

function when(value: Date | null | undefined): string {
  return value ? dateFormat.format(value) : "—";
}

/** The reason or resolution recorded on an audit row, when the decision had one. */
function noteOf(after: unknown): string | null {
  if (typeof after !== "object" || after === null) return null;
  const record = after as { reason?: unknown; resolution?: unknown };
  const note = record.resolution ?? record.reason;
  return typeof note === "string" && note.length > 0 ? note : null;
}

export function OrderDetailPanel({ detail }: { detail: AdminOrderDetail }) {
  const { order, money, items, payments, transfers, refunds, jobs, policy, audit } = detail;
  const heldTransfers = transfers.filter((transfer) => transfer.state === "held").length;
  const paused = !orderPayoutAllowed(order.state);

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">{order.who}</span>
            <span className="block text-row text-body">
              {order.payment.label} · placed {when(order.placedAt)}
            </span>
          </span>
          <StatusBadge tone={toneFor(order.state)}>{order.stateLabel}</StatusBadge>
        </div>

        {detail.issueNote ? (
          <p className="m-0 max-w-[60ch] text-[14px] text-pretty text-ink">
            <span className="font-bold">Flagged:</span> {detail.issueNote}
          </p>
        ) : null}

        <OrderActions
          orderId={order.id}
          reference={order.reference}
          available={detail.actions}
          refundAmount={money.netCaptured}
          windowEnds={when(detail.dates.coolingWindowEndsAt)}
          captured={money.netCaptured}
          heldTransfers={heldTransfers}
        />
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Booked ({items.length})</h3>
        {items.length === 0 ? (
          <p className="m-0 text-[14px] text-body">Nothing on this order.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
            {items.map((item) => (
              <li key={item.id}>
                <span className="font-bold">{item.description}</span>
                <span className="text-body">
                  {" "}
                  {/* The price snapshot, not today's catalogue price: the
                      catalogue may change, the receipt may not. */}
                  · {item.quantity} × {formatMoney(item.unitPrice, item.currency)} ={" "}
                  {formatMoney(item.lineTotal, item.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Money</h3>
        {/* The order the checkout summary shows it in, lines 1172–1178, with the
            platform's own split underneath — an administrator needs both what
            the customer paid and what the business is owed. */}
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
          <dt className="text-body">Subtotal</dt>
          <dd className="m-0">{money.subtotal}</dd>
          <dt className="text-body">HST</dt>
          <dd className="m-0">{money.tax}</dd>
          <dt className="text-body">Total</dt>
          <dd className="m-0 font-bold">{money.total}</dd>
          <dt className="text-body">Deposit</dt>
          <dd className="m-0">{money.deposit}</dd>
          <dt className="text-body">Balance</dt>
          <dd className="m-0">{money.balance}</dd>
          <dt className="text-body">Commission</dt>
          <dd className="m-0">
            {money.commission} + {money.commissionTax} HST
          </dd>
          <dt className="text-body">Vendor share</dt>
          <dd className="m-0">{money.vendorShare}</dd>
          <dt className="text-body">Captured</dt>
          <dd className="m-0">{money.netCaptured}</dd>
        </dl>
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Payments ({payments.length})</h3>
        {payments.length === 0 ? (
          <p className="m-0 text-[14px] text-body">Nothing charged yet.</p>
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0 text-[14px]">
            {payments.map((payment) => (
              <li key={payment.id}>
                <span className="font-bold">
                  {payment.kind} · {formatMoney(payment.amount, payment.currency)}
                </span>
                <span className="text-body"> · {payment.state}</span>
                {payment.failureMessage ? (
                  <span className="block text-ink">{payment.failureMessage}</span>
                ) : null}
                <span className="block text-row text-body">
                  {payment.succeededAt ? when(payment.succeededAt) : when(payment.openedAt)}
                  {/* The provider's own id, so a question here can be carried
                      into the Stripe dashboard without guessing which charge. */}
                  {payment.providerPaymentIntentId ? ` · ${payment.providerPaymentIntentId}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Payouts ({transfers.length})</h3>
        {paused ? (
          // The state is on the badge at the top of the record, and one of the
          // labels is an abbreviation ending in a full stop — so this says what
          // is true without spelling the state a second time.
          <p className="m-0 mb-2 max-w-[60ch] text-[14px] text-pretty text-ink">
            Payouts on this order are paused while it stays in its current state.
          </p>
        ) : null}
        {transfers.length === 0 ? (
          <p className="m-0 text-[14px] text-body">Nothing scheduled to the vendor yet.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0 text-[14px]">
            {transfers.map((transfer) => (
              <li key={transfer.id}>
                <span className="font-bold">
                  {transfer.kind.replaceAll("_", " ")} ·{" "}
                  {formatMoney(transfer.amount, transfer.currency)}
                </span>
                <span className="text-body"> · {transfer.state}</span>
                {transfer.heldReason ? (
                  <span className="block text-ink">{transfer.heldReason}</span>
                ) : null}
                {transfer.providerTransferId ? (
                  <span className="block text-row text-body">{transfer.providerTransferId}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Refunds ({refunds.length})</h3>
        {refunds.length === 0 ? (
          <p className="m-0 text-[14px] text-body">Nothing has gone back.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0 text-[14px]">
            {refunds.map((refund) => (
              <li key={refund.id}>
                <span className="font-bold">{formatMoney(refund.amount, refund.currency)}</span>
                <span className="text-body">
                  {" "}
                  · {refund.state.replaceAll("_", " ")}
                  {refund.recordedExternally ? " · recorded from the dashboard" : ""}
                </span>
                {refund.reason ? <span className="block text-ink">{refund.reason}</span> : null}
                <span className="block text-row text-body">
                  {when(refund.settledAt ?? refund.openedAt)}
                  {refund.providerRefundId ? ` · ${refund.providerRefundId}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Scheduled</h3>
        <dl className="m-0 mb-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
          <dt className="text-body">Free cancellation until</dt>
          <dd className="m-0">{when(detail.dates.coolingWindowEndsAt)}</dd>
          <dt className="text-body">Balance due</dt>
          <dd className="m-0">{when(detail.dates.balanceDueAt)}</dd>
          <dt className="text-body">Grace expires</dt>
          <dd className="m-0">{when(detail.dates.graceExpiresAt)}</dd>
          <dt className="text-body">Auto-completes</dt>
          <dd className="m-0">{when(detail.dates.autoCompleteAt)}</dd>
        </dl>
        {jobs.length === 0 ? (
          <p className="m-0 text-[14px] text-body">Nothing queued.</p>
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0 text-[14px]">
            {jobs.map((job) => (
              <li key={job.id}>
                <span className="font-bold">{job.type.replaceAll("_", " ")}</span>
                <span className="text-body">
                  {" "}
                  · {job.status} · {when(job.runAfter)}
                </span>
                {job.heldReason ? <span className="block text-ink">{job.heldReason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Who and under what terms</h3>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
          <dt className="text-body">Customer</dt>
          <dd className="m-0">
            <Link href={`/admin/users?user=${detail.customer.id}`}>{detail.customer.name}</Link>
            <span className="text-body"> · {detail.customer.email}</span>
          </dd>
          <dt className="text-body">Vendor</dt>
          <dd className="m-0">
            <Link href={`/admin/vendors?vendor=${detail.vendor.id}`}>{detail.vendor.name}</Link>
            <span className="text-body">
              {" "}
              · {detail.vendor.status}
              {detail.vendor.payoutsEnabledAt ? " · payouts enabled" : " · payouts not enabled"}
            </span>
          </dd>
          <dt className="text-body">Event</dt>
          <dd className="m-0">
            {detail.event
              ? `${detail.event.name} · ${dayFormat.format(new Date(detail.event.date))}`
              : "—"}
          </dd>
          <dt className="text-body">Policy</dt>
          <dd className="m-0">
            {policy
              ? `${policy.name} · ${policy.depositBps / 100}% deposit · free for ${policy.freeCancellationHours}h`
              : "None recorded"}
          </dd>
          <dt className="text-body">Dates held</dt>
          <dd className="m-0">
            {detail.capacity.filter((block) => block.active).length} of {detail.capacity.length}{" "}
            still held
          </dd>
        </dl>
        {policy ? (
          <p className="mt-2 mb-0 max-w-[60ch] text-row text-pretty text-body">{policy.summary}</p>
        ) : null}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">History</h3>
        {audit.length === 0 ? (
          <p className="m-0 text-[14px] text-body">Nothing recorded against this order.</p>
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0 text-[14px]">
            {audit.map((entry) => (
              <li key={entry.id}>
                <span className="font-bold">{entry.action.replace("order.", "")}</span>{" "}
                <span className="text-body">
                  {/* The role as well as the person: once somebody can hold more
                      than one, "who did this" is not answerable by the account
                      alone. */}
                  by {entry.actorEmail ?? "the system"}
                  {entry.actingRole ? ` as ${entry.actingRole}` : ""}
                </span>
                {noteOf(entry.after) ? (
                  <span className="block text-ink">{noteOf(entry.after)}</span>
                ) : null}
                <span className="block text-row text-body">{when(entry.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
