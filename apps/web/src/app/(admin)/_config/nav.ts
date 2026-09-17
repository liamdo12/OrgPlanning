import { NAV_ICONS } from "@occasion/ui";

/**
 * The admin navigation, in one place.
 *
 * The desktop links and the phone's tab bar both render from this array, the
 * way the prototype derives both from a single `routesFor('admin')` result
 * (line 1979). Two renderers reading two lists is how a section ends up
 * reachable on one and not the other.
 *
 * Grouped from the start. The prototype has four sections and draws them as one
 * flat row, which is what this renders today — but the admin surface gains
 * disputes, moderation, categories and analytics later, and a nav that has to
 * be regrouped at that point is a nav that gets redesigned under pressure. The
 * groups exist now and cost nothing while there is one item too few to show a
 * heading.
 */

export type AdminNavItem = {
  /** Stable key, also the bottom bar's active id. */
  id: string;
  label: string;
  href: string;
  /** An SVG path `d` from the prototype's icon map, lines 2032–2035. */
  icon: string;
};

export type AdminNavGroup = {
  id: "operations" | "platform";
  /** Shown only once a group has enough items to be worth naming. */
  label: string;
  items: readonly AdminNavItem[];
};

/**
 * Source: `routesFor('admin')`, line 1979 — Vendors, Users, Orders,
 * Automations, in that order.
 *
 * Email is deliberately absent. The prototype reaches it from the header and
 * from the Users screen (lines 398 and 1663), never from the tab row, and a
 * fifth tab on a phone would crowd the four that matter.
 */
export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    items: [
      { id: "vendors", label: "Vendors", href: "/admin/vendors", icon: NAV_ICONS.vendors },
      { id: "users", label: "Users", href: "/admin/users", icon: NAV_ICONS.users },
      { id: "orders", label: "Orders", href: "/admin/orders", icon: NAV_ICONS.orders },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [{ id: "ops", label: "Automations", href: "/admin/ops", icon: NAV_ICONS.automations }],
  },
];

/** Every item, flattened, in the order the prototype shows them. */
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = ADMIN_NAV.flatMap((group) => group.items);

/**
 * Which section a path belongs to.
 *
 * Prefix matching, so `/admin/vendors/abc` still marks Vendors as current. The
 * longest match wins, which is what keeps a future `/admin/orders/refunds` from
 * matching `/admin/orders` and something shorter at the same time.
 */
export function activeSectionId(pathname: string): string | undefined {
  let best: AdminNavItem | undefined;

  for (const item of ADMIN_NAV_ITEMS) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }

  return best?.id;
}
