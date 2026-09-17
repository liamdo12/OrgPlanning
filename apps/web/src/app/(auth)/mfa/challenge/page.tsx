import { redirect } from "next/navigation";
import { safeRedirectPath } from "@occasion/core";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { MfaChallengeForm } from "../../_components/mfa-challenge-form";
import { signOutAction } from "../../actions";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Enter your code · Occasion" };

/**
 * The second step, between a correct password and a usable session.
 *
 * This page cannot ask the domain who the caller is — an unanswered challenge
 * is exactly what makes `getActor` report them as anonymous — so it works from
 * the provider session directly. That is safe here because it decides nothing:
 * it renders a form, and the verification is the provider's own.
 */
export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params["next"], "/");

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const { data } = await supabase.auth.mfa.listFactors();
  const factor = (data?.all ?? []).find((candidate) => candidate.status === "verified");

  // Nothing to answer: either the factor was removed elsewhere, or the session
  // already cleared it.
  if (!factor) {
    redirect(next);
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-24">
      <h1 className="text-2xl font-semibold">Enter your code</h1>
      <p className="mt-3 mb-8 text-sm opacity-70">
        Open your authenticator app and enter the six-digit code for Occasion.
      </p>

      <MfaChallengeForm factorId={factor.id} next={next} />

      <form action={signOutAction} className="mt-6 text-center">
        <button type="submit" className="text-sm underline underline-offset-4 opacity-70">
          Sign in as someone else
        </button>
      </form>
    </main>
  );
}
