import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ANONYMOUS,
  NotFoundError,
  formatMoney,
  getServiceDetail,
  listEventsForOwner,
  quoteCheckout,
  serviceAvailability,
  type Actor,
  type QuotedOrder,
  type ServiceDayState,
  type ServiceDetail,
} from "@occasion/core";
import { Avatar, GlassPanel, Rating } from "@occasion/ui";
import { customerViewer } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { resolveActiveEvent } from "../../../../lib/active-event";
import { formatDay } from "../../../../lib/format-moment";
import { toSearchParams } from "../../_config/search";
import { DeferredAction } from "../../_components/deferred-action";
import { SaveHeart } from "../../_components/save-heart";
import { priceLabel } from "../../_components/service-card";
import { arrivalOptions, readBookingSelection } from "./booking-selection";
import { BookingCard } from "./_components/booking-card";
import { PackagePicker } from "./_components/package-picker";
import { PhotoStrip } from "./_components/photo-strip";
import { ReviewList } from "./_components/review-list";

/** Rendered per request: the price, the date and the shortlist are all live. */
export const dynamic = "force-dynamic";

/**
 * The listing, looked up once per request.
 *
 * `cache()` because the metadata and the page both need it and both run in the
 * same render pass — without it the listing is queried twice for every view.
 * The context is built inside for the same reason: one built per call site
 * would give the two callers different keys and defeat the dedupe.
 *
 * It answers `null` rather than throwing, so the two callers can each decide
 * what a missing listing means for them. Anything that is not the domain's own
 * refusal is a fault and is left to the error boundary with a digest.
 */
