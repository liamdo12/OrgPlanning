"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BottomTabBar } from "@occasion/ui";
import { ADMIN_NAV_ITEMS, activeSectionId } from "../_config/nav";

/**
 * The phone's navigation.
 *
 * The same four sections as the desktop links, from the same array — the
 * prototype builds both from one `routesFor` result (line 1979), and two lists
 * is how a section ends up reachable on one and not the other.
 *
 * `BottomTabBar` hides itself above 860px.
 */
export function AdminTabs() {
  const pathname = usePathname();
  const active = activeSectionId(pathname) ?? "";

  return (
    <BottomTabBar
      label="Admin sections"
      activeId={active}
      items={ADMIN_NAV_ITEMS.map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        href: item.href,
      }))}
      renderLink={(item, children, props) => (
        <Link href={item.href ?? "#"} {...props}>
          {children}
        </Link>
      )}
    />
  );
}
