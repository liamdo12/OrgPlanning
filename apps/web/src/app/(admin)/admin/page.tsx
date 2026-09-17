import { redirect } from "next/navigation";
import { requireAdminPage } from "../../../lib/auth-guard";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

/**
 * `/admin` is not a screen.
 *
 * The prototype opens an administrator on Vendors — it is the first entry in
 * `routesFor('admin')` (line 1979) and the queue with work waiting in it. A
 * dashboard that summarised the other four would be a fifth thing to keep
 * current for no decision anyone makes from it.
 *
 * The gate runs first even though this only redirects: the destination checks
 * for itself too, but a redirect that leaks whether `/admin` exists is a
 * needless difference between an administrator and everybody else.
 */
export default async function AdminIndexPage() {
  await requireAdminPage();
  redirect("/admin/vendors");
}
