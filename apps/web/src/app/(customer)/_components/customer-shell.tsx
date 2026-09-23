import Link from "next/link";
import type { ReactNode } from "react";
import { AppBackground, GlassChrome } from "@occasion/ui";
import type { CustomerOrderRow } from "@occasion/core";
import { AccountMenu } from "./account-menu";
import { BookedStrip } from "./booked-strip";
import { CustomerTabBar, CustomerTabs } from "./customer-tabs";
import { EventSwitcher } from "./event-switcher";
import { SearchPill } from "./search-pill";

/**
 * The frame every customer screen renders inside.
 *
 * Server-rendered, and it stays that way: the client components are the ones
 * that need the current URL (the two navigations), local open/closed state
 * (the search panel, the two menus) or both. Nothing here fetches.
 *
 * Structure follows the prototype's header, lines 217–465: a sticky blurred
 * bar carrying the brand mark, the search control, the event chip and the
 * utility buttons, the tab row on its own line below, the booked-services strip
 * under that, and the content in a 1240px column. On a phone the tabs become
 * the bottom bar.
 *
 * The strip (line 465) draws nothing until there is something booked. Three
 * real rows or none — a placeholder there would be fiction in the chrome of
 * every screen.
 */
export function CustomerShell({
  email,
  events,
  activeEventId,
  today,
  booked,
  children,
}: {
  /** Absent when nobody is signed in, which is what the shell switches on. */
  email?: string | undefined;
  events: readonly { id: string; name: string }[];
  activeEventId: string | undefined;
  /** Today, from the domain clock, so the date picker follows a demo override. */
  today: string;
  /** The most recent bookings, for the strip. Empty draws nothing. */
  booked: readonly CustomerOrderRow[];
  children: ReactNode;
}) {
  const signedIn = email !== undefined;

  return (
    <AppBackground role="customer">
      <GlassChrome as="header" className="sticky top-0 z-40 border-b border-hairline">
        {/* Line 218: a 1240px column with a fluid gutter. */}
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-4 px-[clamp(14px,3.5vw,32px)] py-3">
          <Link href="/" className="flex items-center gap-[9px] no-underline hover:no-underline">
            {/* Lines 221–222: a rounded mark in the role colour, then the word. */}
            <span
              aria-hidden="true"
              className="grid h-[30px] w-[30px] place-items-center rounded-[13px] bg-role font-display text-[19px] leading-none text-[#FAF7F2]"
            >
              o
            </span>
            <span className="font-display text-[23px] tracking-[-0.01em] text-ink">Occasion</span>
          </Link>

          <SearchPill today={today} />

          <div className="ml-auto flex items-center gap-2">
            {/* Line 2322: the chip is a desktop control; on a phone the header
                row has no width left for it and the event tab is one tap away. */}
            {signedIn ? (
              <span className="hidden desk:block">
                <EventSwitcher events={events} activeEventId={activeEventId} />
              </span>
            ) : null}

            {signedIn ? (
              <div className="flex items-center gap-[6px]">
                {/* Line 422. Inbox is not built, so it is not drawn: a utility
                    button is a promise of a destination. */}
                <Link
                  href="/orders"
                  // Named explicitly, because the label is hidden on a phone,
                  // which would otherwise leave this control nameless. The
                  // prototype labels it for the same reason at line 422.
                  aria-label="Orders"
                  className="oc-button oc-button--ghost oc-button--sm gap-[7px] text-[13px]"
                >
                  <OrdersIcon />
                  <span className="hidden desk:inline">Orders</span>
                </Link>

                <AccountMenu email={email} />
              </div>
            ) : (
              <div className="flex items-center gap-[6px]">
                <Link
                  href="/login"
                  className="oc-button oc-button--ghost oc-button--sm text-[13px]"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="oc-button oc-button--primary oc-button--sm text-[13px]"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Line 452: the tab row sits under the bar, in the same column. */}
        <div className="mx-auto max-w-[1240px] px-[clamp(14px,3.5vw,32px)]">
          <CustomerTabs signedIn={signedIn} />
        </div>

        {/* Line 465, under the tabs and inside the same blurred bar. */}
        <BookedStrip orders={booked} />
      </GlassChrome>

      {/*
       * Line 490 for the top padding; line 2324 for the bottom, where the
       * prototype reserves 104px on a phone so the fixed bar never covers the
       * last row of a scrolled page, and 60px on a desktop.
       */}
      <main className="mx-auto max-w-[1240px] px-[clamp(14px,3.5vw,32px)] pt-[clamp(18px,3vw,34px)] pb-[104px] desk:pb-[60px]">
        {children}
      </main>

      <CustomerTabBar signedIn={signedIn} />
    </AppBackground>
  );
}

/** Source: the receipt mark at lines 424–426. */
function OrdersIcon() {
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
      <path d="M6 3.5h12a1 1 0 0 1 1 1V20l-2.6-1.5L13.8 20l-2.6-1.5L8.6 20 6 18.5 3.4 20V4.5a1 1 0 0 1 1-1z" />
      <path d="M8 8.5h8" />
      <path d="M8 12.5h5" />
    </svg>
  );
}
