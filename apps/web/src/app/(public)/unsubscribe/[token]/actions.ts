"use server";

import { unsubscribe } from "@occasion/core";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * Withdraws marketing consent from an emailed link.
 *
 * No actor, and deliberately so: the token was mailed to one address and is the
 * whole of the authority. Requiring a session would mean somebody who wants to
 * stop hearing from the platform has to sign in to say so, which is both the
 * opposite of what anti-spam law asks for and a good way to be ignored.
 *
 * It answers the same thing whatever the token turns out to be. A different
 * answer for a real one would make this endpoint a way to test which tokens —
 * and so which mailed addresses — exist.
 */

export type UnsubscribeState = { done: boolean };

export async function unsubscribeAction(
  _previous: UnsubscribeState,
  form: FormData,
): Promise<UnsubscribeState> {
  const ctx = createRequestContext();

  await unsubscribe(ctx, readString(form, "token"));

  return { done: true };
}
