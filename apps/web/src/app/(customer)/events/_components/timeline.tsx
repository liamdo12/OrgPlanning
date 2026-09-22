import type { ReactNode } from "react";

/**
 * A fixed time column and what happens at it, lines 917–922.
 *
 * Route-local: the day-of schedule is the only consumer, and a second one is
 * what would make it shared.
 *
 * A description list rather than a run of paragraphs with two spans, so the
 * time and the thing that happens at it are read as a pair instead of as four
 * separate sentences.
 */
export function Timeline({ entries }: { entries: ReadonlyArray<{ time: string; what: ReactNode }> }) {
  return (
    <dl className="m-0">
      {entries.map((entry, index) => (
        <div
          key={`${entry.time}-${index}`}
          className="flex gap-[14px] border-b border-hairline py-[9px] text-[14px] last:border-b-0"
        >
          <dt className="w-[66px] flex-none font-bold">{entry.time}</dt>
          <dd className="m-0 text-body">{entry.what}</dd>
        </div>
      ))}
    </dl>
  );
}
