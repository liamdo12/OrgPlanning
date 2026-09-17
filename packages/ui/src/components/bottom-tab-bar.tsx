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

/** Source: the `ICONS` map, lines 2032–2035. */
export const NAV_ICONS = {
  vendors: "M4 9.5h16V20H4zM4 9.5 6 4h12l2 5.5M9.5 20v-5h5v5",
  users:
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 20c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6M16.5 6.4a3 3 0 0 1 0 5.6M18 15.6c1.8.6 3 1.9 3 4",
  orders: "M6 3.5h12v16.5l-2.6-1.5-2.6 1.5-2.6-1.5L7.6 20 6 19V3.5zM9 8.5h6M9 12.5h4",
  automations: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.4l3 1.8",
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
        const active = item.id === activeId;
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
                active ? "text-ink" : "text-body",
              )}
            >
              {item.label}
            </span>
          </>
        );

        const props: TabLinkProps = {
          className:
            "grid min-w-0 flex-1 cursor-pointer justify-items-center gap-[3px] px-[2px] py-[6px]",
          ...(active ? { "aria-current": "page" as const } : {}),
        };

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
