"use server";

import { revalidatePath } from "next/cache";
import { requireCustomerActor } from "../../lib/auth-guard";
import { clearActiveEvent, setActiveEvent } from "../../lib/active-event";
import { readString } from "../../lib/form-values";

/**
 * Customer actions.
 *
 * Every one of them calls `requireCustomerActor()` as its first statement. The
 * layout above these screens redirects somebody who does not belong, but a
 * server action is reachable by a direct POST that renders no layout at all —
 * so the gate has to be in the function that does the work.
 */

/**
 * Remembers which event is being planned.
 *
 * A server action because a server component cannot set a cookie, which is
 * also why the switcher is a form rather than something that writes on render.
 *
 * The id is **not** validated against the caller here, and deliberately so:
 * the cookie is a selection, and `resolveActiveEvent` loads the event and
 * checks who owns it on every read. Validating it here as well would put the
 * ownership rule in two places, and the one that matters is the one every
 * reader goes through.
 */
export async function selectActiveEventAction(form: FormData): Promise<void> {
  await requireCustomerActor();

  const eventId = readString(form, "eventId").trim();

  if (eventId) {
    await setActiveEvent(eventId);
  } else {
    await clearActiveEvent();
  }

  // The chip is drawn by the layout, which does not re-render on its own after
  // a POST. Without this the person clicks an event and the header goes on
  // naming the previous one.
  revalidatePath("/", "layout");
}
