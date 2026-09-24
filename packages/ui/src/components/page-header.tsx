import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * A screen's title, blurb and actions.
 *
 * The serif heading is the prototype's one piece of display type: Instrument
 * Serif at `clamp(27px, 4vw, 40px)`, weight 400 (line 1795). The blurb is 14px
 * body colour, capped at 66 characters so a wide screen does not turn it into
 * one long line (line 1835).
 *
 * Actions sit on the title's row and wrap beneath it on a phone (line 1661).
 */
export function PageHeader({
  title,
  blurb,
  actions,
  className,
}: {
  title: ReactNode;
  blurb?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("mb-[18px]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-[14px]">
        <h1 className="m-0 font-display text-[clamp(27px,4vw,40px)] font-normal">{title}</h1>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      {blurb ? (
        // Ink, not the body colour the prototype uses at line 1834: this line
        // sits on the bare page, and the top-left ambient gradient is centred
        // right behind it — the lighter grey falls to 4.1:1 there.
        <p className="mt-[6px] mb-0 max-w-[66ch] text-[14px] text-pretty text-ink">{blurb}</p>
      ) : null}
    </header>
  );
}

/**
 * The strip above a list: filters on the left, actions on the right.
 *
 * Separate from `PageHeader` because it is often sticky while the header
 * scrolls away, and because a screen can have several.
 */
export function Toolbar({
  children,
  className,
  sticky = false,
}: {
  children: ReactNode;
  className?: string;
  sticky?: boolean;
}) {
  return (
    <div
      className={cx(
        "mb-4 flex flex-wrap items-center justify-between gap-3",
        // Chrome rather than panel glass: content scrolls under it. Line 217.
        sticky && "oc-chrome sticky top-0 z-30 -mx-4 px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
