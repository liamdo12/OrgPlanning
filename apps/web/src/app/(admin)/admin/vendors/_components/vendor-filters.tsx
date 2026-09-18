"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button, FilterBar, FilterChip, Input } from "@occasion/ui";
import type { VendorStatus } from "@occasion/core";

/**
 * Narrowing the queue.
 *
 * Neither the chips nor the search exist in the prototype — its list is six
 * fixed rows. Both are recorded in `docs/design-gaps.md`: a real queue has
 * every business on the platform in it, and an approval queue you cannot filter
 * to the applications waiting is not a queue.
 *
 * The state lives in the query string rather than in this component, so the
 * page re-renders on the server with the filter applied, a filtered view has a
 * link, and the back button does what it looks like it does.
 */

export type FilterChoice = { value: VendorStatus | "all"; label: string };

export function VendorFilters({
  status,
  search,
  choices,
  counts,
  total,
}: {
  status: VendorStatus | "all";
  search: string;
  /**
   * The chips, built on the server from the domain's own list of statuses.
   *
   * Passed in rather than imported, because this is a client component and
   * `@occasion/core` is a barrel that re-exports modules importing the database
   * schema. A type-only import costs nothing at runtime; a value one risks
   * pulling the domain — and the table names in it — into a browser chunk.
   */
  choices: readonly FilterChoice[];
  counts: Record<VendorStatus, number>;
  total: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function go(next: URLSearchParams) {
    // The record's own parameter is dropped: a drawer left open over a list
    // that has just been refiltered may be showing a vendor no longer in it.
    next.delete("vendor");
    const query = next.toString();
    router.push(query ? `/admin/vendors?${query}` : "/admin/vendors");
  }

  function selectStatus(value: VendorStatus | "all") {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete("status");
    else next.set("status", value);
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
      <FilterBar aria-label="Filter vendors by status">
        {choices.map((chip) => (
          <FilterChip
            key={chip.value}
            active={status === chip.value}
            onSelect={() => selectStatus(chip.value)}
          >
            {chip.label}
            <span className="ml-2 opacity-70">
              {chip.value === "all" ? total : counts[chip.value]}
            </span>
          </FilterChip>
        ))}
      </FilterBar>

      <form onSubmit={submitSearch} className="flex items-end gap-2" role="search">
        {/* Uncontrolled, keyed on the term in the URL. The URL is the source of
            truth, so the field has to follow a chip that cleared the search or
            a back navigation — and keying it means a remount does that, rather
            than an effect racing the keystrokes. */}
        <Input
          key={search}
          id="vendor-search"
          name="q"
          type="search"
          label="Search"
          placeholder="Name, category or area"
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
