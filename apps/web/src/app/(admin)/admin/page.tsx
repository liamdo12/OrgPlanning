import Link from "next/link";
import { GlassPanel, PageHeader } from "@occasion/ui";
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
    <main className="mx-auto max-w-5xl px-4 py-12">
      <PageHeader
        title="Admin"
        blurb={`Signed in as ${actor.email}, holding ${actor.roles.join(", ")}, viewing as ${actor.activeRole}.`}
      />

      <ul className="m-0 grid list-none gap-2 p-0 text-row">
        <li>
          <Link href="/admin/vendors" className="underline underline-offset-4">
            Vendors
          </Link>
        </li>
      </ul>

      <GlassPanel as="section" className="mt-10 p-6">
        <h2 className="m-0 text-[17px] font-bold">Account recovery</h2>
        <p className="mt-1 mb-0 max-w-[66ch] text-row text-body">
          Clears two-step verification for someone who has lost their authenticator, and ends their
          sessions. Confirm who they are first.
        </p>
        <ClearSecondFactorForm />
      </GlassPanel>
    </main>
  );
}
