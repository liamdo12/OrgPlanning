import { EmptyState } from "@occasion/ui";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Email · Occasion admin" };

/**
 * The route exists so the navigation is whole and the shell can be walked end
 * to end; the screen itself is phase 11. It says so rather than showing a
 * plausible-looking table of nothing.
 */
export default async function AdminEmailPage() {
  await requireAdminPage();

  return (
    <AdminPage
      title="Email"
      blurb="Templates, audiences and the send log — with consent checked per recipient before anything leaves."
    >
      <EmptyState
        title="Not built yet"
        blurb="This screen lands in phase 11. The navigation, the shell and the gate around it are already here."
      />
    </AdminPage>
  );
}
