import { notFound } from "next/navigation";
import { createRequestContext } from "../../../lib/core";
import { KitchenSink } from "./_components/kitchen-sink";

export const metadata = { title: "Kitchen sink · Occasion" };

/** Rendered per request: whether it exists at all depends on the tier. */
export const dynamic = "force-dynamic";

/**
 * The design system's comparison surface.
 *
 * Not product UI: it exists so a token can be checked against the prototype
 * without loading a screen that also needs data. Withheld on the production
 * tier — it is unauthenticated, and a page enumerating every component and
 * every state is a map of the admin surface for anyone who finds the URL.
 *
 * `notFound()` rather than a redirect, so the route is indistinguishable from
 * one that was never built.
 */
export default function KitchenSinkPage() {
  if (createRequestContext().config.appTier === "production") {
    notFound();
  }

  return <KitchenSink />;
}
