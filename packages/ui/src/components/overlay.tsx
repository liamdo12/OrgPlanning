"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * Dialogs and sheets.
 *
 * Both are the same surface — line 258: a harder blur, a much deeper shadow, a
 * 26px radius — differing only in where they come from. A dialog is centred; a
 * sheet is attached to an edge, which is what the prototype's mobile filter
 * panel does.
 *
 * The prototype's overlays are `<div>`s with a click handler. Three things are
 * added here, and each one is the difference between "looks like a dialog" and
 * "is a dialog": focus moves in on open and back on close, Escape closes, and
 * Tab cannot leave. Without the trap, the first Tab lands on the page behind,
 * which is still there and still clickable.
 */

function useDismissable(open: boolean, onClose: () => void) {
  const surface = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  // Held in a ref, and the effect below depends on `open` alone. Callers pass
  // an inline arrow, so `onClose` has a new identity on every parent render —
  // and an effect that depends on it would tear down and re-run each time,
  // moving focus back to the trigger and then back into the overlay. A
  // controlled input inside a dialog would lose its caret on every keystroke.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        surface.current?.querySelectorAll<HTMLElement>(
          // `input[type=hidden]` is excluded because it matches every other
          // way of writing this and cannot take focus: `.focus()` on one is a
          // no-op, so an overlay whose first control is a form with a hidden
          // field focuses nothing and leaves the reading position on the page
          // behind. It would also make Tab wrap to an element that is not there.
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
            'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    // The surface itself is focusable, so an overlay with nothing to focus
    // still moves the reading position out of the page behind it.
    (focusables()[0] ?? surface.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    // The page behind must not scroll while a modal is open.
    const scrollLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = scrollLock;
      document.removeEventListener("keydown", onKeyDown, true);
      // Back where they were, or focus is left on `<body>` and the next Tab
      // starts from the top of the page.
      restoreTo.current?.focus?.();
    };
  }, [open]);

  return surface;
}

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function Dialog({ open, onClose, title, children, footer, className }: OverlayProps) {
  const surface = useDismissable(open, onClose);
  const headingId = useId();
  if (!open) return null;

  return (
    <div className="oc-scrim place-items-center p-4" onMouseDown={onClose}>
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        // Named by the heading it already shows, rather than by a second copy
        // of the same string.
        aria-labelledby={headingId}
        tabIndex={-1}
        // The scrim closes on click; the surface must not, or every click
        // inside the dialog closes it.
        onMouseDown={(event) => event.stopPropagation()}
        className={cx(
          "oc-overlay-surface w-full max-w-[min(540px,calc(100vw-28px))] max-h-[calc(100vh-120px)] overflow-y-auto p-5 motion-safe:animate-rise",
          className,
        )}
      >
        <h2 id={headingId} className="m-0 mb-3 font-display text-[22px] font-normal">
          {title}
        </h2>
        {children}
        {footer ? <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * A sheet: the same surface anchored to an edge.
 *
 * `side` defaults to the bottom, which is where a phone wants it and where the
 * prototype puts its filter panel.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  side = "bottom",
}: OverlayProps & { side?: "bottom" | "right" }) {
  const surface = useDismissable(open, onClose);
  const headingId = useId();
  if (!open) return null;

  return (
    <div
      className={cx("oc-scrim", side === "bottom" ? "items-end" : "justify-end")}
      onMouseDown={onClose}
    >
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={cx(
          "oc-overlay-surface overflow-y-auto p-5 motion-safe:animate-rise",
          side === "bottom"
            ? "max-h-[85vh] w-full rounded-b-none"
            : "h-full w-full max-w-[420px] rounded-r-none",
          className,
        )}
      >
        <h2 id={headingId} className="m-0 mb-3 font-display text-[22px] font-normal">
          {title}
        </h2>
        {children}
        {footer ? <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
