import Link from "next/link";
import {
  ANONYMOUS,
  listCategoriesForBrowse,
  listPublicEventFeed,
  listSaved,
  searchServices,
} from "@occasion/core";
import { Pill } from "@occasion/ui";
import { customerViewer } from "../../lib/auth-guard";
import { createRequestContext } from "../../lib/core";
import { CategoryTiles } from "./_components/category-tiles";
import { DeferredAction } from "./_components/deferred-action";
import { PublicEventFeed } from "./_components/public-event-feed";
import { ServiceCard } from "./_components/service-card";

export const metadata = { title: "Explore · Occasion" };

/** Rendered per request: the feed, the counts and the shortlist are all live. */
export const dynamic = "force-dynamic";

/** Line 2329: the canvas takes the first four listings as its featured row. */
const FEATURED = 4;

/**
 * Explore — **public**, and one of the three screens that are.
 *
 * The prototype's rule at line 2013: Explore, Results and Service detail
 * render for anybody, and every other customer route sends the visitor to the
 * login screen. This page therefore has no gate, and is named in the public
 * allowlist — which is the point of that list: being public is a decision
 * somebody wrote down, not the absence of a line.
 *
 * Six sections, lines 574–668. Every one of them draws rows that exist; where
 * there are none, the section is left out rather than filled.
 */
export default async function ExplorePage() {
  const ctx = createRequestContext();
  const viewer = await customerViewer();
  const actor = viewer ?? ANONYMOUS;

  const [categories, feed, featured, saved] = await Promise.all([
    listCategoriesForBrowse(ctx, actor),
    // Signed out only, as the canvas gates it (line 584) — and not fetched at
    // all otherwise, rather than fetched and discarded.
    viewer ? Promise.resolve([]) : listPublicEventFeed(ctx, actor),
    searchServices(ctx, actor),
    viewer ? listSaved(ctx, viewer) : Promise.resolve([]),
  ]);

  const savedIds = new Set(saved.map((row) => row.id));

  return (
    <>
      {/* Lines 574–582. */}
      <section className="relative overflow-hidden rounded-hero bg-role p-[clamp(26px,5vw,56px)] text-surface">
        <p className="m-0 mb-[14px] text-[12px] font-bold tracking-[0.14em] text-on-role-muted uppercase">
          Toronto · CAD
        </p>
        <h1 className="m-0 mb-[14px] max-w-[16ch] font-display text-[clamp(34px,6.4vw,64px)] leading-[1.02] tracking-[-0.02em] font-normal text-pretty">
          Plan any event in Toronto.
        </h1>
        <p className="m-0 mb-[26px] max-w-[48ch] text-[clamp(15px,1.6vw,18px)] text-pretty text-on-role-muted">
          Book fixed-price services instantly, or send one brief and get quotes from up to five
          vendors. Prices, deposits and balance dates shown before you pay.
        </p>
        <div className="flex flex-wrap gap-[10px]">
          <Link
            href="/services"
            className="oc-button oc-button--lg rounded-pill border-0 bg-[#F4F1E9] font-bold text-ink no-underline hover:no-underline"
          >
            Browse services
          </Link>
          <DeferredAction
            reason="Sending one brief to several vendors is planned, and is not built yet."
            className="oc-button oc-button--lg rounded-pill border border-[rgb(244_241_233/0.45)] bg-[rgb(244_241_233/0.12)] font-bold text-surface"
          >
            Get quotes
          </DeferredAction>
        </div>
      </section>

      {/* The section is absent when there is no public event, and the page
          still renders — a feed with nothing in it is not a thing to draw. */}
      {feed.length > 0 ? <PublicEventFeed events={feed} /> : null}

      <h2 className="mt-[38px] mb-[14px] font-display text-[27px] font-normal">
        Browse by category
      </h2>
      <CategoryTiles categories={categories} />

      {/* Lines 622–639. Three cards that never vary, so three cards. */}
      <h2 className="mt-[38px] mb-[14px] font-display text-[27px] font-normal">Two ways to book</h2>
      <div className="grid gap-[16px] [grid-template-columns:repeat(auto-fit,minmax(270px,1fr))]">
        <Explainer
          badge="BOOK NOW"
          title="Fixed-price services"
          body="Cakes, bouquets, photo packages. Pick a package, confirm availability on your date, pay the deposit. Confirmed immediately."
        />
        <Explainer
          badge="GET QUOTES"
          title="Custom work"
          body="Catering, decor, entertainment. Answer a few questions once, send to up to five vendors, compare offers side by side."
        />
        <Explainer
          badge="EVENT HUB"
          title="One page per event"
          body="Every vendor slot, the day-of schedule, deposits paid and balances due, and all messages in one place."
        />
      </div>

      {featured.rows.length > 0 ? (
        <>
          <h2 className="mt-[38px] mb-[14px] font-display text-[27px] font-normal">
            Featured Toronto vendors
          </h2>
          <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
            {/* The first four of the results screen's own query, sliced rather
                than fetched again: a featured listing that the results would
                not show is the disagreement a second query eventually causes.
                The catalogue read takes no limit, so the page is read and four
                are drawn. */}
            {featured.rows.slice(0, FEATURED).map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                saved={savedIds.has(service.id)}
                signedIn={viewer !== undefined}
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Lines 662–668. */}
      <section className="mt-[38px] flex flex-wrap items-center justify-between gap-[18px] rounded-panel border border-glass-edge-soft bg-glass-wash p-[24px]">
        <div>
          <h2 className="m-0 mb-[5px] font-display text-[24px] font-normal">
            Are you a Toronto vendor?
          </h2>
          <p className="m-0 text-[14px] text-body">
            Publish services, set your deposit policy, get paid out after each event.
          </p>
        </div>
        <DeferredAction
          reason="The vendor's own screens are planned, and are not built yet."
          className="oc-button oc-button--primary oc-button--md rounded-pill"
        >
          Become a vendor
        </DeferredAction>
      </section>
    </>
  );
}

/** One of the three explainer cards. Static markup, so no data reaches it. */
function Explainer({ badge, title, body }: { badge: string; title: string; body: string }) {
  return (
    <section className="oc-glass rounded-panel p-[22px]">
      <Pill>{badge}</Pill>
      <h3 className="mt-[13px] mb-[7px] text-[18px] font-bold">{title}</h3>
      <p className="m-0 text-[14px] text-pretty text-body">{body}</p>
    </section>
  );
}
