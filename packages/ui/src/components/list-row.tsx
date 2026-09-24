import type { ElementType, ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * A person or a business, one per card.
 *
 * Line 1675: a glass card at radius 22 with 15px padding, an avatar, a
 * two-line identity that takes the remaining width, and actions that wrap
 * underneath on a narrow screen.
 *
 * `leading` and `trailing` rather than a fixed shape, because the admin user
 * list, the vendor queue and the payouts list all use this row with different
 * things on the right.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cx(
        "oc-glass flex flex-wrap items-center gap-[14px] rounded-row p-[15px]",
        className,
      )}
    >
      {leading}

      <div className="min-w-0 flex-[1_1_210px]">
        <p className="m-0 text-[15px] font-bold">{title}</p>
        {subtitle ? <p className="m-0 text-row text-body">{subtitle}</p> : null}
      </div>

      {trailing ? <div className="flex flex-wrap items-center gap-2">{trailing}</div> : null}
    </article>
  );
}

/**
 * The list those rows sit in. Line 1674: a 10px grid, not a flex column.
 *
 * `as` for the same reason the glass surfaces have it: a list of accounts is a
 * `<ul>` of `<li>`s, and wrapping correct markup in a `<div>` to get a gap is
 * how a list stops announcing itself as one.
 */
export function ListStack({
  as: Tag = "div",
  children,
  className,
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
}) {
  return <Tag className={cx("grid gap-[10px]", className)}>{children}</Tag>;
}
