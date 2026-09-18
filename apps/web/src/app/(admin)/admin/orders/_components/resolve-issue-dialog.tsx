"use client";

import { useActionState } from "react";
import { Button, Dialog, Select, Textarea } from "@occasion/ui";
import type { OrderState } from "@occasion/core";
import { resolveIssueAction, type OrderActionState } from "../actions";

/**
 * Closing an issue.
 *
 * Two decisions rather than one, which is why it is a dialog: where the booking
 * goes next, and what happened. The note is required by the domain as well as
 * by the field — a confirmation a form enforces is one a direct POST skips —
 * and it is what the next person reads, because the order's own `issueNote` is
 * cleared by this move.
 *
 * The consequence is stated before the fields: an order in `issue` has its
 * payouts paused by state alone, so resolving it is what lets money reach the
 * vendor again. That is not obvious from a button called "Resolve".
 */

const INITIAL: OrderActionState = {};

const WORDING: Record<string, string> = {
  confirmed: "Confirmed — the booking goes ahead",
  fulfilled: "Fulfilled — it was delivered",
  cancelled: "Cancelled — it is off",
};

export function ResolveIssueDialog({
  open,
  onClose,
  onDone,
  orderId,
  reference,
  resolutions,
  heldTransfers,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (state: OrderActionState) => void;
  orderId: string;
  reference: string;
  /** The states the lifecycle allows from `issue`, decided in the domain. */
  resolutions: readonly OrderState[];
  /** How many payouts on this order are parked, so the dialog can say so. */
  heldTransfers: number;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: OrderActionState, form: FormData) => {
      const next = await resolveIssueAction(previous, form);
      // Closing only on success: a refusal has to stay beside the field that
      // caused it, or the reason is gone before it is read.
      if (!next.error) onDone(next);
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog open={open} onClose={onClose} title={`Resolve the issue on ${reference}`}>
      <form action={submit}>
        <input type="hidden" name="orderId" value={orderId} />

        <p className="m-0 mb-4 max-w-[54ch] text-[14px] text-pretty text-ink">
          {heldTransfers > 0
            ? `${heldTransfers} ${heldTransfers === 1 ? "payout is" : "payouts are"} paused while this order is flagged. Resolving it to confirmed or fulfilled lets ${heldTransfers === 1 ? "it" : "them"} move again.`
            : "Payouts on a flagged order are paused. Nothing is currently waiting on this one."}
        </p>

        <Select
          id={`resolve-to-${orderId}`}
          name="to"
          label="Where does it go"
          options={resolutions.map((value) => ({
            value,
            label: WORDING[value] ?? value.replaceAll("_", " "),
          }))}
          required
        />

        <Textarea
          id={`resolve-note-${orderId}`}
          name="note"
          label="What happened"
          hint="Kept on the order's history. The next person reading this record sees it."
          required
          rows={3}
          {...(state.error ? { error: state.error } : {})}
        />

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" intent="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" intent="primary" disabled={pending}>
            {pending ? "Working…" : "Resolve"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
