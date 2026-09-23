"use client";

import { useActionState, useState } from "react";
import { Button, Dialog } from "@occasion/ui";
import { cancelOwnBookingAction, type CancelState } from "../[orderId]/actions";

/**
 * Cancelling a booking, lines 1189–1196 of the order's own screen.
 *
 * **Only drawn while cancelling is actually free.** Outside the window the
 * screen says what cancelling would cost instead of offering a button that
 * comes back with a refusal — the domain refuses it either way, and a control
 * that exists only to be refused is a worse answer than a sentence.
 *
 * The refusal is rendered inside the dialog rather than thrown, because it is
 * something the person can act on: the window has closed, or the vendor has
 * already been paid, and both have a next step.
 */

const INITIAL: CancelState = {};

export function CancelDialog({
  orderId,
  reference,
  vendorName,
  refundAmount,
  freeUntil,
}: {
  orderId: string;
  reference: string;
  vendorName: string;
  /** What goes back, already formatted. */
  refundAmount: string;
  /** When the free window closes, already formatted. */
  freeUntil: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(cancelOwnBookingAction, INITIAL);

  return (
    <>
      <Button intent="danger" onClick={() => setOpen(true)}>
        Cancel this booking
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={`Cancel ${reference}?`}>
        <p className="m-0 text-[14px] text-pretty text-body">
          {vendorName} is released from this booking and {refundAmount} goes back to the card it was
          taken from. Free cancellation runs until {freeUntil}; after that this is no longer free.
        </p>

        {state.error ? (
          <p role="alert" className="oc-error mt-3">
            {state.error}
          </p>
        ) : null}

        <form action={submit} className="mt-5 flex flex-wrap justify-end gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <Button type="button" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button type="submit" intent="danger" disabled={pending}>
            {pending ? "Cancelling…" : "Cancel and refund"}
          </Button>
        </form>
      </Dialog>
    </>
  );
}
