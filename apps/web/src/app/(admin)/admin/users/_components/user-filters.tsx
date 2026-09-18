"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button, FilterBar, FilterChip, Input } from "@occasion/ui";
import type { UserFilter } from "@occasion/core";

/**
 * Narrowing the list.
 *
 * The four chips are the prototype's own — All accounts, Customers, Vendor
 * staff, Suspended (line 2624). The search beside them is an addition, recorded
 * in `docs/design-gaps.md`: the prototype's list is six fixed rows and never
 * needed one.
 *
 * The state lives in the query string, so the page re-renders on the server
 * with the filter applied, a filtered view has a link, and the back button does
 * what it looks like it does.
 */

export type FilterChoice = { value: UserFilter; label: string };

export function UserFilters({
  filter,
  search,
  choices,
}: {
  filter: UserFilter;
  search: string;
  /**
   * Built on the server. A client component importing a runtime value from the
   * `@occasion/core` barrel risks pulling the domain — and the table names in
   * it — into a browser chunk; a type-only import costs nothing.
   */
  choices: readonly FilterChoice[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  function go(next: URLSearchParams) {
    // The record's parameter and the page cursor are both dropped: a drawer
    // left open over a list that has just been refiltered may be showing
    // somebody no longer in it, and page 3 of the old filter is not page 3 of
    // the new one.
    next.delete("user");
    next.delete("cursor");
    const query = next.toString();
    router.push(query ? `/admin/users?${query}` : "/admin/users");
  }

  function selectFilter(value: UserFilter) {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete("filter");
    else next.set("filter", value);
    go(next);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams(params.toString());
    const typed = new FormData(event.currentTarget).get("q");
    const trimmed = typeof typed === "string" ? typed.trim() : "";
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");
    go(next);
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <FilterBar aria-label="Filter accounts">
        {choices.map((chip) => (
          <FilterChip
            key={chip.value}
            active={filter === chip.value}
            onSelect={() => selectFilter(chip.value)}
          >
            {chip.label}
          </FilterChip>
        ))}
      </FilterBar>

      <form onSubmit={submitSearch} className="flex items-end gap-2" role="search">
        {/* Uncontrolled and keyed on the term in the URL: the URL is the source
            of truth, so a remount is what makes the field follow a chip that
            cleared the search, rather than an effect racing the keystrokes. */}
        <Input
          key={search}
          id="user-search"
          name="q"
          type="search"
          label="Search"
          placeholder="Name or email"
          defaultValue={search}
          className="w-64"
        />
        <Button type="submit" intent="ghost">
          Search
        </Button>
      </form>
    </div>
  );
}
