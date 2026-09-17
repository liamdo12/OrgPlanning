import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { isAdminRequest, requireAdminActor } from "../../lib/auth-guard";
import { signOutAction } from "../(auth)/actions";
import { AppBackground, GlassChrome } from "@occasion/ui";
import { RoleSwitcher } from "./_components/role-switcher";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

/**
 * Sends a non-admin somewhere useful, and draws the chrome. **This is not the
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
  if (!(await isAdminRequest())) {
    redirect("/login?next=/admin");
  }

  // Past the redirect, so the gate has already answered yes.
  const actor = await requireAdminActor();

  return (
    // The admin theme, applied once at the top: every surface below reads the
    // same three variables. Line 1995.
    <AppBackground role="admin">
      <GlassChrome
        as="header"
        className="sticky top-0 z-40 flex flex-wrap items-center gap-4 border-b border-hairline px-4 py-3"
      >
        <Link href="/admin" className="font-display text-[19px] text-ink">
          Occasion admin
        </Link>
        <nav className="flex gap-4 text-row text-body">
          <Link href="/admin/vendors">Vendors</Link>
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <RoleSwitcher roles={actor.roles} active={actor.activeRole} />
          <span className="text-badge text-body">{actor.email}</span>
          <Link href="/mfa" className="text-badge underline underline-offset-4">
            Security
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="text-badge text-body underline underline-offset-4">
              Sign out
            </button>
          </form>
        </div>
      </GlassChrome>

      {children}
    </AppBackground>
  );
}
