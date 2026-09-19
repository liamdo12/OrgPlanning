"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SectionNav } from "@occasion/ui";
import { ADMIN_NAV, activeSectionId } from "../_config/nav";

/**
 * The desktop section links.
 *
 * A client component for one reason: the current section comes from the URL,
 * and `usePathname()` updates on a client-side navigation where a server
 * component would not re-render. Nothing else about the shell is client-side.
 *
 * Two groups rather than one row. Four items drew as a flat bar and this is
 * nine; the headings are what stop "Moderation" and "Automations" reading as
 * the same kind of thing. The grouping is the one agreed in validation (V-04)
 * and the structure Phase 5 authored the nav with.
 *
 * Hidden below 860px, where the bottom bar takes over — the prototype's own
 * switch (line 452 against line 1863).
 */
export function AdminNav() {
  const pathname = usePathname();
  const active = activeSectionId(pathname) ?? "";

  return (
    <div className="hidden items-center gap-5 desk:flex">
      {ADMIN_NAV.map((group) => (
        <div key={group.id} className="flex items-center gap-2">
          {/* Visible, not a screen-reader label: the whole point of the
              grouping is that somebody scanning the bar can see where
              Moderation sits. `SectionNav` still names the set for anyone who
              is not looking at it. */}
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] opacity-60">
            {group.label}
          </span>
          <SectionNav
            label={`${group.label} sections`}
            activeId={active}
            items={group.items.map((item) => ({
              id: item.id,
              label: item.label,
              href: item.href,
            }))}
            renderLink={(item, children, props) => (
              <Link href={item.href ?? "#"} {...props}>
                {children}
              </Link>
            )}
          />
        </div>
      ))}
    </div>
  );
}
