"use server";

import { revalidatePath } from "next/cache";
import { toggleSaved } from "@occasion/core";
import { requireCustomerActor } from "../../../lib/auth-guard";
import { createRequestContext } from "../../../lib/core";
import { readString } from "../../../lib/form-values";

/**
 * The heart, as the only thing it can be.
 *
 * `requireCustomerActor()` first, because a server action is reachable by a
 * direct POST that renders no layout: the redirect a visitor gets from the
 * heart on the page is a **link** in the markup, not a refusal here, and this
 * function has to refuse on its own.
 *
 * One action for both directions. The domain decides which way it goes — the
 * screen has one control, and a save/unsave pair would need the button to
 * know a state that may have changed in another tab.
 *
 * Nothing is caught. `toggleSaved` refuses an unlistable service with the same
 * `NotFoundError` an unknown id gets, and the group's error boundary already
 * shows that message by name; swallowing it here would leave a heart that
 * silently does nothing.
 */
export async function toggleSavedAction(form: FormData): Promise<void> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();

  await toggleSaved(ctx, actor, readString(form, "serviceId").trim());

  // The heart is drawn on four screens and the shortlist is one of them, so
  // the refresh has to cover the tree rather than the path that was posted
  // from — otherwise saving from the results grid leaves `/saved` stale.
  revalidatePath("/", "layout");
}
