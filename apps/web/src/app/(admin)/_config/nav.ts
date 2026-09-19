import { NAV_ICONS } from "@occasion/ui";

/**
 * The admin navigation, in one place.
 *
 * The desktop links and the phone's tab bar both render from this array, the
 * way the prototype derives both from a single `routesFor('admin')` result
 * (line 1979). Two renderers reading two lists is how a section ends up
 * reachable on one and not the other.
 *
 * Grouped from the start, which is what let the later screens arrive as data
 * rather than as a redesign. The prototype's four sections drew as one flat row
 * while there was one item too few to show a heading; there are nine now, and
 * the groups are what keeps them readable.
 */

export type AdminNavItem = {
  /** Stable key, also the bottom bar's active id. */
  id: string;
  label: string;
  href: string;
  /**
   * An SVG path `d` from the prototype's icon map, lines 2032–2035.
   *
   * Only the four sections the prototype draws have one, because only those
   * four are in the phone's tab row. The icons are transcribed rather than
   * invented, and inventing five more would be five parity claims with nothing
   * to cite.
   */
  icon?: string;
};

export type AdminNavGroup = {
  id: "operations" | "platform";
  /** Shown once a group has enough items to be worth naming. */
  label: string;
  items: readonly AdminNavItem[];
};

/**
 * Source: `routesFor('admin')`, line 1979 — Vendors, Users, Orders,
 * Automations, in that order, and those four carry the prototype's icons.
 *
 * The other five are the capabilities the business proposal names and the
 * prototype never drew; the grouping is the one agreed in validation (V-04).
 *
 * Email is deliberately absent from both. The prototype reaches it from the
 * header and from the Users screen (lines 398 and 1663), never from a section
 * list, and that decision has not changed because the surface grew.
 */
export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    items: [
      { id: "vendors", label: "Vendors", href: "/admin/vendors", icon: NAV_ICONS.vendors },
      { id: "users", label: "Users", href: "/admin/users", icon: NAV_ICONS.users },
      { id: "orders", label: "Orders", href: "/admin/orders", icon: NAV_ICONS.orders },
      { id: "disputes", label: "Disputes", href: "/admin/disputes" },
      { id: "moderation", label: "Moderation", href: "/admin/moderation" },
    ],
  },
  {
    id: "platform",
    label: "Platform",
    items: [
      { id: "ops", label: "Automations", href: "/admin/ops", icon: NAV_ICONS.automations },
      { id: "categories", label: "Categories", href: "/admin/categories" },
      { id: "analytics", label: "Analytics", href: "/admin/analytics" },
      { id: "settings", label: "Settings", href: "/admin/settings" },
    ],
  },
];

/** Every item, flattened, in the order the groups list them. */
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = ADMIN_NAV.flatMap((group) => group.items);

/**
 * What the phone's tab row shows.
 *
 * The prototype's four, unchanged. Nine tabs on a 375px screen is a row of
 * illegible labels, and the plan's answer — the most-used destinations in the
 * bar and the rest behind "More" — reads best as *these* four: they are the
 * ones the prototype chose, they are the ones with icons, and the fifth slot
 * is the sheet rather than a fifth destination.
 */
export const ADMIN_TAB_ITEMS: readonly (AdminNavItem & { icon: string })[] = ADMIN_NAV_ITEMS.filter(
  (item): item is AdminNavItem & { icon: string } => item.icon !== undefined,
);

/** The rest, which the phone reaches through the "More" sheet. */
export const ADMIN_MORE_ITEMS: readonly AdminNavItem[] = ADMIN_NAV_ITEMS.filter(
  (item) => item.icon === undefined,
);

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
