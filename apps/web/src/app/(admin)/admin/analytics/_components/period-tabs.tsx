"use client";

import { useRouter } from "next/navigation";
import { FilterBar, FilterChip } from "@occasion/ui";

/**
 * Which period the figures cover.
 *
 * In the query string rather than in this component, so the page re-renders on
 * the server with the window applied and a view somebody is looking at has a
 * link they can send.
 */

export type PeriodChoice = { value: string; label: string };

export function PeriodTabs({
  active,
  choices,
}: {
  active: string;
  /** Built on the server from the domain's own list, so the two cannot drift. */
  choices: readonly PeriodChoice[];
}) {
  const router = useRouter();

  return (
    <FilterBar aria-label="Period">
      {choices.map((choice) => (
        <FilterChip
          key={choice.value}
          active={active === choice.value}
          onSelect={() => router.push(`/admin/analytics?period=${choice.value}`)}
        >
          {choice.label}
        </FilterChip>
      ))}
    </FilterBar>
  );
}
