"use server";

import { NotFoundError, clearSecondFactor, findUserIdByEmail } from "@occasion/core";
import { requireAdminActor } from "../../lib/auth-guard";
import { createRequestContext } from "../../lib/core";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { readString } from "../../lib/form-values";

/**
 * Administrator actions.
 *
 * Every one of them calls `requireAdminActor()` as its first statement. The
 * layout above these pages redirects a non-admin, but a server action is
 * reachable by a direct POST that never renders a layout at all — so the gate
 * has to be here, in the function that does the work.
 */

export type AdminActionState = {
  error?: string;
  message?: string;
};

/**
 * Gives someone back their account after they lose their authenticator.
 *
 * Both halves are needed. Clearing our own flag stops us requiring a second
 * factor; deleting the provider's factor stops the provider asking for one. Do
 * only the first and the person is redirected to a challenge they cannot answer
 * for ever.
 */
export async function clearSecondFactorAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const email = readString(form, "email").trim().toLowerCase();

  if (!email) {
    return { error: "Enter the account's email address." };
  }

  const targetUserId = await findUserIdByEmail(ctx, actor, email);
  if (!targetUserId) {
    return { error: "No account with that address." };
  }

  let authProviderSub: string | null;
  try {
    ({ authProviderSub } = await clearSecondFactor(ctx, actor, targetUserId));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { error: error.message };
    }
    throw error;
  }

  // Our half is already committed, so a failure here is not a failure of the
  // whole operation — it is a different, worse state, and saying "done" would
  // send someone away believing an account is recoverable when the provider
  // will still demand a code nobody can produce.
  if (authProviderSub) {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: authProviderSub });

    if (error) {
      return { error: providerHalfFailed(email) };
    }

    for (const factor of data.factors) {
      const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: authProviderSub,
      });

      if (deleteError) {
        return { error: providerHalfFailed(email) };
      }
    }
  }

  return {
    message: `Two-step verification cleared for ${email}. Their existing sessions have ended.`,
  };
}

function providerHalfFailed(email: string): string {
  return (
    `Cleared the requirement for ${email}, but their authenticator could not be removed at the ` +
    `provider. They will still be asked for a code. Run this again.`
  );
}
