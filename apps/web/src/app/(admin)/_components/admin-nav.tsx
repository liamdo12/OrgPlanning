"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SectionNav } from "@occasion/ui";
import { ADMIN_NAV_ITEMS, activeSectionId } from "../_config/nav";

/**
 * The desktop section links.
 *
 * A client component for one reason: the current section comes from the URL,
 * and `usePathname()` updates on a client-side navigation where a server
 * component would not re-render. Nothing else about the shell is client-side.
 *
 * Hidden below 860px, where the bottom bar takes over — the prototype's own
 * switch (line 452 against line 1863).
 */
export function AdminNav() {
  const pathname = usePathname();
  const active = activeSectionId(pathname) ?? "";

  return (
    <SectionNav
      label="Admin sections"
      activeId={active}
      className="hidden desk:flex"
      items={ADMIN_NAV_ITEMS.map((item) => ({ id: item.id, label: item.label, href: item.href }))}
      renderLink={(item, children, props) => (
        <Link href={item.href ?? "#"} {...props}>
          {children}
        </Link>
      )}
    />
  );
}
