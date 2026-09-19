"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FilterBar, FilterChip } from "@occasion/ui";

/**
 * Narrowing the queue.
 *
 * The state lives in the query string rather than in this component, so the
 * page re-renders on the server with the filter applied, a filtered view has a
 * link, and the back button does what it looks like it does.
 */

export type FilterChoice = { value: string; label: string; count: number };

export function ReportFilters({
  active,
  choices,
}: {
  active: string;
  /**
   * The chips, built on the server from the domain's own list of targets.
   *
   * Passed in rather than imported, because this is a client component and
   * `@occasion/core` is a barrel that re-exports modules importing the database
   * schema.
   */
  choices: readonly FilterChoice[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  function select(value: string) {
    const next = new URLSearchParams(params.toString());
    // The cursor names a row in the list that was; carried into a different
    // filter it starts the new one somewhere arbitrary.
    next.delete("after");
    if (value === "open") next.delete("show");
    else next.set("show", value);

    const query = next.toString();
    router.push(query ? `/admin/moderation?${query}` : "/admin/moderation");
  }

  return (
    <FilterBar aria-label="Filter reports">
      {choices.map((chip) => (
        <FilterChip
          key={chip.value}
          active={active === chip.value}
          onSelect={() => select(chip.value)}
        >
          {chip.label}
          <span className="ml-2 opacity-70">{chip.count}</span>
        </FilterChip>
      ))}
    </FilterBar>
  );
}
