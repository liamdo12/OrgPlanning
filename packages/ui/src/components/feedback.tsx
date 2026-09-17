import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import type { StatusTone } from "./status-badge";

/**
 * Empty, loading and after-the-fact states.
 *
 * None of these exist in the prototype, because a prototype is never empty,
 * never slow and never wrong. All three are the first thing a real screen
 * needs, so they are built from the same tokens rather than improvised per
 * screen.
 */

/** Nothing to show, and what to do about it. */
export function EmptyState({
  title,
  blurb,
  action,
  className,
}: {
  title: ReactNode;
  blurb?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("oc-glass rounded-panel px-6 py-12 text-center", className)}>
      <p className="m-0 font-display text-[22px] font-normal">{title}</p>
      {blurb ? (
        <p className="mx-auto mt-2 mb-0 max-w-[48ch] text-[14px] text-pretty text-body">{blurb}</p>
      ) : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * A placeholder with the shape of the thing that is coming.
 *
 * `aria-hidden`, with the live region left to the caller: a screen reader
 * should hear "loading orders", not six grey rectangles.
 */
export function Skeleton({
  className,
  width,
  height = "1rem",
}: {
  className?: string;
  width?: string;
  height?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx("oc-skeleton block", className)}
      style={{ width, height }}
    />
  );
}

/** Several of them, for a list that has not arrived yet. */
export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("grid gap-[10px]", className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height="64px" className="rounded-row" />
      ))}
    </div>
  );
}

/**
 * Something happened.
 *
 * `role="status"` for the ordinary case and `role="alert"` for a failure: the
 * first waits for a pause in speech, the second interrupts. A toast that
 * interrupts to say "saved" trains people to ignore the one that says the
 * payment failed.
 */
export function Toast({
  tone = "neutral",
  children,
  onDismiss,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "oc-overlay-surface flex items-start gap-3 px-4 py-3 text-[14px] motion-safe:animate-rise",
        className,
      )}
    >
      <span className={cx("oc-badge", `oc-badge--${tone}`, "mt-[2px]")} aria-hidden="true">
        {tone === "danger" ? "!" : tone === "warn" ? "!" : "✓"}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-pill px-2 text-body"
          aria-label="Dismiss"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

/** Where toasts stack. Fixed, above the bottom bar on a phone. */
export function ToastRegion({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "pointer-events-none fixed inset-x-4 bottom-[112px] z-70 grid justify-items-center gap-2 desk:bottom-6",
        className,
      )}
    >
      <div className="pointer-events-auto grid w-full max-w-[420px] gap-2">{children}</div>
    </div>
  );
}
