/**
 * A control the canvas draws for a screen this plan does not build.
 *
 * Five of them across the discovery screens: both "Get quotes" buttons, the
 * aside's "Get a custom quote", the vendor row's "Message" and the home page's
 * "Become a vendor". Each names a destination that does not exist, and a link
 * to a 404 is worse than a control that says so.
 *
 * `aria-disabled` rather than `disabled`, for the reason the navigation
 * already gives: a disabled button leaves the tab order and takes its `title`
 * with it, so the one group that cannot see the dimming gets no explanation.
 * It is inert because nothing is wired to it — `type="button"` inside a form
 * submits nothing either.
 */
export function DeferredAction({
  children,
  reason,
  className,
}: {
  children: string;
  /** Why it is not a link yet. Required: dimmed with no reason is a bug. */
  reason: string;
  className?: string;
}) {
  return (
    <button type="button" aria-disabled="true" title={reason} className={className}>
      {children}
    </button>
  );
}
