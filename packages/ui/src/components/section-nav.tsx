import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * The desktop section links.
 *
 * Line 455 in the prototype: no fill, a 2px underline in the role colour when
 * current, body-coloured text otherwise. Not the pill treatment — that is the
 * filter chip, line 1669, and the two mean different things.
 *
 * Deliberately **not** `role="tablist"`. These change the page, not a panel
 * inside it; a tab list with no `tabpanel` and no `aria-controls` is ARIA that
 * lies, and it takes arrow-key navigation with it. Plain links in a `<nav>`,
 * with `aria-current="page"` on the one you are on, is what this actually is.
 */

export type SectionItem = {
  id: string;
  label: ReactNode;
  href?: string;
  /** A count beside the label, e.g. a pending queue. */
  badge?: ReactNode;
  onSelect?: () => void;
  /**
   * Shown, and inert. The desktop half of the same rule `TabBarItem` carries:
   * a destination the product names but does not have yet is visibly deferred
   * rather than omitted, and never a link to a 404. A disabled item does not
   * render as a link whatever `href` says.
   */
  disabled?: boolean;
  /** Why, in words. Required with `disabled`: dimmed with no reason is a bug. */
  title?: string;
};

export function SectionNav({
  items,
  activeId,
  label,
  className,
  renderLink,
}: {
  items: readonly SectionItem[];
  activeId: string;
  /** Names the set, e.g. "Admin sections". */
  label: string;
  className?: string;
  /**
   * How to render a navigating item.
   *
   * The design system must not import the app's router, so the app passes its
   * own `Link` in. An item with an `href` and no `renderLink` falls back to a
   * plain `<a>`, which navigates — slower, but it works.
   */
  renderLink?: (item: SectionItem, children: ReactNode, props: LinkProps) => ReactNode;
}) {
  return (
    <nav aria-label={label} className={cx("flex flex-wrap gap-1", className)}>
      {items.map((item) => {
        const current = item.id === activeId && !item.disabled;
        const body = (
          <>
            {item.label}
            {item.badge != null ? <span className="ml-2 opacity-70">{item.badge}</span> : null}
          </>
        );

        const props: LinkProps = {
          className: "oc-section-link",
          ...(current ? { "aria-current": "page" as const } : {}),
        };

        if (item.disabled) {
          return (
            <button
              key={item.id}
              type="button"
              // `aria-disabled` rather than the attribute, for the reason
              // `BottomTabBar` gives: a disabled button leaves the tab order
              // and its `title` goes with it, so the one group that cannot see
              // the dimming would get no explanation at all.
              aria-disabled="true"
              title={item.title}
              onClick={(event) => event.preventDefault()}
              {...props}
            >
              {body}
            </button>
          );
        }

        if (item.href) {
          return renderLink ? (
            <span key={item.id} className="contents">
              {renderLink(item, body, props)}
            </span>
          ) : (
            <a key={item.id} href={item.href} {...props}>
              {body}
            </a>
          );
        }

        return (
          <button key={item.id} type="button" onClick={item.onSelect} {...props}>
            {body}
          </button>
        );
      })}
    </nav>
  );
}

/** What a caller's own link component has to put on the element it renders. */
export type LinkProps = {
  className: string;
  "aria-current"?: "page";
};
