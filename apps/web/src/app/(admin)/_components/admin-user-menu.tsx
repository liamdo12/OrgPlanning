"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { RoleName } from "@occasion/core";
import { Avatar } from "@occasion/ui";
import { signOutAction, switchRoleAction } from "../../(auth)/actions";
import { themeFor } from "../../../lib/role-theme";

/**
 * Who you are, and the three things you can do about it.
 *
 * The prototype's header has an "Account" button that navigates to a page
 * (line 432). There is no account page here yet, and the two things an
 * administrator actually needs from the header — switching which role they are
 * looking through, and signing out — are one click each, so this is a menu
 * rather than a route.
 *
 * The role switcher is an addition; the prototype has none. **It changes the
 * view, never the authority**: `getActor` honours the cookie only for a role
 * the person already holds, and every gate reads the roles themselves. Selecting
 * "customer" does not put down admin rights in another tab, and selecting
 * "admin" does not pick any up. What it does change is the `acting_role`
 * recorded on the audit rows the session goes on to write.
 */

export function AdminUserMenu({
  email,
  roles,
  activeRole,
}: {
  email: string;
  roles: readonly RoleName[];
  activeRole: RoleName;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };

    const onPointerDown = (event: MouseEvent) => {
      // A click anywhere else closes it — including on another header control,
      // which then does its own job rather than being swallowed.
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // Not `menu`: what opens is a panel with a form and two links, with no
        // `menuitem` roles and no arrow-key navigation. Announcing a menu and
        // handing over a disclosure is the same lie `SectionNav` refuses.
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
        // The label is hidden on a phone, so without this the control has no
        // accessible name there. The prototype labels it at line 432.
        aria-label="Account"
        // The header control shape from line 432: a pill, 8px 13px, 13px/600.
        className="flex items-center gap-[7px] rounded-pill border border-glass-edge bg-chip px-[13px] py-2 text-[13px] font-semibold"
      >
        <AccountIcon />
        <span className="hidden desk:inline">Account</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="oc-overlay-surface absolute top-[calc(100%+8px)] right-0 z-50 w-[260px] p-4 motion-safe:animate-rise"
        >
          <div className="flex items-center gap-3">
            <Avatar name={email} />
            {/* One line. The actor carries no display name yet, so a second
                line would be the address printed twice. */}
            <p className="m-0 min-w-0 truncate text-row font-bold">{email}</p>
          </div>

          {roles.length > 1 ? (
            <form action={switchRoleAction} className="mt-4">
              <p className="m-0 mb-2 text-[12px] font-bold tracking-[0.06em] text-body uppercase">
                Viewing as
              </p>
              <div className="flex flex-wrap gap-1">
                {roles.map((role) => (
                  <button
                    key={role}
                    type="submit"
                    name="role"
                    value={role}
                    // Each chip is themed as the role it selects, so the choice
                    // shows its own colour rather than the one in force.
                    data-role={themeFor(role)}
                    aria-pressed={role === activeRole}
                    className="oc-chip capitalize"
                  >
                    {role}
                  </button>
                ))}
              </div>
            </form>
          ) : null}

          <div className="mt-4 grid gap-2 border-t border-hairline pt-3 text-row">
            <Link href="/mfa" className="underline underline-offset-4">
              Two-step verification
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="underline underline-offset-4">
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Source: the account mark at line 433. */
function AccountIcon() {
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
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 20c0-3.6 3.2-5.6 7.2-5.6s7.2 2 7.2 5.6" />
    </svg>
  );
}
