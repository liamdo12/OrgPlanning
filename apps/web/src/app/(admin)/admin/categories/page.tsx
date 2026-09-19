import { EmptyState, GlassPanel } from "@occasion/ui";
import { listCategoriesForAdmin } from "@occasion/core";
import { AdminPage } from "../../_components/admin-page";
import { requireAdminPage } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { CategoryList } from "./_components/category-list";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Categories · Occasion admin" };

/**
 * What a service can be filed under.
 *
 * A screen the prototype never drew: it renders six categories it holds in an
 * array (`cats()`, lines 1967–1973) and offers no way to change them. The six
 * are seeded from exactly that array, tile colours included, so the discovery
 * screens still match it once they exist.
 *
 * Deleting one that has listings is refused rather than cascaded, and the
 * refusal says to deactivate instead — which is what the person reaching for
 * delete almost always meant.
 */
export default async function AdminCategoriesPage() {
  const actor = await requireAdminPage();
  const ctx = createRequestContext();

  const categories = await listCategoriesForAdmin(ctx, actor);

  return (
    <AdminPage
      title="Categories"
      blurb="What a service can be filed under, and the order they are offered in. A category with listings cannot be deleted — deactivate it instead, and the listings keep it."
    >
      {categories.length === 0 ? (
        <EmptyState
          title="No categories"
          blurb="Nothing can be listed until there is something to list it under."
        />
      ) : (
        <GlassPanel as="section" aria-label="Categories">
          <CategoryList categories={categories} />
        </GlassPanel>
      )}
    </AdminPage>
  );
}
