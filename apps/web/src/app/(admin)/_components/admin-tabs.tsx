"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BottomTabBar, ListRow, ListStack, Sheet } from "@occasion/ui";
import { ADMIN_MORE_ITEMS, ADMIN_TAB_ITEMS, activeSectionId } from "../_config/nav";

/**
 * The phone's navigation.
 *
 * The prototype's four sections, from the same array the desktop links read,
 * plus a fifth tab that opens the rest. Nine tabs on a 375px screen is a row of
 * labels nobody can read, and the four the prototype chose are the ones with
 * icons to draw — the others would each need a glyph invented for them, which
 * is five parity claims with nothing to cite.
 *
 * The sheet is marked current when one of its destinations is, so the bar never
 * says "you are nowhere" while the page is Moderation.
 *
 * `BottomTabBar` hides itself above 860px.
 */

/**
 * Not a prototype icon: the prototype has no fifth tab. Three dots is the
 * conventional "there is more behind this", drawn in the same 24×24 box and at
 * the same stroke as the four beside it.
 */
const MORE_ICON = "M6 12h.01M12 12h.01M18 12h.01";

export function AdminTabs() {
  const pathname = usePathname();
  const active = activeSectionId(pathname) ?? "";
  const [open, setOpen] = useState(false);

  const inSheet = ADMIN_MORE_ITEMS.some((item) => item.id === active);

  return (
    <>
      <BottomTabBar
        label="Admin sections"
        activeId={inSheet ? "more" : active}
        items={[
          ...ADMIN_TAB_ITEMS.map((item) => ({
            id: item.id,
            label: item.label,
            icon: item.icon,
            href: item.href,
          })),
          { id: "more", label: "More", icon: MORE_ICON, onSelect: () => setOpen(true) },
        ]}
        renderLink={(item, children, props) => (
          <Link href={item.href ?? "#"} {...props}>
            {children}
          </Link>
        )}
      />

      <Sheet open={open} onClose={() => setOpen(false)} title="More">
        <ListStack as="nav" aria-label="More admin sections">
          {ADMIN_MORE_ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block no-underline"
              {...(item.id === active ? { "aria-current": "page" as const } : {})}
            >
              <ListRow title={item.label} />
            </Link>
          ))}
        </ListStack>
      </Sheet>
    </>
  );
}
