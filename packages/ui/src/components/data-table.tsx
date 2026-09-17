import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { GlassPanel } from "./glass";

/**
 * One column spec, two layouts.
 *
 * The prototype renders admin orders twice — a desktop grid at lines 1796–1811
 * and a stack of cards at lines 1812–1827 — from the same six fields. Writing
 * both by hand is how the two drift, so a column here declares where it goes on
 * a phone and the mobile card is assembled from that.
 *
 * Deliberately not a `<table>`. The desktop layout is a CSS grid with
 * fractional columns (line 1798), which a table cannot do without fixed widths,
 * and the mobile layout is not tabular at all. Roles carry the semantics
 * instead, so both still announce as a table.
 */

export type ColumnSlot = "title" | "badge" | "body" | "meta" | "hidden";

export type Column<Row> = {
  /** Stable key, used for React and for the header cell. */
  key: string;
  header: string;
  /** Desktop track width, e.g. `0.8fr`. Line 1798: `0.8fr 1.5fr 0.8fr 1fr 0.9fr`. */
  width: string;
  render: (row: Row) => ReactNode;
  /**
   * Where this column goes on a phone.
   *
   * `title` and `badge` share the card's top line; `body` is the paragraph
   * under it; `meta` sits in the footer strip below the rule. `hidden` drops
   * the column, which is the honest option for something that only makes sense
   * next to five other columns.
   */
  mobile?: ColumnSlot;
  /** Right-aligned on desktop; totals read better against the next column. */
  align?: "start" | "end";
};

export type DataTableProps<Row> = {
  columns: ReadonlyArray<Column<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Announced to assistive technology as the table's name. */
  caption: string;
  onRowClick?: (row: Row) => void;
  /** What to show when there are no rows. Required: a table of headers and
   * nothing else tells a reader that the page is broken. */
  empty: ReactNode;
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  onRowClick,
  empty,
}: DataTableProps<Row>) {
  const template = columns.map((column) => column.width).join(" ");

  if (rows.length === 0) {
    return <>{empty}</>;
  }

  const slots = (slot: ColumnSlot) =>
    columns.filter((column) => (column.mobile ?? "body") === slot);

  return (
    <>
      {/* Desktop: the grid from line 1797. */}
      <GlassPanel as="section" className="hidden desk:block" aria-label={caption}>
        <div role="table" aria-label={caption}>
          <div
            role="row"
            className="oc-table-head grid gap-3 rounded-t-panel px-[18px] py-3"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((column) => (
              <span
                key={column.key}
                role="columnheader"
                className={cx(column.align === "end" && "text-right")}
              >
                {column.header}
              </span>
            ))}
          </div>

          {rows.map((row) => (
            <div
              key={rowKey(row)}
              role="row"
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      // A row that responds to a click has to respond to Enter
                      // and Space too, or the table is mouse-only. Only when
                      // the row itself has focus: keydown bubbles, so without
                      // this a button inside a cell would fire both its own
                      // action and the row's.
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={cx(
                "oc-table-row grid items-center gap-3 px-[18px] py-[13px]",
                onRowClick && "oc-table-row--link",
              )}
              style={{ gridTemplateColumns: template }}
            >
              {columns.map((column) => (
                <span
                  key={column.key}
                  role="cell"
                  className={cx("min-w-0", column.align === "end" && "text-right")}
                >
                  {column.render(row)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </GlassPanel>

      {/* Phone: the same rows as cards, from line 1813. */}
      <div className="grid gap-[10px] desk:hidden" role="list" aria-label={caption}>
        {rows.map((row) => (
          <article
            key={rowKey(row)}
            role="listitem"
            tabIndex={onRowClick ? 0 : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            // Same activation as the desktop row: a card that only responds to
            // a tap is unreachable from a keyboard or a switch device.
            onKeyDown={
              onRowClick
                ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }
                : undefined
            }
            className={cx("oc-glass rounded-row p-[15px]", onRowClick && "cursor-pointer")}
          >
            <div className="mb-2 flex items-baseline justify-between gap-[10px]">
              <span className="text-[14.5px] font-bold">
                {slots("title").map((column) => (
                  <span key={column.key}>{column.render(row)}</span>
                ))}
              </span>
              {slots("badge").map((column) => (
                <span key={column.key}>{column.render(row)}</span>
              ))}
            </div>

            {slots("body").map((column) => (
              <p key={column.key} className="mb-[9px] text-[14px] text-body">
                {column.render(row)}
              </p>
            ))}

            {slots("meta").length > 0 ? (
              <div className="flex justify-between gap-3 border-t border-hairline pt-[9px] text-row">
                {slots("meta").map((column) => (
                  <span key={column.key}>{column.render(row)}</span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}
