"use server";

import { revalidatePath } from "next/cache";
import {
  AppError,
  approveUser,
  grantRoleToUser,
  parseRoleName,
  reinstateAccount,
  resendVerification,
  revokeRoleFromUser,
  suspendAccount,
} from "@occasion/core";
import { requireAdminActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { readString } from "../../../../lib/form-values";

/**
 * The account list's actions.
 *
 * Every one calls `requireAdminActor()` as its first statement. The layout
 * above these pages redirects a non-admin, but a server action is reachable by
 * a direct POST that renders no layout at all — and the domain checks again,
 * because this file is not the only thing that will ever call it.
 */

export type UserActionState = {
  error?: string;
  message?: string;
};

/**
 * Runs one decision and turns a domain refusal into something readable.
 *
 * Only `AppError` is caught. Anything else is a fault rather than a refusal and
 * belongs in the error boundary with a digest, not paraphrased into a toast.
 */
async function run(work: () => Promise<string>): Promise<UserActionState> {
  try {
    const message = await work();
    revalidatePath("/admin/users");
    return { message };
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }
}

export async function suspendUserAction(
  _previous: UserActionState,
  form: FormData,
): Promise<UserActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const userId = readString(form, "userId");
  const name = readString(form, "name");

  return run(async () => {
    await suspendAccount(ctx, actor, userId, readString(form, "reason"));
    return `${name || "That account"} is suspended. Their sessions have ended.`;
  });
}

export async function reinstateUserAction(
  _previous: UserActionState,
  form: FormData,
): Promise<UserActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const userId = readString(form, "userId");
  const name = readString(form, "name");

  return run(async () => {
    await reinstateAccount(ctx, actor, userId);
    return `${name || "That account"} is active again.`;
  });
}

export async function approveUserAction(
  _previous: UserActionState,
  form: FormData,
): Promise<UserActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const userId = readString(form, "userId");
  const name = readString(form, "name");

  return run(async () => {
    await approveUser(ctx, actor, userId);
    return `${name || "That account"} is approved.`;
  });
}

/**
 * Asks the provider to send the verification email again.
 *
 * Two halves, like clearing a lost second factor: the domain decides whether
 * asking makes sense and records that somebody asked, and this sends. A failure
 * at the provider is reported as a failure — telling an administrator the email
 * went out when it did not is how somebody waits for a message that is never
 * coming.
 */
export async function resendVerificationAction(
  _previous: UserActionState,
  form: FormData,
): Promise<UserActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const userId = readString(form, "userId");

  return run(async () => {
    const { email } = await resendVerification(ctx, actor, userId);

    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.resend({ type: "signup", email });

    if (error) {
      throw new AppError(`Could not send to ${email}. The provider refused it; try again.`);
    }

    return `Verification email sent to ${email}.`;
  });
}

export async function grantRoleAction(
  _previous: UserActionState,
  form: FormData,
): Promise<UserActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const userId = readString(form, "userId");
  const role = parseRoleName(readString(form, "role"));

  return run(async () => {
    if (!role) {
      throw new AppError("That is not a role.");
    }

    // The typed confirmation is checked in the domain, not here: a confirmation
    // enforced only by a form is one a direct POST skips.
    await grantRoleToUser(ctx, actor, userId, role, readString(form, "confirmation"));
    return `Granted ${role}. It takes effect on their next request.`;
  });
}

export async function revokeRoleAction(
  _previous: UserActionState,
  form: FormData,
): Promise<UserActionState> {
  const actor = await requireAdminActor();
  const ctx = createRequestContext();
  const userId = readString(form, "userId");
  const role = parseRoleName(readString(form, "role"));

  return run(async () => {
    if (!role) {
      throw new AppError("That is not a role.");
    }

    await revokeRoleFromUser(ctx, actor, userId, role);
    return `Revoked ${role}. Their existing sessions have ended.`;
  });
}
