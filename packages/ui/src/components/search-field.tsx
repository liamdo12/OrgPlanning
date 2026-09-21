"use client";

import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * The header search control, in its two halves.
 *
 * `SearchPill` is the row of segments at line 226: a glass pill holding one
 * button per field, each showing a small uppercase label over the current
 * value, and a round submit button at the end. `SearchPanelGroup` is what one
 * of those segments opens onto, lines 285–371.
 *
 * Both take values and callbacks and know nothing about services, events or
 * URLs. The pill in particular renders what it is given and holds no state of
 * its own — which is the point: the search lives in the URL, and a pill with
 * its own copy is a control that can disagree with the page beside it.
 */

export type SearchSegment = {
  /** Stable key, also what `activeKey` names. */
  key: string;
  /** The small uppercase caption, e.g. "Where". */
  label: string;
  /** The current selection, rendered large. Never empty — pass a default. */
  value: string;
  /** Widths are the prototype's own: What grows, the rest are content-sized. */
  grow?: boolean;
  onOpen: () => void;
};

export function SearchPill({
  segments,
  activeKey,
  submitLabel = "Search",
  onSubmit,
  className,
}: {
  segments: readonly SearchSegment[];
  /** Which segment's panel is open, so the pill can show where you are. */
  activeKey?: string | undefined;
  submitLabel?: string;
  onSubmit: () => void;
  className?: string;
}) {
  return (
    // Line 226: a glass pill with a 4px inset, its segments divided by the
    // same hairline the rest of the chrome uses.
    <div
      className={cx(
        "oc-glass flex min-w-0 flex-1 items-stretch rounded-pill py-[4px] pr-[4px] pl-[6px]",
        className,
      )}
    >
      {segments.map((segment) => (
        <button
          key={segment.key}
          type="button"
          onClick={segment.onOpen}
          aria-expanded={activeKey === segment.key}
          className={cx(
            "min-w-0 cursor-pointer rounded-pill border-0 border-r border-hairline px-[14px] py-[6px] text-left last:border-r-0",
            segment.grow ? "flex-[1_1_auto]" : "flex-none",
            activeKey === segment.key ? "bg-role-tint" : "bg-transparent",
          )}
        >
          {/* Line 230: 10.5px/700 uppercase — the same size as a tab label,
              which is why it reuses that token rather than adding a third. */}
          <span className="block text-tab font-bold tracking-[0.07em] text-body uppercase">
            {segment.label}
          </span>
          <span className="block truncate text-[14px] font-semibold">{segment.value}</span>
        </button>
      ))}

      <button
        type="button"
        onClick={onSubmit}
        // The prototype labels this control and shows only the glyph (line
        // 234); without the label it would have no accessible name at all.
        aria-label={submitLabel}
        className="ml-[6px] grid size-[36px] flex-none cursor-pointer place-items-center self-center rounded-pill border-0 bg-role text-surface"
      >
        <SearchGlyph size={16} />
      </button>
    </div>
  );
}

/**
 * The compact control below the pill's breakpoint, line 246.
 *
 * Same submission, one button: the four segments do not fit, so the whole
 * control opens every panel at once instead of one.
 */
export function SearchButton({
  value,
  summary,
  expanded,
  onOpen,
  className,
}: {
  /** The headline selection, usually the category. */
  value: string;
  /** The rest of the search, in one line. */
  summary: string;
  expanded: boolean;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={expanded}
      className={cx(
        "oc-glass flex min-w-0 flex-1 cursor-pointer items-center gap-[10px] rounded-pill px-[14px] py-[9px] text-left",
        className,
      )}
    >
      <span className="grid size-[24px] flex-none place-items-center rounded-pill bg-role text-surface">
        <SearchGlyph size={13} />
      </span>
      <span className="min-w-0 overflow-hidden">
        <span className="block truncate text-[13.5px] font-semibold">{value}</span>
        <span className="block truncate text-[11.5px] text-body">{summary}</span>
      </span>
    </button>
  );
}

/**
 * One labelled group inside the search panel.
 *
 * The heading is a `<legend>` inside a `<fieldset>`, not the prototype's bare
 * `<p>` (line 287). A `<p>` above a row of buttons has no programmatic
 * association with them at all, so a screen reader reads seven category names
 * with nothing saying what they are for.
 */
export function SearchPanelGroup({
  legend,
  children,
  className,
}: {
  legend: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cx("m-0 min-w-0 border-0 p-0", className)}>
      <legend className="mb-[11px] p-0 text-label font-bold tracking-[0.08em] text-body uppercase">
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * A choice inside a panel: the pill-shaped options at lines 289, 331 and 366.
 *
 * `aria-pressed` rather than a `role="radio"` group, because these are toggles
 * that submit nothing on their own and a radio group would take arrow-key
 * navigation and a required selection with it.
 */
export function SearchOption({
  label,
  selected,
  onSelect,
  className,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx("oc-chip", className)}
    >
      {label}
    </button>
  );
}

/** Source: the magnifier at lines 234 and 248. */
function SearchGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.4 15.4 4.1 4.1" />
    </svg>
  );
}
