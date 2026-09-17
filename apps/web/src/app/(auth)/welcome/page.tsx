import { redirect } from "next/navigation";
import { safeRedirectPath } from "@occasion/core";
import { currentActor } from "../../../lib/auth-guard";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { WelcomeForm } from "../_components/welcome-form";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Finish setting up · Occasion" };

/**
 * The last step of a sign-in that started at a provider.
 *
 * A Google account proves an address; it does not create an account here. This
 * page exists so that the role is asked for once, through the same closed set
 * the signup form uses — a provider sign-in must not be a way to arrive with a
 * role nobody chose, or with none at all.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params["next"], "/");

  // Already known here: nothing to finish.
  const actor = await currentActor();
  if (actor.kind === "user") {
    redirect(next);
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as
    { email?: string; user_metadata?: { full_name?: string; name?: string } } | undefined;

  if (!claims?.email) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  return (
    <main className="mx-auto max-w-md px-4 py-24">
      <h1 className="text-2xl font-semibold">One more thing</h1>
      <p className="mt-3 mb-8 text-sm opacity-70">
        Tell us how you plan to use Occasion and we will finish setting up your account.
      </p>

      <WelcomeForm
        email={claims.email}
        suggestedName={claims.user_metadata?.full_name ?? claims.user_metadata?.name ?? ""}
        next={next}
      />
    </main>
  );
}
