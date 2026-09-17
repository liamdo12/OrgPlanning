"use server";

import { redirect } from "next/navigation";
import {
  RateLimitedError,
  SECOND_FACTOR_RULE,
  clearAttempts,
  consumeAttempt,
  getActor,
  isUsable,
  safeRedirectPath,
  setSecondFactorEnrolled,
} from "@occasion/core";
import { createRequestContext } from "../../../lib/core";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { readString } from "../../../lib/form-values";

/**
 * Two-step verification.
 *
 * Enrolling is the account holder's own choice — nothing in this application
 * requires it, which is the accepted risk recorded in the plan. What is not
 * optional is using a factor once it exists: verifying enrolment sets
 * `users.mfa_enrolled_at`, and from then on `getActor` refuses any session that
 * has not cleared the challenge.
 *
 * Every action here establishes the caller before it touches the provider. A
 * server action is reachable by a direct POST that renders no page, so the
 * `/mfa` page's own check protects nothing; and a provider session outlives our
 * opinion of an account — the provider knows nothing about suspension — so
 * "holds a session" is not "may change their factors".
 *
 * The order the two sides are written in is deliberate, and it is not the same
 * in both directions:
 *
 *   Enrolling — provider first. It verifies the factor, which raises the
 *   session; only then is the requirement recorded. Recording it first would
 *   lock the person out of the session they are enrolling from.
 *
 *   Removing — our row first. A leftover provider factor only produces a
 *   challenge they can still answer; a leftover requirement with no factor
 *   behind it is a challenge nobody can answer, and only an administrator can
 *   undo that.
 */

export type EnrolmentState = {
  error?: string;
  /** Present once enrolment has started and the code is being confirmed. */
  factorId?: string;
  /** An SVG data URI from the provider, shown as a QR code. */
  qrCode?: string;
  /** The same secret in text, for an authenticator that cannot scan. */
  secret?: string;
};

export type ChallengeState = {
  error?: string;
};

/** Checked before an attempt is counted, so noise cannot spend the budget. */
const CODE = /^\d{6}$/;

const SIGN_IN_AGAIN = "Sign in again to change two-step verification.";

/**
 * The provider subject for this request, from the verified token.
 *
 * This is the rate-limit bucket. It has to be something the caller cannot
 * choose: keyed on a form field instead, anyone able to post the form writes
 * one counter row per made-up value, without an account.
 */
async function providerSubject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<string | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const sub = (data.claims as { sub?: string }).sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

export async function startEnrolmentAction(_previous: EnrolmentState): Promise<EnrolmentState> {
  const ctx = createRequestContext();
  if (!isUsable(await getActor(ctx))) {
    return { error: SIGN_IN_AGAIN };
  }

  const supabase = await createSupabaseServerClient();

  // The QR code is handed out once, at enrolment. A factor left unverified by
  // an abandoned attempt can therefore never be completed — it would only
  // collide on its name — so clear those out before starting a fresh one.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Authenticator app",
  });

  if (error || !data) {
    return { error: "Could not start setup. Try again." };
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export async function confirmEnrolmentAction(
  _previous: EnrolmentState,
  form: FormData,
): Promise<EnrolmentState> {
  const ctx = createRequestContext();
  const actor = await getActor(ctx);
  const factorId = readString(form, "factorId");
  const code = readString(form, "code").trim();

  const carried: EnrolmentState = { factorId, secret: readString(form, "secret") };

  if (!isUsable(actor)) {
    return { ...carried, error: SIGN_IN_AGAIN };
  }

  if (!factorId || !CODE.test(code)) {
    return { ...carried, error: "Enter the six-digit code from your authenticator." };
  }

  const supabase = await createSupabaseServerClient();
  const subject = await providerSubject(supabase);
  if (!subject) {
    return { ...carried, error: SIGN_IN_AGAIN };
  }

  try {
    await consumeAttempt(ctx, SECOND_FACTOR_RULE, `sub:${subject}`);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { ...carried, error: "Too many attempts. Try again in a few minutes." };
    }
    throw error;
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) {
    return {
      ...carried,
      error: "That code was not accepted. Codes expire quickly — try the next one.",
    };
  }

  // Verified, so the session now carries the second level. Recording the
  // requirement here is what makes every later session answer the challenge.
  await setSecondFactorEnrolled(ctx, actor, true);
  await clearAttempts(ctx, SECOND_FACTOR_RULE, `sub:${subject}`);

  redirect("/mfa?enabled=1");
}

/**
 * Turns two-step verification off.
 *
 * Our row is cleared first, for the reason given at the top of this file. If
 * the provider then refuses to drop a factor the person is told, because a
 * surviving factor means they will still be asked for a code.
 */
export async function disableSecondFactorAction(): Promise<void> {
  const ctx = createRequestContext();
  const actor = await getActor(ctx);

  if (!isUsable(actor)) {
    redirect("/login?next=/mfa");
  }

  await setSecondFactorEnrolled(ctx, actor, false);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.listFactors();

  if (error) {
    redirect("/mfa?error=provider");
  }

  for (const factor of data.all) {
    const { error: unenrolError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrolError) {
      redirect("/mfa?error=provider");
    }
  }

  redirect("/mfa?disabled=1");
}

/** Answers the challenge that stands between a password and a session. */
export async function verifyChallengeAction(
  _previous: ChallengeState,
  form: FormData,
): Promise<ChallengeState> {
  const ctx = createRequestContext();
  const factorId = readString(form, "factorId");
  const code = readString(form, "code").trim();
  const next = safeRedirectPath(readString(form, "next"), "/");

  if (!factorId || !CODE.test(code)) {
    return { error: "Enter the six-digit code from your authenticator." };
  }

  const supabase = await createSupabaseServerClient();

  // There is no domain actor to ask for here: an unanswered challenge is
  // exactly what makes this caller anonymous. The verified token still names
  // them, which is enough to count attempts against the right bucket.
  const subject = await providerSubject(supabase);
  if (!subject) {
    redirect("/login");
  }

  try {
    // Six digits valid for about a minute is guessable without this.
    await consumeAttempt(ctx, SECOND_FACTOR_RULE, `sub:${subject}`);
  } catch (error) {
    if (error instanceof RateLimitedError) {
      return { error: "Too many attempts. Try again in a few minutes." };
    }
    throw error;
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  if (error) {
    return { error: "That code was not accepted. Codes expire quickly — try the next one." };
  }

  await clearAttempts(ctx, SECOND_FACTOR_RULE, `sub:${subject}`);
  redirect(next);
}
