import { EmptyState } from "@occasion/ui";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Orders and payments · Occasion admin" };

/**
 * The route exists so the navigation is whole and the shell can be walked end
 * to end; the screen itself is phase 9. It says so rather than showing a
 * plausible-looking table of nothing.
 */
export default async function AdminOrdersPage() {
  await requireAdminPage();

  return (
    <AdminPage
      title="Orders and payments"
      blurb="Every order on the platform, what has been paid, and what the platform and each vendor earned from it."
    >
      <EmptyState
        title="Not built yet"
        blurb="This screen lands in phase 9. The navigation, the shell and the gate around it are already here."
      />
    </AdminPage>
  );
}