const loadListing = cache(
  async (
    slug: string,
  ): Promise<{ service: ServiceDetail; actor: Actor; viewer: SignedInCustomer } | null> => {
    const ctx = createRequestContext();
    const viewer = await customerViewer();
    const actor: Actor = viewer ?? ANONYMOUS;

    try {
      return { service: await getServiceDetail(ctx, actor, slug), actor, viewer };
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  },
);

type SignedInCustomer = Awaited<ReturnType<typeof customerViewer>>;

/**
 * The title, and the **status**.
 *
 * Refusing here rather than only in the page is what makes a withdrawn listing
 * a real 404 rather than a 404-looking page served with a 200. Metadata is
 * resolved before the response begins; the page below it renders inside a
 * Suspense boundary the group's loading file creates, and by the time it runs
 * the status line has already been sent.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await loadListing(slug);
  if (!found) notFound();

  return { title: `${found.service.title} · Occasion` };
}

/**
 * One listing. **Public**, by the prototype's rule at line 2013, and named in
 * the public allowlist so that being public stays something somebody decided.
 *
 * A listing whose business is not approved, or that has never been published,
 * answers exactly what an unknown slug answers. That is the domain's refusal,
 * not this page's: a draft's URL must not become a way to learn what a vendor
 * is about to launch, and a suspended business's page must not become a way to
 * learn it was suspended.
 *
 * The selection — package, quantity, arrival — is in the URL. It has to be:
 * the money in the aside is produced by `quoteCheckout`, on the server, by the
 * same path the real checkout runs, and a selection held in the browser would
 * need a second implementation of the pricing rules to keep those five figures
 * honest.
 */
export default async function ServiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = createRequestContext();
  const { slug } = await params;
  const query = toSearchParams(await searchParams);

  // The same lookup the metadata made, deduped. It refuses there, before the
  // response starts, so that the refusal carries a status; this is the guard
  // for a render that somehow reached here anyway.
  const found = await loadListing(slug);
  if (!found) notFound();

  const { service, actor, viewer } = found;

  const [active, events] = await Promise.all([
    resolveActiveEvent(ctx, actor),
    viewer ? listEventsForOwner(ctx, viewer) : Promise.resolve([]),
  ]);

  // A cancelled event is not something to book against, and the switcher must
  // not offer one. The active event still has to be found in the full list,
  // because that is where its date and guest count are.
  const bookable = events.filter((event) => event.cancelledAt === null);
  const event = bookable.find((candidate) => candidate.id === active?.id);

  const selection = readBookingSelection(query, {
    packageIds: service.packages.map((tier) => tier.id),
    arrivals: arrivalOptions(event?.startTime ?? null),
  });

  const [quote, availability] = await Promise.all([
    quoteFor(ctx, viewer, service, event?.id, selection),
    event ? dayState(ctx, actor, service.id, event.eventDate) : Promise.resolve(null),
  ]);

  const chosen = service.packages.find((tier) => tier.id === selection.servicePackageId);

  return (
    <>
      <Link
        href="/services"
        className="mb-[12px] inline-block text-[13.5px] font-semibold text-body"
      >
        ← All services
      </Link>

      <PhotoStrip
        photos={service.media}
        serviceTitle={service.title}
        categoryName={service.categoryName}
        toneStart={service.toneStart}
        toneEnd={service.toneEnd}
      />

      <div className="grid items-start gap-[28px] [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        <div>
          <div className="relative">
            <h1 className="m-0 mb-[6px] font-display text-[clamp(27px,3.6vw,38px)] leading-[1.1] font-normal">
              {service.title}
            </h1>

            {/* The heart is here rather than on the hero: the strip's tiles are
                controls of their own now, and a button floating over one of
                them would be a second thing in the same corner. */}
            <SaveHeart
              serviceId={service.id}
              serviceSlug={service.slug}
              serviceTitle={service.title}
              saved={service.saved}
              signedIn={viewer !== undefined}
            />
          </div>

          <p className="m-0 mb-[20px] flex flex-wrap items-baseline gap-[6px] text-[14.5px] text-body">
            <Rating
              average={service.ratingAverage}
              count={service.reviewCount}
              className="text-[14.5px]"
            />
            {service.areaLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{service.areaLabel}</span>
              </>
            ) : null}
          </p>

          <VendorRow vendor={service.vendor} now={ctx.clock.now()} />

          {service.packages.length > 0 ? (
            <section>
              <h2 className="mt-[28px] mb-[12px] text-section font-bold">Packages</h2>
              <PackagePicker
                slug={service.slug}
                selectedId={selection.servicePackageId}
                packages={service.packages.map((tier) => ({
                  id: tier.id,
                  name: tier.name,
                  description: tier.description,
                  priceLabel: formatMoney(tier.unitPrice, tier.currency),
                }))}
              />
            </section>
          ) : null}

          {service.policy ? <CancellationPolicy policy={service.policy} /> : null}

          {service.reviews.length > 0 ? (
            <section>
              <h2 className="mt-[28px] mb-[10px] text-section font-bold">Reviews</h2>
              <ReviewList reviews={service.reviews} />
            </section>
          ) : null}
        </div>

        <BookingCard
          slug={service.slug}
          serviceId={service.id}
          serviceTitle={service.title}
          servicePackageId={selection.servicePackageId}
          // The tier's own price once one is chosen, and the listing's base
          // price when it has no tiers. Both through the one formatter.
          priceLabel={
            chosen
              ? `${formatMoney(chosen.unitPrice, chosen.currency)} / ${service.priceUnit}`
              : priceLabel(service)
          }
          availability={availability}
          event={
            event
              ? {
                  id: event.id,
                  name: event.name,
                  eventDate: event.eventDate,
                  guestCount: event.guestCount,
                }
              : undefined
          }
          events={bookable.map((candidate) => ({ id: candidate.id, name: candidate.name }))}
          quote={quote.order}
          quoteFailed={quote.failed}
          quantity={selection.quantity}
          priceUnit={service.priceUnit}
          arrivalTime={selection.arrivalTime}
          arrivals={arrivalOptions(event?.startTime ?? null)}
          depositPercentLabel={service.policy ? `${service.policy.depositBps / 100}%` : null}
          signedIn={viewer !== undefined}
        />
      </div>
    </>
  );
}

/**
 * What the business can prove. Lines 775–782.
 *
 * Tenure and completed bookings, both derived from rows. The canvas's third
 * fact — "responds in ~2h" — is not here: there is no response-time column and
 * no record of message latency to compute one from, and a number invented for
 * a screen is one a vendor would be held to.
 */
function VendorRow({ vendor, now }: { vendor: ServiceDetail["vendor"]; now: Date }) {
  return (
    <GlassPanel as="section" className="flex flex-wrap items-center gap-[14px] p-[18px]">
      <Avatar name={vendor.name} className="size-[46px] text-[16px]" />
      <div className="min-w-0">
        <p className="m-0 text-[15.5px] font-bold">
          {vendor.name}{" "}
          <span className="text-[12.5px] font-semibold text-role-hover">✓ Verified</span>
        </p>
        <p className="m-0 text-[13.5px] text-body">{vendorFacts(vendor, now).join(" · ")}</p>
      </div>

      <DeferredAction
        reason="Messaging a vendor is planned, and is not built yet."
        className="oc-button oc-button--secondary oc-button--sm ml-auto"
      >
        Message
      </DeferredAction>
    </GlassPanel>
  );
}

