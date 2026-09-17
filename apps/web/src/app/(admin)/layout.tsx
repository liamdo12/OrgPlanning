import type { ReactNode } from "react";
import { requireAdminPage } from "../../lib/auth-guard";
import { AdminShell } from "./_components/admin-shell";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

/**
 * Sends a non-admin somewhere useful, and draws the shell. **This is not the
 * security boundary.**
 *
 * Next.js does not re-run a layout on client-side navigation between its own
 * segments, a layout does not control whether nested segments render, and it
 * does not run at all for a server action or a route handler. Relying on this
 * to protect admin functionality would leave every admin action open to a
 * direct POST.
 *
 * The real gate is `requireAdminActor()` in `src/lib/auth-guard.ts`, which
 * every admin action, route handler and page calls for itself. This redirect
 * exists so that a customer who follows an admin link lands on the login page
 * instead of an error.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const actor = await requireAdminPage();

  return (
    <AdminShell email={actor.email} roles={actor.roles} activeRole={actor.activeRole}>
      {children}
    </AdminShell>
  );
}
