import "server-only";

import { cache } from "react";
import {
  ForbiddenError,
  UnauthenticatedError,
  getActor,
  requireAdmin,
  type Actor,
} from "@occasion/core";

/** A signed-in, usable account — what the gate returns once it has passed. */
type AdminActor = Extract<Actor, { kind: "user" }>;
import { createRequestContext } from "./core";
import { readActiveRole } from "./active-role";

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
 * True when the caller may see admin surfaces.
 *
 * For deciding what to render. Never for deciding whether to act — an action
 * calls `requireAdminActor()` and lets it throw.
 */
export async function isAdminRequest(): Promise<boolean> {
  try {
    await requireAdminActor();
    return true;
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) {
      return false;
    }
    throw error;
  }
}
