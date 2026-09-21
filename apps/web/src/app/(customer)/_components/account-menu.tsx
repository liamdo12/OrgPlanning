"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@occasion/ui";
import { signOutAction } from "../../(auth)/actions";

/**
 * Who you are, and the one thing you can do about it here.
 *
 * The prototype's header has an Account button that navigates to an account
 * page (line 432). There is no account page in this plan, and the thing
 * somebody actually needs from the header is a way out — so this follows the
 * admin shell's precedent and is a menu rather than a route.
 *
 * Not a role switcher. An administrator is refused on these screens entirely,
 * and a vendor's other surface does not exist yet; a chip that switches to
 * nowhere would be a control that appears to do something.
 */
export function AccountMenu({ email }: { email: string }) {
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
      // A click on another header control closes this and then does its own
      // job, rather than being swallowed by the dismissal.
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
        aria-haspopup="true"
        // The label is hidden on a phone, so without this the control has no
        // accessible name there. The prototype labels it at line 432.
        aria-label="Account"
        onClick={() => setOpen((current) => !current)}
        className="flex cursor-pointer items-center gap-[7px] rounded-pill border border-glass-edge bg-chip px-[13px] py-2 text-[13px] font-semibold"
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
            {/* One line: the actor carries no display name, so a second would
                be the address printed twice. */}
            <p className="m-0 min-w-0 truncate text-row font-bold">{email}</p>
          </div>

          <form action={signOutAction} className="mt-4 border-t border-hairline pt-3 text-row">
            <button type="submit" className="cursor-pointer underline underline-offset-4">
              Sign out
            </button>
          </form>
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
