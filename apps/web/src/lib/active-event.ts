import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import {
  getEvent,
  isAuthenticated,
  NotFoundError,
  type Actor,
  type CoreContext,
} from "@occasion/core";
import { getEnv } from "./env";

/**
 * Which event a customer is currently planning.
 *
 * The header's switcher chip (line 391) selects which event "Add to event"
 * adds to, and the detail card checks availability against that event's date.
 * The selection has to survive a navigation, so it is a cookie — modelled on
 * `active-role.ts`, down to the dotted name and the full option set, because
 * half of those options on a deployed demo is a session-selection cookie
 * travelling in clear text.
 *
 * **It is selection, never authorization.** The id in it is a claim by the
 * browser and is treated as one: `resolveActiveEvent` loads the event and
 * checks ownership before anything uses it, and a cookie that fails any part
 * of that resolves to "no active event" — the same answer an absent cookie
 * gets, so it cannot be used to find out which ids exist.
 *
 * Ownership is checked through the planning module's own read, which runs the
 * event **write** policy — not `assertCanReadEvent`, which returns early for
 * any administrator. An administrator would otherwise pick up a customer's
 * event as their own active one, and the whole customer shell would render
 * around somebody else's party.
 *
 * Nothing outside this module reads the cookie. That is asserted rather than
 * asked for, in `active-event.test.ts`.
 */

const COOKIE = "occasion.active-event";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * The raw id in the cookie, if there is one.
 *
 * Module-private on purpose: an id from here has been checked against nothing.
 * `resolveActiveEvent` is the only way to get one that has.
 */
async function readActiveEventId(): Promise<string | undefined> {
  const value = (await cookies()).get(COOKIE)?.value;
  return value && UUID.test(value) ? value : undefined;
}

/**
 * Shape-checked before it reaches a query.
 *
 * Not a security measure — an id of the right shape is no more trustworthy
 * than one of the wrong shape, and the ownership check is what decides. It is
 * here because the column is `uuid` and Postgres raises on a malformed
 * comparand, which would turn a hand-edited cookie into the error boundary
 * instead of into "no active event".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Remembers which event is being planned.
 *
 * Callable only from a server action or a route handler. A server component
 * cannot set cookies, which is why the switcher is a form rather than
 * something that writes on render.
 */
export async function setActiveEvent(eventId: string): Promise<void> {
  const store = await cookies();

  store.set(COOKIE, eventId, {
    httpOnly: true,
    sameSite: "lax",
    // Plain HTTP only in local development, where there is no TLS to require.
    secure: getEnv().APP_TIER !== "local",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Forgets the selection, so the next request has no active event. */
export async function clearActiveEvent(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The active event, once it has been loaded and shown to belong to the actor. */
export type ActiveEvent = {
  id: string;
  name: string;
};

/**
 * The cookie read, the load and the ownership check, once per render.
 *
 * `cache()` because within one render the layout wants the name for the
 * switcher chip, the page wants the id and the booking card wants the date,
 * and that should be one query rather than three.
 *
 * The key is the actor and the context together, because the load now goes
 * through both. That is weaker than keying on the owner alone, which was the
 * intent while there was no read to make: a context is built fresh at each call
 * site, so call sites that build their own miss each other. It is a repeated
 * query and never a wrong answer — the policy runs again on the second one —
 * and threading one context through a render is what makes the dedupe bite.
 */
const activeEventFor = cache(
  async (ctx: CoreContext, actor: Actor): Promise<ActiveEvent | undefined> => {
    const eventId = await readActiveEventId();
    if (!eventId) return undefined;

    try {
      // The planning module's own read, which runs the event *write* policy —
      // the owner and nobody else, administrators included in the refusal. That
      // is what this needs: an administrator picking up a customer's event as
      // their own active one would put the whole customer shell on somebody
      // else's party.
      const event = await getEvent(ctx, actor, eventId);
      return { id: event.id, name: event.name };
    } catch (error) {
      // Every refusal is the same answer as no cookie at all — a forged id, a
      // deleted event, somebody else's event, an administrator's. Anything that
      // is not a refusal is a real fault and goes to the error boundary rather
      // than being swallowed into "no active event", which would hide an outage
      // behind an ordinary-looking screen.
      if (error instanceof NotFoundError) return undefined;
      throw error;
    }
  },
);

/**
 * The active event for this actor, or nothing.
 *
 * Every failure is the same answer: no cookie, a cookie that is not an id, an
 * id nobody owns, an id somebody else owns, and an administrator's request for
 * a customer's event. That is what stops the cookie being used to find out
 * which events exist.
 */
export function resolveActiveEvent(
  ctx: CoreContext,
  actor: Actor,
): Promise<ActiveEvent | undefined> {
  // An anonymous visitor has no events, and the platform's own principal is not
  // a person planning a party. Neither can own the id in a cookie, so neither
  // is a reason to read it.
  if (!isAuthenticated(actor)) return Promise.resolve(undefined);

  return activeEventFor(ctx, actor);
}
