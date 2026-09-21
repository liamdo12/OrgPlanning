import type { ReactNode } from "react";
import { cx } from "../lib/cx";

/**
 * The phone's navigation.
 *
 * Line 1864: fixed to the bottom, chrome glass at 0.6 rather than the header's
 * 0.55, and padding that adds
 * `env(safe-area-inset-bottom)` so the labels clear the home indicator. Each
 * tab is a 21px stroked icon over a 10.5px label (lines 1867–1869).
 *
 * The icons are single `path` strings because that is what the prototype ships
 * (lines 2021–2035) — a shared map keyed by route, drawn at stroke width 1.8
 * with round caps and joins. `NAV_ICONS` below carries the admin ones; the rest
 * arrive with the screens that need them.
 */

/** Source: the `ICONS` map, lines 2021–2024 and 2032–2035. */
export const NAV_ICONS = {
  vendors: "M4 9.5h16V20H4zM4 9.5 6 4h12l2 5.5M9.5 20v-5h5v5",
  users:
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 20c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6M16.5 6.4a3 3 0 0 1 0 5.6M18 15.6c1.8.6 3 1.9 3 4",
  orders: "M6 3.5h12v16.5l-2.6-1.5-2.6 1.5-2.6-1.5L7.6 20 6 19V3.5zM9 8.5h6M9 12.5h4",
  automations: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.4l3 1.8",
  /* The customer four, lines 2021–2024. */
  home: "M3.5 11 12 4l8.5 7M6 9.8V20h12V9.8",
  results: "M4 7h16M4 12h16M4 17h10",
  saved: "M12 20s-7-4.4-7-9a3.8 3.8 0 0 1 7-2.1A3.8 3.8 0 0 1 19 11c0 4.6-7 9-7 9z",
  event: "M4 6.5h16v13H4zM8 4v4M16 4v4M4 11h16",
  /*
   * Line 2025, and it draws a tab that goes nowhere: the calendar screen
   * belongs to a later plan, and its tab is shown deferred rather than dropped
   * so the row does not rearrange when it arrives. Transcribed rather than
   * invented, like the rest — and it stays a *deferred* tab until there is a
   * screen, because an icon is the thing that makes one look ready.
   *
   * `messages` (2026) is not here: nothing draws it at all.
   */
  calendar: "M4 6.5h16v13H4zM8 4v4M16 4v4M4 11h16M8.5 14.5h2M13.5 14.5h2",
} as const;

/** What a caller's own link component has to put on the element it renders. */
export type TabLinkProps = {
  className: string;
  "aria-current"?: "page";
};

export type TabBarItem = {
  id: string;
  label: string;
  /** An SVG path `d`, drawn in a 24×24 box. See `NAV_ICONS`. */
  icon: string;
  href?: string;
  onSelect?: () => void;
  /**
   * Shown, and inert.
   *
   * For a destination the product names but does not have yet. The alternative
   * — omitting the tab — loses the information that it is coming; the other
   * alternative, linking it anyway, is a 404 with a nav bar around it.
   *
   * A disabled item never renders as a link whatever `href` says, so a place
   * that is not ready cannot be reached by middle-clicking it either.
   */
  disabled?: boolean;
  /** Why, in words. Required with `disabled`: dimmed with no reason is a bug. */
  title?: string;
};

export function BottomTabBar({
  items,
  activeId,
  label = "Sections",
  className,
  renderLink,
}: {
  items: readonly TabBarItem[];
  activeId: string;
  label?: string;
  className?: string;
  /**
   * How to render a navigating tab.
   *
   * The design system must not import the app's router, so the app passes its
   * own `Link` in. Without it an item with an `href` renders a plain `<a>`,
   * which navigates — it just gives up client-side routing.
   *
   * `props` carries `aria-current`, which has to land on the link itself: on a
   * `display: contents` wrapper it reaches nothing.
   */
  renderLink?: (item: TabBarItem, children: ReactNode, props: TabLinkProps) => ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className={cx(
        "oc-chrome fixed inset-x-0 bottom-0 z-50 flex border-t border-glass-edge-soft px-[6px] pt-[7px] pb-[calc(7px+env(safe-area-inset-bottom))] desk:hidden",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId && !item.disabled;
        const body = (
          <>
            <svg
              width="21"
              height="21"
              viewBox="0 0 24 24"
              fill="none"
              // Active icons take the role colour; the rest are the prototype's
              // grey (line 2041), which is quieter than the label beside it.
              stroke={active ? "var(--color-role)" : "#8A9690"}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={item.icon} />
            </svg>
            <span
              className={cx(
                "max-w-full truncate text-tab font-bold",
                // `text-on-chrome` rather than `text-body`: this label sits on
                // the glass bar rather than on the page, and the body colour
                // does not clear AA there at this size. See the token.
                active ? "text-ink" : "text-on-chrome",
              )}
            >
              {item.label}
            </span>
          </>
        );

        const props: TabLinkProps = {
          // `no-underline` because a tab is often a link, and the base layer
          // underlines a hovered one; the prototype's tabs never underline.
          className:
            "grid min-w-0 flex-1 cursor-pointer justify-items-center gap-[3px] px-[2px] py-[6px] no-underline hover:no-underline",
          ...(active ? { "aria-current": "page" as const } : {}),
        };

        if (item.disabled) {
          return (
            <button
              key={item.id}
              type="button"
              // `aria-disabled`, not the attribute: a disabled button leaves
              // the tab order, which takes the `title` with it — so the one
              // group that cannot see the dimming is the one that gets no
              // explanation at all. This stays reachable, announces as
              // unavailable, and does nothing when pressed.
              aria-disabled="true"
              title={item.title}
              onClick={(event) => event.preventDefault()}
              {...props}
              className={cx(
                props.className,
                "cursor-not-allowed border-0 bg-transparent opacity-[0.55]",
              )}
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
          <button
            key={item.id}
            type="button"
            onClick={item.onSelect}
            {...props}
            className={cx(props.className, "border-0 bg-transparent")}
          >
            {body}
          </button>
        );
      })}
    </nav>
  );
}