/**
 * Only facts there are rows for.
 *
 * A business approved this month has no tenure to state, and one that has
 * completed nothing says nothing rather than "0 events booked" — which reads
 * as a failure where the truth is that it is new.
 */
function vendorFacts(vendor: ServiceDetail["vendor"], now: Date): string[] {
  const facts: string[] = [];

  if (vendor.approvedAt) {
    // From the domain clock, not the runtime's: under a demo override every
    // other date on the screen moves, and a tenure that did not would put this
    // line a year out of step with the availability beside it.
    const years = Math.floor(
      (now.getTime() - vendor.approvedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
    );
    if (years >= 1) facts.push(`${years} ${years === 1 ? "yr" : "yrs"} on platform`);
    else facts.push(`On the platform since ${formatDay(vendor.approvedAt)}`);
  }

  if (vendor.completedOrders > 0) {
    facts.push(`${vendor.completedOrders} events booked`);
  }

  if (vendor.baseArea) facts.push(vendor.baseArea);

  return facts;
}

/**
 * The cancellation terms, from the listing's own template. Lines 798–802.
 *
 * The canvas hardcodes "Moderate" and writes the consequences as prose. Both
 * are real here: the tier varies per listing, and the deposit percentage, the
 * free window and the late refund are the numbers the checkout will apply.
 *
 * Two sentences of the canvas's prose are **not** reproduced — "50% refundable
 * until 7 days before the event" and "refunds within 15 days" — because there
 * is no column behind either, and a refund policy is the last place to write
 * something the system will not do.
 */
function CancellationPolicy({ policy }: { policy: NonNullable<ServiceDetail["policy"]> }) {
  return (
    <section>
      <h2 className="mt-[28px] mb-[10px] text-section font-bold">Cancellation policy</h2>
      <GlassPanel as="div" className="p-[18px]">
        <p className="m-0 mb-[6px] text-[15px] font-bold">{policy.name}</p>
        <p className="m-0 text-[14px] text-pretty text-body">{policy.summary}</p>
        <p className="mt-[6px] mb-0 text-[14px] text-pretty text-body">
          The deposit is {policy.depositBps / 100}% of the total.{" "}
          {policy.freeCancellationHours > 0
            ? `Cancelling within ${policy.freeCancellationHours} hours of booking costs nothing.`
            : "There is no free-cancellation window on this listing."}{" "}
          {policy.lateRefundBps > 0
            ? `After that, ${policy.lateRefundBps / 100}% is refunded.`
            : "After that the deposit is not refunded."}
        </p>
      </GlassPanel>
    </section>
  );
}

/**
 * The five figures, or nothing, and never a screen that fails because of them.
 *
 * A quote needs an account and an event; without either there is no deposit to
 * show and the card says so. When there is one and it fails, the listing still
 * renders — a pricing hiccup must not 500 a public page — and the card says
 * that too.
 */
async function quoteFor(
  ctx: ReturnType<typeof createRequestContext>,
  viewer: Awaited<ReturnType<typeof customerViewer>>,
  service: ServiceDetail,
  eventId: string | undefined,
  selection: { servicePackageId: string | null; quantity: number },
): Promise<{ order: QuotedOrder | null; failed: boolean }> {
  if (!viewer || !eventId) return { order: null, failed: false };

  try {
    const quote = await quoteCheckout(ctx, viewer, {
      eventId,
      lines: [
        {
          serviceId: service.id,
          ...(selection.servicePackageId ? { servicePackageId: selection.servicePackageId } : {}),
          quantity: selection.quantity,
        },
      ],
    });

    // One service, therefore one vendor, therefore one order.
    return { order: quote.orders[0] ?? null, failed: quote.orders.length === 0 };
  } catch {
    return { order: null, failed: true };
  }
}

/**
 * Whether the date looks free — advisory, and labelled as such on the card.
 *
 * A failure here is not a reason to lose the listing, so it answers "no idea"
 * rather than throwing: the exclusion constraint inside the checkout is what
 * actually decides, and this read only greys out a date in advance.
 */
async function dayState(
  ctx: ReturnType<typeof createRequestContext>,
  actor: Actor,
  serviceId: string,
  day: string,
): Promise<ServiceDayState | null> {
  try {
    const answer = await serviceAvailability(ctx, actor, serviceId, day);
    return answer.state;
  } catch {
    return null;
  }
}
