import { AdminPage } from "../../_components/admin-page";
import { ClearSecondFactorForm } from "../../_components/clear-second-factor-form";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { GlassPanel } from "@occasion/ui";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Users · Occasion admin" };

/**
 * Every account on the platform.
 *
 * The list itself is Phase 7. What is here already is account recovery, which
 * exists because enrolling a second factor can lock someone out and only an
 * administrator can clear it — it needed a home the moment `/admin` stopped
 * being a page.
 */
export default async function AdminUsersPage() {
  await requireAdminPage();

  return (
    <AdminPage
      title="Users"
      blurb="Every account on the platform: customers who book, and the people behind each vendor."
    >
      <GlassPanel as="section" className="p-6">
        <h2 className="m-0 text-[17px] font-bold">Account recovery</h2>
        <p className="mt-1 mb-0 max-w-[66ch] text-row text-body">
          Clears two-step verification for someone who has lost their authenticator, and ends their
          sessions. Confirm who they are first.
        </p>
        <ClearSecondFactorForm />
      </GlassPanel>
    </AdminPage>
  );
}
