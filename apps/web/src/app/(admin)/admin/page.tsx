import Link from "next/link";
import { requireAdminActor } from "../../../lib/auth-guard";
import { ClearSecondFactorForm } from "../_components/clear-second-factor-form";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · Occasion" };

/**
 * The administrator's landing page.
 *
 * `requireAdminActor()` first, in the page itself: the layout above redirects
 * for the sake of the browser, but it is not what decides. Every admin page,
 * action and route handler asks for itself.
 */
export default async function AdminHomePage() {
  const actor = await requireAdminActor();

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-3 text-sm opacity-70">
        Signed in as {actor.email}, holding {actor.roles.join(", ")}, viewing as {actor.activeRole}.
      </p>

      <ul className="mt-8 space-y-2 text-sm">
        <li>
          <Link href="/admin/vendors" className="underline underline-offset-4">
            Vendors
          </Link>
        </li>
      </ul>

      <section className="mt-12 border-t border-black/10 pt-6">
        <h2 className="text-sm font-semibold">Account recovery</h2>
        <p className="mt-1 text-sm opacity-70">
          Clears two-step verification for someone who has lost their authenticator, and ends their
          sessions. Confirm who they are first.
        </p>
        <ClearSecondFactorForm />
      </section>
    </main>
  );
}
