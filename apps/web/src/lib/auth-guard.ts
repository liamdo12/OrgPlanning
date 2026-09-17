import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ForbiddenError,
  UnauthenticatedError,
  getActor,
  requireAdmin,
  safeRedirectPath,
  type Actor,
} from "@occasion/core";
import { createRequestContext } from "./core";
import { readActiveRole } from "./active-role";
import { PATHNAME_HEADER } from "./request-path";

/** A signed-in, usable account — what the gate returns once it has passed. */
type AdminActor = Extract<Actor, { kind: "user" }>;

/**
 * The authorization entry point for every server surface.
 *
 * **A layout is not a security boundary.** Next.js is explicit that a layout
 * does not re-run on client-side navigation between its own segments, does not
 * control whether nested segments render, and — the part that matters most —
 * does not run at all for a server action or a route handler. A POST to an
 * action reaches the action directly.
 *
 * So `(admin)/layout.tsx` redirects for the sake of the person browsing, and
 * this module is what actually decides. Every admin server action and route
 * handler must call `requireAdminActor()` as its first statement, and every
 * function that then takes an entity id must still call an object policy — the
 * role gate says "an admin may use this", not "this admin may touch that row".
 *
 * `cache()` is per render pass, so the three queries behind `getActor` run once
 * for a page even when the layout, the page and a component each ask.
 */

export const currentActor = cache(async (): Promise<Actor> => {
  const ctx = createRequestContext();
  // The requested role only labels the answer: `getActor` drops it unless the
  // person holds it, and no gate consults it.
  return getActor(ctx, { activeRole: await readActiveRole() });
});

/** Throws unless the caller is a usable account holding the admin role. */
export async function requireAdminActor(): Promise<AdminActor> {
  return requireAdmin(await currentActor());
}

/**
 * The gate for a **page**.
 *
 * Same decision as `requireAdminActor`, different answer to a refusal: a page
 * that throws for an anonymous visitor logs an exception and renders the error
 * boundary, when what should happen is the login screen. Layout redirects do
 * not spare the page — Next renders both, so the page runs and throws even when
 * the layout's redirect wins the response.
 *
 * Actions and route handlers keep the throwing version. They are being asked to
 * *do* something, and the honest answer to "do this" from someone who may not
 * is an error, not a new page.
 *
 * Signing in returns to where the person actually was, which is why the proxy
 * puts the path on the request: a server component cannot otherwise find out
 * what URL it is rendering.
 */
export async function requireAdminPage(): Promise<AdminActor> {
  try {
    return await requireAdminActor();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) {
      // Through the same guard as any other `next`, even though the proxy
      // overwrites whatever a client sent under this name. A header that
      // decides where a redirect goes is worth validating whoever set it —
      // and the proxy does not run for every possible path.
      const here = safeRedirectPath((await headers()).get(PATHNAME_HEADER), "/admin");
      redirect(`/login?next=${encodeURIComponent(here)}`);
    }
    throw error;
  }
}
