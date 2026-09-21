import { NAV_ICONS } from "@occasion/ui";

/**
 * The customer navigation, in one place.
 *
 * The desktop tab row and the phone's bottom bar both render from this, the way
 * the prototype derives both from one `routesFor('customer', signedIn)` result
 * (line 1977). Two renderers reading two lists is how a destination ends up
 * reachable on one and not the other.
 *
 * The set depends on whether anyone is signed in, which is the prototype's own
 * rule: signed out it is Explore and Services (line 1980), signed in it is
 * Explore, Saved, Events and Calendar (line 1981).
 */

export type CustomerNavItem = {
  /** Stable key, and the active id both renderers compare against. */
  id: string;
  label: string;
  /** An SVG path `d` from the prototype's icon map, lines 2021–2025. */
  icon: string;
  /**
   * Absent when the screen does not exist yet. An item with no destination is
   * rendered visibly deferred and never as a link — the point of showing it is
   * that the plan names it, and the point of not linking it is that a tab bar
   * around a 404 is worse than no tab at all.
   */
  href?: string;
  /** Why it is deferred, in words. Shown as the control's `title`. */
  deferred?: string;
};

/** Explore, and the browse screen under its signed-out name. Line 1980. */
export const CUSTOMER_NAV_SIGNED_OUT: readonly CustomerNavItem[] = [
  { id: "explore", label: "Explore", href: "/", icon: NAV_ICONS.home },
  { id: "services", label: "Services", href: "/services", icon: NAV_ICONS.results },
];

/**
 * Line 1981.
 *
 * Calendar is the one that does not go anywhere. It belongs to a later plan
 * than this one, and it is kept in the row rather than dropped so that the
 * navigation does not rearrange itself when the screen arrives — which is also
 * why it needs a reason attached rather than only a dimmed label.
 */
export const CUSTOMER_NAV_SIGNED_IN: readonly CustomerNavItem[] = [
  { id: "explore", label: "Explore", href: "/", icon: NAV_ICONS.home },
  { id: "saved", label: "Saved", href: "/saved", icon: NAV_ICONS.saved },
  { id: "events", label: "Events", href: "/events", icon: NAV_ICONS.event },
  {
    id: "calendar",
    label: "Calendar",
    icon: NAV_ICONS.calendar,
    deferred: "A calendar of everything booked is planned, and is not built yet.",
  },
];

export function customerNav(signedIn: boolean): readonly CustomerNavItem[] {
  return signedIn ? CUSTOMER_NAV_SIGNED_IN : CUSTOMER_NAV_SIGNED_OUT;
}

/**
 * Which tab a path belongs to.
 *
 * Prefix matching so `/services/bloom-and-co` still marks Services, and the
 * longest match wins so a future `/events/new` cannot light up two at once.
 * `/` is matched exactly for the same reason — as a prefix it would match
 * everything.
 *
 * Signed in, the prototype folds Results and Service detail under Explore and
 * Checkout and Confirmation under Events (line 2035's `on` expression). That
 * grouping is reproduced by `under`, so the bar never says "you are nowhere".
 */
const UNDER: Readonly<Record<string, string>> = {
  "/services": "explore",
  "/checkout": "events",
  "/orders": "events",
};

export function activeTabId(pathname: string, signedIn: boolean): string | undefined {
  const items = customerNav(signedIn);

  let best: CustomerNavItem | undefined;
  for (const item of items) {
    if (!item.href) continue;
    const matches =
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > (best.href?.length ?? 0))) best = item;
  }
  if (best) return best.id;

  for (const [prefix, id] of Object.entries(UNDER)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      // Only when the tab it folds into is actually on the bar: signed out,
      // Services is a tab of its own and folding it under Explore would leave
      // the visitor's current screen unmarked.
      if (items.some((item) => item.id === id)) return id;
    }
  }

  return undefined;
}
