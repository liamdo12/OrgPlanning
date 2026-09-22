import Link from "next/link";
import type { BrowseCategory } from "@occasion/core";

/**
 * Browse by category. Lines 611–619.
 *
 * A tone block, the name, and how many services are listed under it.
 *
 * **The count is the real one**, over listings a visitor could open right now:
 * an approved business with a published listing. `categories.display_count` is
 * an operator's own editable number and is deliberately not what the domain
 * returns — a tile reading "12 services" over a category whose only listings
 * are drafts sends everybody who taps it to an empty page with no explanation.
 * Zero is an ordinary answer and the tile says it.
 *
 * Links, not buttons: each one is a destination with an address, and the
 * canvas's `onClick` (line 613) is a click handler where a URL was meant.
 */
export function CategoryTiles({ categories }: { categories: readonly BrowseCategory[] }) {
  return (
    <div className="grid gap-[12px] [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
      {categories.map((category) => (
        <Link
          key={category.id}
          href={`/services?cat=${encodeURIComponent(category.slug)}`}
          className="oc-glass rounded-row p-[14px] no-underline hover:border-role hover:no-underline"
        >
          <span
            aria-hidden="true"
            className="mb-[11px] block h-[52px] rounded-tile"
            // The gradient is the category's own column, written by the seed
            // from the canvas's palette (lines 1967–1973). A table of hex
            // values here would be a second copy of it.
            style={{ background: category.tone ?? "#E4E0D3" }}
          />
          <span className="block text-[14.5px] font-bold text-ink">{category.name}</span>
          <span className="block text-[12.5px] text-body">
            {category.serviceCount} {category.serviceCount === 1 ? "service" : "services"}
          </span>
        </Link>
      ))}
    </div>
  );
}
