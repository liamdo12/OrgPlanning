import Link from "next/link";
import { Pill, Rating } from "@occasion/ui";
import { formatMoney, type ServiceCard as ServiceCardRow } from "@occasion/core";
import { SaveHeart } from "./save-heart";
import { ServiceCardCarousel } from "./service-card-carousel";

/**
 * One listing in a grid. Lines 719–739.
 *
 * **The card is not one control, and that is a deliberate divergence.** The
 * canvas wraps the media and every line of text in a single button (line 720)
 * with the heart as a sibling over it (line 738). Once the dot strip becomes
 * real controls and the media takes a swipe, that structure cannot hold: a
 * surface that handles gestures cannot also be a navigation target, and
 * buttons inside a link are invalid besides.
 *
 * So the **title is the link** and carries the card's accessible name, and the
 * media block is a region holding the carousel, its dots and the heart. What
 * is lost is the whole-card click. What is gained is a card whose name is the
 * name of the service rather than six concatenated fragments — "Studio Halo
 * ★ 4.9 (86) Seasonal bouquet Liberty Village From C$145.00 / arrangement",
 * which is what the canvas's own markup announces.
 */
export function ServiceCard({
  service,
  saved,
  signedIn,
}: {
  service: ServiceCardRow;
  saved: boolean;
  signedIn: boolean;
}) {
  return (
    <article className="motion-safe:animate-rise">
      {/* Not a link. See above. */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-[18px]">
        <ServiceCardCarousel
          media={service.media}
          toneStart={service.toneStart}
          toneEnd={service.toneEnd}
          caption={`${service.categoryName} photo`}
          serviceTitle={service.title}
        />

        {service.badge ? (
          // Line 723. Decorative in the sense that matters: it repeats
          // `booking_mode`, which the price line also says in words.
          <Pill className="absolute top-[9px] left-[9px]">{service.badge}</Pill>
        ) : null}

        <SaveHeart
          serviceId={service.id}
          serviceSlug={service.slug}
          serviceTitle={service.title}
          saved={saved}
          signedIn={signedIn}
        />
      </div>

      {/* Line 730: the business and its rating share a baseline. */}
      <div className="mt-[10px] flex items-baseline justify-between gap-2">
        <p className="m-0 truncate text-[14.5px] font-bold">{service.vendorName}</p>
        <Rating average={service.ratingAverage} count={service.reviewCount} />
      </div>

      <h3 className="m-0 text-[14px] font-normal">
        <Link href={`/services/${service.slug}`} className="text-body no-underline">
          {service.title}
        </Link>
      </h3>

      {service.areaLabel ? <p className="m-0 text-[13px] text-body">{service.areaLabel}</p> : null}

      <p className="m-0 mt-[4px] text-[14.5px] font-bold">{priceLabel(service)}</p>
    </article>
  );
}

/**
 * "From C$145.00 / arrangement", or the quote-only form. Line 2054.
 *
 * Formatted here, on the server, by the repository's one money formatter. A
 * component never sees cents and never multiplies anything: the currency is
 * the row's own, because that is the argument the formatter's malformed-code
 * guard exists for.
 */
export function priceLabel(service: {
  basePrice: bigint;
  currency: string;
  priceUnit: string;
  bookingMode: string;
}): string {
  const lead = service.bookingMode === "quote" ? "Custom quote · from" : "From";
  return `${lead} ${formatMoney(service.basePrice, service.currency)} / ${service.priceUnit}`;
}
