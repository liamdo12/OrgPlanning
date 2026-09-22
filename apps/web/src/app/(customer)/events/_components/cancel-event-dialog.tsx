"use client";

import { useActionState, useState } from "react";
import { Button, Dialog, GlassPanel } from "@occasion/ui";
import { cancelEventAction, type EventFormState } from "../actions";

/**
 * The danger band and the dialog it opens, lines 1003–1012.
 *
 * Closing an event is refused while any booking on it is still live, and the
 * refusal names the booking — so it is shown **inside the dialog**, where the
 * person who pressed the button is looking, rather than thrown into the error
 * boundary where the reference would be lost.
 *
 * The band states what is booked rather than promising what cancelling will
 * cost: each vendor's own policy decides that, and this screen does not
 * compute it.
 */

const INITIAL: EventFormState = {};

export function CancelEventDialog({
  eventId,
  bookedCategories,
}: {
  eventId: string;
  bookedCategories: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(cancelEventAction, INITIAL);

  return (
    <>
      <GlassPanel
        as="section"
        aria-labelledby="cancel-event-heading"
        className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-overlay border-status-danger-fg/30 p-5"
      >
        <div>
          <h2 id="cancel-event-heading" className="m-0 mb-1 text-[16.5px]">
            Cancel this event
          </h2>
          <p className="m-0 max-w-[52ch] text-row text-pretty text-body">
            {bookedCategories.length === 0
              ? "Nothing is booked, so closing this event affects nobody. Its history is kept."
              : `${bookedCategories.length} ${bookedCategories.length === 1 ? "vendor is" : "vendors are"} booked. Each cancellation follows that vendor's own policy, and the booking has to be cancelled first.`}
          </p>
        </div>

        <Button intent="danger" onClick={() => setOpen(true)}>
          Review and cancel
        </Button>
      </GlassPanel>

      <Dialog open={open} onClose={() => setOpen(false)} title="Cancel this event?">
        <p className="m-0 text-[14px] text-pretty text-body">
          The event is closed and stops appearing in your planner. Nothing is deleted — its
          bookings, payments and history are kept, so everything stays explainable.
        </p>

        {state.error ? (
          <p role="alert" className="oc-error mt-3">
            {state.error}
          </p>
        ) : null}

        <form action={submit} className="mt-5 flex flex-wrap justify-end gap-2">
          <input type="hidden" name="eventId" value={eventId} />
          <Button type="button" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button type="submit" intent="danger" disabled={pending}>
            {pending ? "Cancelling…" : "Cancel this event"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
