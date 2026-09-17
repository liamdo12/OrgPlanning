"use client";

import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * A filter chip.
 *
 * Line 1669 for the shape, line 2626 for the two states: inactive is a faint
 * glass fill with a soft edge, active is a solid role fill. The prototype
 * carries both as inline colours on every chip; here the active state is
 * `aria-pressed`, so assistive technology is told what the fill is saying.
 *
 * A toggle, so it is a button rather than a link even when it drives a query
 * parameter — the caller decides what pressing it does.
 */
export function FilterChip({
  active = false,
  onSelect,
  className,
  children,
}: {
  active?: boolean;
  onSelect?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cx("oc-chip", className)}
    >
      {children}
    </button>
  );
}

/** A row of chips. Line 1667: 8px gaps, wrapping. */
export function FilterBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="group" className={cx("flex flex-wrap gap-2", className)}>
      {children}
    </div>
  );
}
