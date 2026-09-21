"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { cx } from "@occasion/ui";
import { selectActiveEventAction } from "../actions";

/**
 * Which event "Add to event" adds to. Line 391.
 *
 * The selection has to survive a navigation — the detail screen checks
 * availability against the chosen event's date — so it lives in a cookie, and
 * a cookie can only be written from a server action. Each choice is therefore
 * a submit button in a form, not a click handler: a server component cannot
 * set cookies, and a fetch that did would be a second way to write the same
 * state.
 *
 * With no events the chip is a link to where one is made (line 2323's "Create
 * an event"), because a menu whose only entry is "you have none" is a menu
 * nobody should have to open.
 */
export function EventSwitcher({
  events,
  activeEventId,
}: {
  events: readonly { id: string; name: string }[];
  activeEventId: string | undefined;
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
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const active = events.find((event) => event.id === activeEventId);

  if (events.length === 0) {
    return (
      <Link href="/events" className={cx(CHIP, "no-underline hover:no-underline")}>
        <Dot />
        Create an event
      </Link>
    );
  }

  return (
    <div ref={container} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // Not `menu`: what opens is a form with a row of submit buttons, and
        // announcing a menu promises arrow keys that nothing implements.
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
        className={CHIP}
      >
        <Dot />
        {active?.name ?? "Choose an event"}
        <span aria-hidden="true" className="font-medium text-body">
          ▾
        </span>
      </button>

      {open ? (
        <form
          id={panelId}
          action={selectActiveEventAction}
          className="oc-overlay-surface absolute top-[calc(100%+8px)] right-0 z-50 grid w-[260px] gap-1 p-3 motion-safe:animate-rise"
        >
          {events.map((event) => (
            <button
              key={event.id}
              type="submit"
              name="eventId"
              value={event.id}
              aria-pressed={event.id === activeEventId}
              onClick={() => setOpen(false)}
              className="oc-chip w-full truncate text-left"
            >
              {event.name}
            </button>
          ))}
        </form>
      ) : null}
    </div>
  );
}

/** Line 391: a pill, 7px 13px, 13.5px/600. */
const CHIP =
  "flex items-center gap-2 rounded-pill border border-glass-edge-soft bg-glass-wash px-[13px] py-[7px] text-[13.5px] font-semibold whitespace-nowrap text-ink";

/** The small mark at line 392. Decorative: the name is beside it. */
function Dot() {
  return <span aria-hidden="true" className="size-[7px] flex-none rounded-pill bg-save" />;
}
