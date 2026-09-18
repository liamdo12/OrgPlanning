"use client";

import { useActionState } from "react";
import { Button, Dialog, Textarea } from "@occasion/ui";
import type { VendorActionState } from "../actions";

/**
 * The reason a business is suspended or blocked.
 *
 * A dialog rather than an inline confirm because suspension is not a
 * confirmation — it is an entry. The reason reaches the vendor and the next
 * administrator who opens the record, and a decision nobody wrote down is one
 * nobody can safely undo.
 *
 * The consequences are spelled out above the field rather than left to be
 * discovered: this stops money that is already scheduled and signs the
 * business's staff out, and an administrator should know both before they type.
 */

const INITIAL: VendorActionState = {};

export function SuspendDialog({
  open,
  onClose,
  onDone,
  vendorId,
  vendorName,
  intent,
  action,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * What the change did, once it has succeeded.
   *
   * Reported upward rather than shown here, because this closes on success —
   * a message rendered inside a dialog that is about to unmount is a message
   * nobody reads, and on this path it is the only account of the payouts that
   * were held and the sessions that ended.
   */
  onDone: (state: VendorActionState) => void;
  vendorId: string;
  vendorName: string;
  intent: "suspend" | "block";
  action: (state: VendorActionState, form: FormData) => Promise<VendorActionState>;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: VendorActionState, form: FormData) => {
      const next = await action(previous, form);
      // Closing only on success: a refusal has to stay on screen next to the
      // field that caused it, or the reason for it is gone before it is read.
      if (!next.error) onDone(next);
      return next;
    },
    INITIAL,
  );

  const verb = intent === "suspend" ? "Suspend" : "Block";

  return (
    <Dialog open={open} onClose={onClose} title={`${verb} ${vendorName}`}>
      <form action={submit}>
        <input type="hidden" name="vendorId" value={vendorId} />

        <p className="m-0 mb-4 max-w-[54ch] text-[14px] text-pretty text-ink">
          Queued payouts to {vendorName} are put on hold, and everyone who works there is signed
          out. Both can be undone by reinstating them.
        </p>

        <Textarea
          id={`${intent}-reason-${vendorId}`}
          name="reason"
          label="Reason"
          hint="The vendor is told this, and the next admin to open the record reads it."
          required
          rows={3}
          {...(state.error ? { error: state.error } : {})}
        />

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" intent="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" intent="danger" disabled={pending}>
            {pending ? "Working…" : verb}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
