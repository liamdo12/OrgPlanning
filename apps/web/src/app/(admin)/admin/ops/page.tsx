import { EmptyState } from "@occasion/ui";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Automations · Occasion admin" };

/**
 * The route exists so the navigation is whole and the shell can be walked end
 * to end; the screen itself is phase 10. It says so rather than showing a
 * plausible-looking table of nothing.
 */
export default async function AdminOpsPage() {
  await requireAdminPage();

  return (
    <AdminPage
      title="Automations"
      blurb="The four things the platform runs on a timer, what is queued, and the clock override that replays any of them now."
    >
      <EmptyState
        title="Not built yet"
        blurb="This screen lands in phase 10. The navigation, the shell and the gate around it are already here."
      />
    </AdminPage>
  );
}
