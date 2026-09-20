"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ForbiddenError,
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
  selectActiveRole,
  signUp,
} from "@occasion/core";
import { createRequestContext } from "../../lib/core";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { clearActiveRole, writeActiveRole } from "../../lib/active-role";
import { getEnv } from "../../lib/env";
import { readString } from "../../lib/form-values";

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

  // Cleared on a correct password rather than on a completed sign-in: the
  // branches below either hand off to the challenge or end the session, and
  // both leave the counters behind. Someone who already has the password
  // gains nothing from the reset.
  await clearAttempts(ctx, LOGIN_RULE, `email:${email}`);
  await clearAttempts(ctx, LOGIN_RULE, `ip:${address}`);

  // A password is one factor. If this person enrolled a second one, the session
  // is not finished yet — and until it is, `getActor` reports them as anonymous,
  // so the status check below would sign them out instead of challenging them.
  if (await secondFactorOutstanding(supabase)) {
    redirect(`/mfa/challenge?next=${encodeURIComponent(next)}`);
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

  redirect(next);
}

/**
 * Whether the provider is still waiting for a second factor.
 *
 * Only ever used to decide *where to send the browser*. Whether a factor is
 * required is answered in the domain, from our own row, because this one comes
 * out of the session object and the session object comes out of a cookie.
 */
async function secondFactorOutstanding(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === "aal2" && data.nextLevel !== data.currentLevel;
}

/**
 * Hands the browser to Google.
 *
 * `next` survives the round trip as a query parameter on the callback and is
 * re-validated there; nothing is trusted on the way back.
 */
export async function signInWithGoogleAction(
  _previous: AuthActionState,
  form: FormData,
): Promise<AuthActionState> {
  const env = getEnv();

  if (!env.AUTH_GOOGLE_ENABLED) {
    return { error: "Google sign-in is not available." };
  }

  const next = safeRedirectPath(readString(form, "next"), "/");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${env.APP_URL}/auth-callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    return { error: "Could not start Google sign-in. Try again." };
  }

  redirect(data.url);
}

/**
 * Finishes an account that arrived through a provider rather than the form.
 *
 * Google tells us who someone is, not what they came here to do, so the role
 * chips have to be asked for once. The role goes through the same closed enum
 * as the signup form — a provider sign-in is not a way around it.
 */
export async function completeProfileAction(
  _previous: AuthActionState,
  form: FormData,
): Promise<AuthActionState> {
  // The other way in: a provider round trip that finds no bound row lands on
  // /welcome, and this is what it posts to. Closing the email form alone would
  // leave it open.
  if (signupClosed()) {
    return { error: "This deployment is invitation only." };
  }

  const ctx = createRequestContext();
  const next = safeRedirectPath(readString(form, "next"), "/");
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/login");
  }

  const claims = data.claims as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    user_metadata?: { email_verified?: boolean; full_name?: string };
  };

  const email = (claims.email ?? "").trim().toLowerCase();
  const verified = claims.email_verified === true || claims.user_metadata?.email_verified === true;

  if (!claims.sub || !email) {
    return { error: "That sign-in did not include an email address." };
  }

  // The same rule as elsewhere: an address nobody has proven must not be able
  // to attach itself to an account that already exists under it.
  if (!verified) {
    return { error: "Confirm your email address with your provider, then try again." };
  }

  try {
    const role = parseSelfAssignableRole(readString(form, "role"));

    await signUp(ctx, {
      email,
      fullName: readString(form, "fullName"),
      role,
      authProviderSub: claims.sub,
      emailVerified: true,
    });
  } catch (caught) {
    if (caught instanceof ValidationError) {
      // An account under this address already exists, so this is not a first
      // sign-in at all — the domain refused the session for some other reason
      // (suspended, or issued before a revocation). There is nothing to finish
      // here, and leaving them on this page is a dead end, so end the session
      // and let the login screen say what it says.
      if (caught.issues?.["email"] === "taken") {
        await supabase.auth.signOut();
        redirect("/login?error=session");
      }

      return { error: caught.message, fieldErrors: caught.issues };
    }
    throw caught;
  }

  redirect(next);
}

/**
 * Remembers which of their roles a person is looking through.
 *
 * A preference, not a permission: `selectActiveRole` refuses a role they do not
 * hold, and every gate reads the roles themselves, so the worst a forged value
 * achieves is being ignored.
 */
export async function switchRoleAction(form: FormData): Promise<void> {
  const ctx = createRequestContext();
  const actor = await getActor(ctx);

  try {
    await writeActiveRole(selectActiveRole(actor, readString(form, "role")));
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error;
    return;
  }

  revalidatePath("/", "layout");
}

/**
 * Whether account creation is open on this deployment.
 *
 * An authorization decision, not a matter of what the screen offers. Both ways
 * in are gated on it and both gate *first*: `signUpAction` commits the domain
 * row before it reaches the provider, so refusing later still leaves rows
 * behind — unbounded, since neither path consumes a rate-limit bucket — and
 * `signUp` adopts any unverified row with no provider subject, which deletes
 * that row's roles. A closed deployment must therefore never reach either.
 */
function signupClosed(): boolean {
  return !getEnv().AUTH_SIGNUP_OPEN;
}

export async function signUpAction(
  _previous: AuthActionState,
  form: FormData,
): Promise<AuthActionState> {
  // Before anything is read, and long before anything is written.
  if (signupClosed()) {
    return { error: "This deployment is invitation only." };
  }

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
  // The next person at this browser starts from their own default rather than
  // inheriting a role chip from whoever signed out.
  await clearActiveRole();
  redirect("/login");
}
