import Link from "next/link";
import { notFound } from "next/navigation";
import {
  NotFoundError,
  ValidationError,
  formatMoney,
  eventHub,
  quoteCheckout,
  type QuotedOrder,
} from "@occasion/core";
import { EmptyState, PageHeader, Toast } from "@occasion/ui";
import { requireCustomerPage } from "../../../lib/auth-guard";
import { createRequestContext } from "../../../lib/core";
import { getEnv } from "../../../lib/env";
import { formatDay } from "../../../lib/format-moment";
import { CheckoutPayment } from "./_components/payment-element";
import { linesForVendor } from "./plan-lines";

export const metadata = { title: "Confirm and pay · Occasion" };

/** Rendered per request: the price and the date are both live. */
export const dynamic = "force-dynamic";

/**
 * Confirm and pay, lines 1142–1185.
 *
 * **One business.** `createCheckout` opens an order per vendor and
 * `chargeDeposit` takes one order and returns one client secret, so a
 * multi-vendor cart is several bookings, several agreements and several cards
 * taken — a screen nothing has designed. The canvas agrees: it draws exactly
 * one vendor at line 1148. The planner's row and its panel each start one.
 *
 * **What is being bought comes from the plan, not from the URL.** The query
 * names an event and a business; the lines are read back out of the event's own
 * slots. A query that could name a service could name one that was never
 * planned, and one that could name a quantity could name six of something
 * priced for one.
 *
 * **Every figure comes from `quoteCheckout`**, which runs the checkout's own
 * pricing against the same rows. Nothing here multiplies, applies a rate or
 * rounds — and what this screen displays is sent back with the payment as an
 * expectation, so a rate saved between the render and the button aborts rather
 * than charging an amount nobody saw.
 *
 * The publishable key is read here, on the server, and passed down as a prop.
 * A `NEXT_PUBLIC_` variable inlines at build time and this app's image is built
 * with no environment at all, so the deployed screen would have no card field
 * while development and CI both looked healthy.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireCustomerPage();
  const ctx = createRequestContext();

  const query = await searchParams;
  const eventId = single(query["event"]);
  const vendorId = single(query["vendor"]);

  if (!eventId || !vendorId) notFound();

  let hub;
  try {
    hub = await eventHub(ctx, actor, eventId);
  } catch (error) {
    // Somebody else's event answers exactly what a missing one answers, which
    // is the domain's refusal rather than this page's.
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const lines = linesForVendor(hub.items, vendorId);

  if (lines.length === 0) {
    return (
      <>
        <PageHeader title="Confirm and pay" />
        <EmptyState
          title="Nothing to check out"
          blurb="This business has nothing in your plan that is still waiting to be booked. Add something to the plan, or open a booking you have already made."
          action={
            <Link
              href={`/events/${eventId}`}
              className="oc-button oc-button--primary oc-button--md"
            >
              Back to {hub.name}
            </Link>
          }
        />
      </>
    );
  }

  let quote: QuotedOrder | undefined;
  let refusal: string | null = null;

  try {
    const cart = await quoteCheckout(ctx, actor, { eventId, lines });
    quote = cart.orders[0];
  } catch (error) {
    // A cart this business cannot sell as one order — two cancellation policies
    // under one vendor, most likely. Said here, before the button, rather than
    // after a card has been typed in.
    if (error instanceof ValidationError) refusal = error.message;
    else if (error instanceof NotFoundError) notFound();
    else throw error;
  }

  if (!quote) {
    return (
      <>
        <PageHeader title="Confirm and pay" />
        <Toast tone="danger">
          <p className="m-0">
            {refusal ??
              "This booking could not be priced just now. Nothing has been charged, and nothing has been booked."}
          </p>
          <p className="mt-2 mb-0">
            <Link href={`/events/${eventId}`} className="font-semibold">
              Back to {hub.name}
            </Link>
          </p>
        </Toast>
      </>
    );
  }

  // Narrowed once, so the closures below do not each have to be. Everything
  // from here on is the one vendor's priced order.
  const priced = quote;
  const money = (amount: bigint) => formatMoney(amount, priced.currency);
  const full = priced.planKind === "full";

  return (
    <>
      <PageHeader title="Confirm and pay" />

      <CheckoutPayment
        publishableKey={getEnv().STRIPE_PUBLISHABLE_KEY}
        eventId={eventId}
        vendorId={vendorId}
        currency={priced.currency}
        // The provider's own field, and it takes a number of the smallest unit.
        // Not a computation: it is the figure the quote produced, in the shape
        // the SDK accepts.
        amountInCents={Number(priced.depositAmount)}
        terms={{
          totalCents: priced.total.toString(),
          depositCents: priced.depositAmount.toString(),
          balanceCents: priced.balanceAmount.toString(),
          balanceDueAt: priced.balanceDueAt?.toISOString() ?? null,
          total: money(priced.total),
          deposit: money(priced.depositAmount),
          balance: full ? null : money(priced.balanceAmount),
          balanceDate: priced.balanceDueAt ? formatDay(priced.balanceDueAt) : null,
        }}
        summary={{
          subtotal: money(priced.subtotal),
          tax: money(priced.tax),
          // The same literal the booking card draws (line 843). The rate is a
          // platform setting, so a screen that spells it out can disagree with
          // it; the divergence is recorded rather than fixed in one screen
          // only, which would leave the two saying different things.
          taxLabel: "HST 13%",
          depositLabel: full ? "Charged at checkout" : "Deposit today",
          balanceLabel: priced.balanceDueAt ? `Balance ${formatDay(priced.balanceDueAt)}` : null,
          fullPaymentNote: full ? fullPaymentNote(priced.planReason) : null,
        }}
      >
        <VendorPanel quote={priced} eventName={hub.name} />
      </CheckoutPayment>
    </>
  );
}

/** What is being bought and on what terms — lines 1147–1150. */
function VendorPanel({ quote, eventName }: { quote: QuotedOrder; eventName: string }) {
  return (
    <section
      className="oc-glass rounded-overlay border border-glass-edge-soft p-[20px]"
      aria-labelledby="vendor-heading"
    >
      <h2 id="vendor-heading" className="m-0 mb-[14px] text-subhead">
        {quote.vendorName}
      </h2>

      <ul className="m-0 list-none p-0">
        {quote.lines.map((line) => (
          <li
            key={`${line.serviceId}:${line.servicePackageId ?? ""}`}
            className="flex justify-between gap-3 border-b border-hairline pb-[12px] text-[14px] last:border-b-0"
          >
            <span>
              {line.description}
              {line.quantity > 1 ? ` × ${line.quantity}` : null}
            </span>
            <span className="font-bold whitespace-nowrap">
              {formatMoney(line.lineTotal, line.currency)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-[12px] mb-0 text-[13.5px] text-pretty text-body">
        For {eventName}. Free cancellation until{" "}
        <strong className="font-bold text-ink">{formatDay(quote.coolingWindowEndsAt)}</strong>; after
        that the vendor&rsquo;s own cancellation policy applies.
      </p>
    </section>
  );
}

/** Why the whole amount is taken now, in the words of the reason it is. */
function fullPaymentNote(reason: QuotedOrder["planReason"]): string {
  switch (reason) {
    case "short_notice":
      return "The event is close enough that the whole amount is taken at checkout.";
    case "small_total":
      return "Bookings this size are paid in full at checkout.";
    case "standard":
      return "This booking is paid in full at checkout.";
  }
}

/** A query parameter that must be one value, never an array of them. */
function single(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
