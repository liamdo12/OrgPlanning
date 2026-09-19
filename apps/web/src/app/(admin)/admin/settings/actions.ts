"use server";

import { revalidatePath } from "next/cache";
import { AppError, updateSetting } from "@occasion/core";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * The settings screen's action.
 *
 * `requireAdminActor()` as the first statement, because a server action is
 * reachable by a direct POST that renders no layout at all. The domain then
 * refuses a key that is not set here, a value outside its bounds and anything
 * that is not a whole number — all of which the form also prevents, and none of
 * which a direct POST would.
 */

export type SettingsActionState = {
  error?: string;
  message?: string;
};

export async function updateSettingAction(
  _previous: SettingsActionState,
  form: FormData,
): Promise<SettingsActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();

  try {
    const key = readString(form, "key");
    await updateSetting(ctx, actor, key, readString(form, "value"));

    revalidatePath("/admin/settings");

    // Said plainly, because the effect is not visible on this screen: the next
    // booking is priced at the new number and the ones already taken are not
    // repriced.
    return { message: "Saved. The next booking is priced with it; existing ones are unchanged." };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}
