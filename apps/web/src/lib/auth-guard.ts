import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ForbiddenError,
  UnauthenticatedError,
  getActor,
  isAdmin,
  isAuthenticated,
  isUsable,
  requireAdmin,
  safeRedirectPath,
  type Actor,
} from "@occasion/core";
import { createRequestContext } from "./core";
import { readActiveRole } from "./active-role";
import { PATHNAME_HEADER } from "./request-path";

/**
 * A signed-in, usable account — what a gate returns once it has passed.
 *
 * One name for both gates: which one let the caller through is said by the
 * function's name, and a second alias for the same type would only suggest the
 * compiler is checking something it is not.
 */
type SignedInActor = Extract<Actor, { kind: "user" }>;

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
export async function requireAdminActor(): Promise<SignedInActor> {
  return requireAdmin(await currentActor());
}

/**
 * The gate for a **customer action or route handler**.
 *
 * Status-based, not role-based, and it is worth saying why, because the
 * obvious justification — "every account holds `customer`" — is false. Signup
 * assigns exactly one self-assignable role, an administrator may grant only
 * `vendor` and `admin`, and no seeded account holds two; the authorization
 * matrix has to insert the role by hand precisely because it is absent.
 *
 * The real reason is that role membership is not what this surface is about. A
 * vendor's owner who wants to book a cake for their own party is a customer of
 * this marketplace whatever their `user_roles` say, and locking them out would
 * be a bug with no upside. What the gate does refuse is an account that may not
 * act at all, and an anonymous visitor.
 *
 * It also refuses an **administrator**, which is not symmetry — it is the one
 * asymmetric rule here. Administrators have their own surface, and the object
 * policies admit them to any event or order on the platform, so an
 * administrator on the customer screens is looking at somebody else's plans
 * through a UI built on the assumption that everything shown belongs to the
 * person looking. Refusing them keeps "these screens show your own things" a
 * property rather than a convention.
 */
export async function requireCustomerActor(): Promise<SignedInActor> {
  const actor = await currentActor();

  if (!isAuthenticated(actor)) throw new UnauthenticatedError();
  if (!isUsable(actor)) throw new ForbiddenError("This account cannot be used right now.");
  if (isAdmin(actor)) throw new ForbiddenError("Administrators use the admin screens.");

  return actor;
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
export async function requireAdminPage(): Promise<SignedInActor> {
  try {
    return await requireAdminActor();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) {
      redirect(await loginPath("/admin"));
    }
    throw error;
  }
}

/**
 * The customer this request is from, or nothing — **for chrome only**.
 *
 * The public screens draw the signed-out shell for anyone the gate would
 * refuse, so the layout needs the same answer without the refusal. It asks
 * `requireCustomerActor` rather than re-deriving it, because two expressions of
 * "may this person use the customer surface" is how a screen ends up showing an
 * account menu to somebody who is about to be redirected away from it.
 *
 * Only the two refusals are absorbed. Anything else — a failed query inside
 * `getActor`, say — is a real error, and answering "signed out" to it would
 * quietly sign somebody out because the database hiccupped.
 *
 * Never make a decision with this. A decision uses the gate.
 */
export async function customerViewer(): Promise<SignedInActor | undefined> {
  try {
    return await requireCustomerActor();
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) return undefined;
    throw error;
  }
}

/**
 * The gate for a **customer page**. Same split, same reason.
 *
 * An anonymous visitor to a signed-in customer screen is the ordinary case
 * here rather than the exceptional one — the public screens are Explore,
 * Results and Service detail, and everything else sends the visitor to the
 * login screen, which is what the prototype does at line 2013.
 *
 * The three public screens do not call this. Each page declares its own gate
 * as its first statement and a registry checks that every page either calls
 * this one or is on a short, named allowlist — because a middleware matcher
 * listing the public paths is a list that drifts silently in the unsafe
 * direction.
 */
export async function requireCustomerPage(): Promise<SignedInActor> {
  try {
    return await requireCustomerActor();
  } catch (error) {
    // An administrator is refused here and is not lost: they are signed in
    // already, so the login screen would be a dead end that offers them a
    // session they have. They go where their work is.
    if (error instanceof ForbiddenError && isAdmin(await currentActor())) {
      redirect("/admin");
    }
    if (error instanceof UnauthenticatedError || error instanceof ForbiddenError) {
      redirect(await loginPath("/"));
    }
    throw error;
  }
}

/**
 * The login screen, told where to come back to.
 *
 * One implementation for both gates: the `next` guard, the header it reads and
 * the encoding are the part that is easy to get subtly wrong, and two copies
 * is how one of them ends up without the guard.
 *
 * `next` goes through the same check as any other, even though the proxy
 * overwrites whatever a client sent under this header name. A value that
 * decides where a redirect goes is worth validating whoever set it — and the
 * proxy does not run for every possible path.
 */
async function loginPath(fallback: string): Promise<string> {
  const here = safeRedirectPath((await headers()).get(PATHNAME_HEADER), fallback);
  return `/login?next=${encodeURIComponent(here)}`;
}
