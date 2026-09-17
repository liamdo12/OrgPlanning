import { redirect } from "next/navigation";
import { isUsable } from "@occasion/core";
import { currentActor } from "../../../lib/auth-guard";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { MfaSetup } from "../_components/mfa-setup";
import { disableSecondFactorAction } from "./actions";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Two-step verification · Occasion" };

/**
 * Where two-step verification is turned on and off.
 *
 * Offered, never required: nothing in the application refuses an account
 * without a factor. Once one exists, though, every session has to clear it —
 * the requirement lives on our own row, so removing it here is the only way
 * back out.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `isUsable`, not just "signed in": a suspended or still-unverified account
  // must not be able to attach a factor to itself, and the actions behind this
  // page refuse it anyway.
  if (!isUsable(await currentActor())) {
    redirect("/login?next=/mfa");
  }

  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.all ?? []).filter((factor) => factor.status === "verified");

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Two-step verification</h1>

      {params["enabled"] ? (
        <p role="status" className="mt-3 text-sm">
          Two-step verification is on. You will be asked for a code each time you sign in.
        </p>
      ) : null}
      {params["disabled"] ? (
        <p role="status" className="mt-3 text-sm">
          Two-step verification is off.
        </p>
      ) : null}
      {params["error"] === "provider" ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          We stopped requiring a code, but your authenticator could not be removed. You may still be
          asked for one — try again.
        </p>
      ) : null}

      <section className="mt-8">
        {verified.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm opacity-70">
              An authenticator app is protecting this account. Keep a recovery plan: without the app
              you cannot sign in, and an administrator has to clear the factor for you.
            </p>
            <form action={disableSecondFactorAction}>
              <button
                type="submit"
                className="rounded-2xl border border-black/20 px-4 py-3 text-sm font-semibold"
              >
                Turn off two-step verification
              </button>
            </form>
          </div>
        ) : (
          <MfaSetup />
        )}
      </section>
    </main>
  );
}
