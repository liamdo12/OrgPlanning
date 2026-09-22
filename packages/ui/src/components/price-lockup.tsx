import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * What a booking costs, said once.
 *
 * Lines 841–847: a hairline above the block, then labelled rows — the line
 * itself, the tax, the total, the deposit taken now and the balance and its
 * date. The checkout summary draws the same shape with its last two rows in a
 * sub-panel (lines 1169–1185), which is what `group` is for.
 *
 * **A description list, not a run of `<p>`s with two spans.** The prototype's
 * markup reads as five labels followed by five numbers, because nothing ties a
 * label to the amount beside it; `<dt>`/`<dd>` pairs are read together, which
 * is the whole point of saying the deposit out loud.
 *
 * **Every amount arrives as a formatted string.** This package may not import
 * `@occasion/core`, and there is exactly one money formatter in the repository
 * — `formatMoney`, which the app calls at the edge. A component that took cents
 * would be a second formatting path in the layer that must have one.
 */

export type PriceRow = {
  label: ReactNode;
  /** Already formatted: `C$1,234.56`. Never cents, never a rate. */
  value: string;
  /**
   * `total` is the summed line, which the canvas rules off and bolds (line 844).
   * `role` is the deposit, which it colours (line 845) — drawn in the hover
   * token rather than the role primary, because role green as *text* over the
   * ambient gradient measures 4.35:1 and does not clear AA.
   */
  emphasis?: "total" | "role" | undefined;
  /** A second line under the label, e.g. why the whole amount is taken now. */
  note?: ReactNode | undefined;
};

export function PriceLockup({
  rows,
  group,
  className,
}: {
  rows: readonly PriceRow[];
  /** The checkout's deposit/balance panel: the same rows on a washed fill. */
  group?: readonly PriceRow[] | undefined;
  className?: string;
}) {
  return (
    <dl
      className={cx("m-0 grid gap-[7px] border-t border-hairline pt-[14px] text-[14px]", className)}
    >
      {rows.map((row, index) => (
        <Row key={index} row={row} />
      ))}

      {group && group.length > 0 ? (
        // A nested `<div>` inside a `<dl>` is what the spec allows for grouping,
        // and the wash is the canvas's own sub-panel fill (line 1176).
        <div className="mt-[7px] grid gap-[7px] rounded-card bg-glass-wash px-[13px] py-[11px]">
          {group.map((row, index) => (
            <Row key={index} row={row} />
          ))}
        </div>
      ) : null}
    </dl>
  );
}

function Row({ row }: { row: PriceRow }) {
  const total = row.emphasis === "total";
  const role = row.emphasis === "role";

  return (
    <div
      className={cx(
        "flex items-baseline justify-between gap-3",
        total ? "border-t border-hairline pt-[7px]" : undefined,
        role ? "text-role-hover" : undefined,
      )}
    >
      <dt className={cx("m-0", total || role ? "font-bold" : "text-body")}>
        {row.label}
        {row.note ? (
          <span className="mt-[2px] block text-[12.5px] font-normal text-body">{row.note}</span>
        ) : null}
      </dt>
      <dd className={cx("m-0 whitespace-nowrap", total || role ? "font-bold" : "font-semibold")}>
        {row.value}
      </dd>
    </div>
  );
}
