import Link from "next/link";
import { listSaved } from "@occasion/core";
import { EmptyState, PageHeader } from "@occasion/ui";
import { requireCustomerPage } from "../../../lib/auth-guard";
import { createRequestContext } from "../../../lib/core";
import { MediaPlaceholder } from "../_components/media-placeholder";
import { priceLabel } from "../_components/service-card";

export const metadata = { title: "Saved · Occasion" };

/** Rendered per request: what it shows belongs to whoever is asking. */
export const dynamic = "force-dynamic";

/**
 * Saved services. Lines 1324–1341.
 *
 * The gate is the first statement, and it is the page form: a page that throws
 * logs an exception for every anonymous visitor and renders the error
 * boundary, when what should happen is the login screen, coming back here
 * afterwards.
 *
 * The cards are the canvas's own flatter ones (lines 1329–1334) — a gradient,
 * the business, the listing and the price. No carousel and no heart, because
 * this is the list of things already hearted and the way off it is the
 * listing's own page.
 *
 * The domain filters this list the way it filters the catalogue, so a saved
 * listing whose business has since been suspended drops off rather than
 * sitting here as a card that 404s when it is opened. The row stays in the
 * table, so reinstating the business brings it back.
 */
export default async function SavedPage() {
  const actor = await requireCustomerPage();
  const ctx = createRequestContext();

  const saved = await listSaved(ctx, actor);

  return (
    <>
      <PageHeader title="Saved services" />

      {saved.length === 0 ? (
        <EmptyState
          // The prototype's own wording, line 1338.
          title="Nothing saved yet"
          blurb="Tap the heart on any service card and it will be here."
          action={
            <Link href="/services" className="oc-button oc-button--primary oc-button--md">
              Browse services
            </Link>
          }
        />
      ) : (
        <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {saved.map((service) => (
            <article key={service.id}>
              <div className="relative aspect-[4/3] overflow-hidden rounded-[18px]">
                <MediaPlaceholder
                  toneStart={service.toneStart}
                  toneEnd={service.toneEnd}
                  caption={`${service.categoryName} photo`}
                />
              </div>

              <p className="m-0 mt-[10px] truncate text-[14.5px] font-bold">{service.vendorName}</p>
              <h2 className="m-0 text-[14px] font-normal">
                <Link href={`/services/${service.slug}`} className="text-body no-underline">
                  {service.title}
                </Link>
              </h2>
              <p className="m-0 mt-[4px] text-[14.5px] font-bold">{priceLabel(service)}</p>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
