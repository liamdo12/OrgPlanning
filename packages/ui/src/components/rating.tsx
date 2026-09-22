import { cx } from "../lib/cx";

/**
 * `★ 4.9 (86)`.
 *
 * Lines 732, 773 and 807 — the card, the detail heading and a review row all
 * draw the same glyphs. The first two carry a count, because an average with
 * no count behind it says nothing; the third is one person's own rating, where
 * a count of one is noise, so `count` is optional and the canvas draws it
 * without one (line 807).
 *
 * The star is decorative and the bracketed number is not one a screen reader
 * can place, so the visible text is hidden from the accessibility tree and a
 * sentence is read instead. Otherwise it is announced as "black star four
 * point nine eighty-six", which names neither the scale nor what the second
 * number counts.
 *
 * A listing with no reviews says so. `rating_average` is `0` there, and
 * "★ 0.0 (0)" reads as a business everybody hated rather than one nobody has
 * reviewed yet.
 */
export function Rating({
  average,
  count,
  className,
}: {
  /** Out of five, as the catalogue stores it. */
  average: number;
  /** How many ratings the average is of. Absent for a single review's own. */
  count?: number | undefined;
  className?: string;
}) {
  if (count === 0) {
    return <span className={cx("text-[13px] text-body", className)}>No reviews yet</span>;
  }

  // Whole stars stay whole: the catalogue's averages carry a decimal and one
  // person's rating does not, and "★ 5.0" on a review is a precision nobody
  // expressed.
  const shown = Number.isInteger(average) ? String(average) : average.toFixed(1);

  return (
    <span className={cx("text-[13px] whitespace-nowrap text-body", className)}>
      <span aria-hidden="true">
        ★ {shown}
        {count === undefined ? "" : ` (${count})`}
      </span>
      <span className="sr-only">
        Rated {shown} out of 5
        {count === undefined ? "" : ` from ${count} ${count === 1 ? "review" : "reviews"}`}
      </span>
    </span>
  );
}
