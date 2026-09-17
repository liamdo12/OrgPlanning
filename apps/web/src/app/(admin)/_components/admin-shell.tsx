import Link from "next/link";
import type { ReactNode } from "react";
import type { RoleName } from "@occasion/core";
import { AppBackground, GlassChrome } from "@occasion/ui";
import { AdminNav } from "./admin-nav";
import { AdminTabs } from "./admin-tabs";
import { AdminUserMenu } from "./admin-user-menu";

/**
 * The frame every admin screen renders inside.
 *
 * Server-rendered, and it stays that way: the two client components are the
 * ones that need the current URL (the navigations) and the one that needs local
 * open/closed state (the user menu). Nothing here fetches.
 *
 * Structure follows the prototype's header, lines 218–458: a sticky blurred bar
 * carrying the brand mark and the utility controls, the section links on a row
 * of their own below it, and the content in a 1240px column. On a phone the
 * links become the bottom tab bar.
 */
export function AdminShell({
  email,
  roles,
  activeRole,
  children,
}: {
  email: string;
  roles: readonly RoleName[];
  activeRole: RoleName;
  children: ReactNode;
}) {
  return (
    // The admin theme, applied once. Everything below reads the same three
    // variables — line 1995.
    <AppBackground role="admin">
      <GlassChrome as="header" className="sticky top-0 z-40 border-b border-hairline">
        {/* Line 218: a 1240px column with a fluid gutter. */}
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-4 px-[clamp(14px,3.5vw,32px)] py-3">
          <Link
            href="/admin"
            className="flex items-center gap-[9px] no-underline hover:no-underline"
          >
            {/* Lines 221–222: a rounded mark in the role colour, then the word. */}
            <span
              aria-hidden="true"
              className="grid h-[30px] w-[30px] place-items-center rounded-[13px] bg-role font-display text-[19px] leading-none text-[#FAF7F2]"
            >
              o
            </span>
            <span className="font-display text-[23px] tracking-[-0.01em] text-ink">Occasion</span>
            <span className="sr-only">admin</span>
          </Link>

          <div className="ml-auto flex items-center gap-[6px]">
            {/* Line 398: the prototype shows this to everyone but a customer. */}
            <Link
              href="/admin/email"
              // Named explicitly: the label below is hidden on a phone, which
              // takes it out of the accessibility tree and would leave this
              // control nameless. The prototype labels it for the same reason
              // at line 399.
              aria-label="Email"
              className="oc-button oc-button--ghost oc-button--sm gap-[7px] text-[13px]"
            >
              <EmailIcon />
              <span className="hidden desk:inline">Email</span>
            </Link>

            <AdminUserMenu email={email} roles={roles} activeRole={activeRole} />
          </div>
        </div>

        {/* Line 452: the section links sit under the bar, in the same column. */}
        <div className="mx-auto max-w-[1240px] px-[clamp(14px,3.5vw,32px)]">
          <AdminNav />
        </div>
      </GlassChrome>

      {/*
       * Line 490 for the top padding; line 2324 for the bottom, where the
       * prototype reserves 104px on a phone for the fixed tab bar and 60px on a
       * desktop.
       */}
      <main className="mx-auto max-w-[1240px] px-[clamp(14px,3.5vw,32px)] pt-[clamp(18px,3vw,34px)] pb-[104px] desk:pb-[60px]">
        {children}
      </main>

      <AdminTabs />
    </AppBackground>
  );
}

/** Source: the envelope at line 400. */
function EmailIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.6 6.5 8.4 6 8.4-6" />
    </svg>
  );
}
