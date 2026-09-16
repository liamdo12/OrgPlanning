"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  LOGIN_RULE,
  PASSWORD_RESET_RULE,
  RateLimitedError,
  ValidationError,
  clearAttempts,
  consumeAttempt,
  getActor,
  parseSelfAssignableRole,
  requireUser,
  safeRedirectPath,
  signUp,
} from "@occasion/core";
import { createRequestContext } from "../../lib/core";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { getEnv } from "../../lib/env";

/**
 * The auth server actions.
 *
 * Two rules hold throughout:
 *
 *   Nothing the client sends is trusted. The requested role goes through
 *   `parseSelfAssignableRole`, which knows only `customer` and `vendor`; the
 *   `next` destination goes through `safeRedirectPath`, which returns a path
 *   on this site or nothing.
 *
 *   Failures do not say which half was wrong. "That email and password do not
 *   match" covers both an unknown address and a bad password, because the
 *   alternative tells an attacker which addresses have accounts.
 */

export type AuthActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const GENERIC_CREDENTIALS_ERROR = "That email and password do not match.";

function readString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * The client address, for rate limiting.
 *
 * Limiting by address alone punishes everyone behind one NAT; limiting by
 * email alone leaves password spraying unbounded — one attempt against each of
 * ten thousand addresses trips nothing — and lets an attacker lock a known
 * victim out on demand. Both subjects are counted, so neither gap is open.
 */
async function clientAddress(): Promise<string> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

export async function signInAction(
  _previous: AuthActionState,
  form: FormData,
): Promise<AuthActionState> {
  const ctx = createRequestContext();
  const email = readString(form, "email").trim().toLowerCase();
  const password = readString(form, "password");
  const next = safeRedirectPath(readString(form, "next"), "/");

  if (!email || !password) {
    return { error: GENERIC_CREDENTIALS_ERROR };
  }

  const address = await clientAddress();

  try {
    // Counted before the attempt, not after a failure: counting only failures
    // lets an attacker refresh their budget with one correct guess.
    await consumeAttempt(ctx, LOGIN_RULE, `email:${email}`);
    await consumeAttempt(ctx, LOGIN_RULE, `ip:${address}`);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { error: "Too many attempts. Try again in a few minutes." };
    }
    throw error;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: GENERIC_CREDENTIALS_ERROR };
  }

  // The provider knows nothing about account status, so a suspended or
  // unverified person would otherwise sign in successfully and only discover
  // it on an admin route. End the session here instead.
  try {
    requireUser(await getActor(ctx));
  } catch {
    await supabase.auth.signOut();
    return {
      error: "This account cannot sign in. Check your email to verify it, or contact support.",
    };
  }

  await clearAttempts(ctx, LOGIN_RULE, `email:${email}`);
  await clearAttempts(ctx, LOGIN_RULE, `ip:${address}`);
  redirect(next);
}

export async function signUpAction(
  _previous: AuthActionState,
  form: FormData,
): Promise<AuthActionState> {
  const ctx = createRequestContext();
  const email = readString(form, "email").trim().toLowerCase();
  const password = readString(form, "password");
  const fullName = readString(form, "fullName");

  let role;
  try {
    // The only place a role is accepted from a browser, and it is narrowed to
    // a set that does not contain `admin`.
    role = parseSelfAssignableRole(readString(form, "role"));
  } catch (error) {
    if (error instanceof ValidationError) {
      return { error: error.message, fieldErrors: error.issues };
    }
    throw error;
  }

  if (password.length < 10) {
    return {
      error: "Choose a password of at least 10 characters.",
      fieldErrors: { password: "too-short" },
    };
  }

  const supabase = await createSupabaseServerClient();
  const env = getEnv();

  // The domain row first, then the provider account. If the provider call
  // fails, the row left behind is unclaimed — no provider subject, still
  // unverified — and `signUp` adopts it on the next attempt rather than
  // refusing. Without that adoption the address would be bricked: email is
  // unique, so every retry would hit the orphan and only a manual delete
  // would free it.
  let userId: string;
  try {
    userId = await signUp(ctx, { email, fullName, role });
  } catch (error) {
    if (error instanceof ValidationError) {
      return { error: error.message, fieldErrors: error.issues };
    }
    throw error;
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${env.APP_URL}/auth-callback?next=/`,
      // Carried for the provider's own templates only. The role that counts is
      // the row written above; nothing reads this back to decide authority.
      data: { full_name: fullName, occasion_user_id: userId },
    },
  });

  if (error) {
    return { error: "Could not create that account. Try again." };
  }

  redirect("/verify?sent=1");
}

export async function requestPasswordResetAction(
  _previous: AuthActionState,
  form: FormData,
): Promise<AuthActionState> {
  const ctx = createRequestContext();
  const email = readString(form, "email").trim().toLowerCase();
  const env = getEnv();

  if (email) {
    try {
      await consumeAttempt(ctx, PASSWORD_RESET_RULE, `email:${email}`);
      await consumeAttempt(ctx, PASSWORD_RESET_RULE, `ip:${await clientAddress()}`);

      const supabase = await createSupabaseServerClient();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${env.APP_URL}/auth-callback?next=/reset`,
      });
    } catch (error) {
      if (!(error instanceof RateLimitedError)) throw error;
    }
  }

  // Always the same answer, whether or not the address has an account — the
  // difference would be an account-enumeration oracle.
  return {};
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
