import { cx } from "../lib/cx";

/**
 * `★ 4.9 (86)`.
 *
 * Lines 732, 773 and 807 — the card, the detail heading and a review row all
 * draw the same three glyphs, and the count is what makes the average mean
 * anything.
 *
 * The star is decorative and the bracketed number is not a number a screen
 * reader can place, so the visible text is hidden from the accessibility tree
 * and a sentence is read instead. Otherwise it is announced as
 * "black star four point nine eighty-six", which names neither the scale nor
 * what the second number counts.
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
  count: number;
  className?: string;
}) {
  if (count === 0) {
    return <span className={cx("text-[13px] text-body", className)}>No reviews yet</span>;
  }

  const shown = average.toFixed(1);

  return (
    <span className={cx("text-[13px] whitespace-nowrap text-body", className)}>
      <span aria-hidden="true">
        ★ {shown} ({count})
      </span>
      <span className="sr-only">
        Rated {shown} out of 5 from {count} {count === 1 ? "review" : "reviews"}
      </span>
    </span>
  );
}
