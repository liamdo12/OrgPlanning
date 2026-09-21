"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BottomTabBar, SectionNav } from "@occasion/ui";
import { activeTabId, customerNav } from "../_config/nav";

/**
 * The tab row and the phone's bottom bar, from one list.
 *
 * Client components for one reason: the current tab comes from the URL, and
 * `usePathname()` updates on a client-side navigation where a server component
 * would not re-render. Nothing else about the shell is client-side.
 *
 * A deferred item — Calendar — is passed through as `disabled` with the reason
 * attached, so both renderers draw it the same way and neither invents its own
 * version of "visibly not ready".
 */

export function CustomerTabs({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const active = activeTabId(pathname, signedIn) ?? "";

  return (
    // Line 452: the tabs sit under the header bar, in the same column, and are
    // replaced by the bottom bar below 860. A plain wrapper, because
    // `SectionNav` is the landmark — nesting one inside another names the same
    // set twice and gives a screen reader two ways into one row.
    <div className="hidden desk:block">
      <SectionNav
        label="Customer sections"
        activeId={active}
        items={customerNav(signedIn).map((item) => ({
          id: item.id,
          label: item.label,
          ...(item.href ? { href: item.href } : {}),
          ...(item.deferred ? { disabled: true, title: item.deferred } : {}),
        }))}
        renderLink={(item, children, props) => (
          <Link href={item.href ?? "#"} {...props}>
            {children}
          </Link>
        )}
      />
    </div>
  );
}

/** `BottomTabBar` hides itself above 860px, which is the prototype's switch. */
export function CustomerTabBar({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const active = activeTabId(pathname, signedIn) ?? "";

  return (
    <BottomTabBar
      label="Customer sections"
      activeId={active}
      items={customerNav(signedIn).map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        ...(item.href ? { href: item.href } : {}),
        ...(item.deferred ? { disabled: true, title: item.deferred } : {}),
      }))}
      renderLink={(item, children, props) => (
        <Link href={item.href ?? "#"} {...props}>
          {children}
        </Link>
      )}
    />
  );
}
