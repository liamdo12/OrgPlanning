"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FilterBar, FilterChip } from "@occasion/ui";
import type { DisputeState } from "@occasion/core";

/**
 * Narrowing the queue.
 *
 * The state lives in the query string rather than in this component, so the
 * page re-renders on the server with the filter applied, a filtered view has a
 * link, and the back button does what it looks like it does.
 */

export type FilterChoice = { value: DisputeState | "all" | "unassigned"; label: string };

export function DisputeFilters({
  active,
  choices,
  counts,
  total,
  unassigned,
}: {
  active: string;
  /**
   * The chips, built on the server from the domain's own list of states.
   *
   * Passed in rather than imported, because this is a client component and
   * `@occasion/core` is a barrel that re-exports modules importing the database
   * schema. A type-only import costs nothing at runtime; a value one risks
   * pulling the domain — and the table names in it — into a browser chunk.
   */
  choices: readonly FilterChoice[];
  counts: Record<DisputeState, number>;
  total: number;
  unassigned: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function select(value: string) {
    const next = new URLSearchParams(params.toString());
    // The case's own parameter is dropped: a record left open over a list that
    // has just been refiltered may be showing a case no longer in it. The page
    // cursor goes with it — it names a row in the list that was, and carried
    // into a different filter it starts the new one somewhere arbitrary.
    next.delete("case");
    next.delete("after");
    if (value === "all") next.delete("state");
    else next.set("state", value);

    const query = next.toString();
    router.push(query ? `/admin/disputes?${query}` : "/admin/disputes");
  }

  function countFor(choice: FilterChoice): number {
    if (choice.value === "all") return total;
    if (choice.value === "unassigned") return unassigned;
    return counts[choice.value];
  }

  return (
    <FilterBar aria-label="Filter complaints">
      {choices.map((chip) => (
        <FilterChip
          key={chip.value}
          active={active === chip.value}
          onSelect={() => select(chip.value)}
        >
          {chip.label}
          <span className="ml-2 opacity-70">{countFor(chip)}</span>
        </FilterChip>
      ))}
    </FilterBar>
  );
}
