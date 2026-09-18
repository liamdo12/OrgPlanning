"use server";

import { revalidatePath } from "next/cache";
import {
  AppError,
  approveUser,
  markEmailVerified,
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
import { getEnv } from "../../../../lib/env";

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
 * asking makes sense and records that somebody asked, and this sends.
 *
 * It asks the provider what *it* believes first, because the two can disagree
 * in the one direction that matters. Somebody clicks the link, the provider
 * marks the address confirmed, and our own row never learns — the callback
 * failed, or they closed the tab before it ran. The account then reads
 * `unverified` here for ever, and `resend` for an address the provider has
 * already confirmed **succeeds and sends nothing**: no error, no email, and an
 * administrator told it went out. Verified against a local stack; the mailbox
 * stayed empty.
 *
 * So a confirmed address is not resent to. It is reconciled, which is the thing
 * that should have happened when they clicked, and the administrator is told
 * that instead.
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

    if (await providerHasConfirmed(email)) {
      await markEmailVerified(ctx, userId);
      return `${email} was already confirmed with the provider — this account is active now. No email was sent.`;
    }

    const { error } = await admin.auth.resend({ type: "signup", email });

    if (error) {
      // The provider's own wording is not for showing anybody: its rate-limit
      // message reads "you can only request this after 0 seconds".
      const throttled = error.status === 429;
      throw new AppError(
        throttled
          ? `The provider is rate-limiting verification emails. Wait a minute and try ${email} again.`
          : `Could not send to ${email}. The provider refused it; try again.`,
      );
    }

    return `Verification email sent to ${email}.`;
  });
}

/**
 * Whether the provider considers this address confirmed.
 *
 * By address rather than by subject, because an account that has never signed
 * in has no subject bound on our side — which is exactly the account this
 * screen is about.
 *
 * A failure to ask is not a failure to send: if the lookup itself breaks, fall
 * through and let the resend happen. The worst case is the silent no-op this
 * guard exists to catch, which is where we already were.
 */
async function providerHasConfirmed(email: string): Promise<boolean> {
  const env = getEnv();

  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );

    if (!response.ok) return false;

    const body = (await response.json()) as {
      users?: { email?: string; email_confirmed_at?: string | null }[];
    };
    const match = body.users?.find((user) => user.email?.toLowerCase() === email.toLowerCase());

    return Boolean(match?.email_confirmed_at);
  } catch {
    return false;
  }
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
