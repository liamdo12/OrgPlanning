"use client";

import { useActionState } from "react";
import { Button, Dialog, Input, Textarea } from "@occasion/ui";
import { recordExternalRefundAction, type OrderActionState } from "../actions";

/**
 * Recording a refund that has already happened.
 *
 * This writes no money. The money moved in the provider's dashboard; what this
 * does is stop the order claiming to hold funds it no longer holds, so the
 * payment label, the net captured figure and the next refund's ceiling all tell
 * the truth.
 *
 * The provider's refund id is required and is checked in the domain as well as
 * here. A recorded refund with nothing to check it against is a note, and a
 * note is not something the books can be reconciled from.
 */

const INITIAL: OrderActionState = {};

export function RecordExternalRefundDialog({
  open,
  onClose,
  onDone,
  orderId,
  reference,
  captured,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (state: OrderActionState) => void;
  orderId: string;
  reference: string;
  /** What is still captured — the most that can be recorded. */
  captured: string;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: OrderActionState, form: FormData) => {
      const next = await recordExternalRefundAction(previous, form);
      if (!next.error) onDone(next);
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog open={open} onClose={onClose} title={`Record a refund on ${reference}`}>
      <form action={submit}>
        <input type="hidden" name="orderId" value={orderId} />

        <p className="m-0 mb-4 max-w-[54ch] text-[14px] text-pretty text-ink">
          For a refund already made in the Stripe dashboard. Nothing is charged or returned here —
          this reconciles the order with what the provider has already done. {captured} is still
          captured on it.
        </p>

        <Input
          id={`refund-id-${orderId}`}
          name="providerRefundId"
          label="Stripe refund id"
          hint="Begins re_ — copy it from the refund in the dashboard."
          placeholder="re_3ABC…"
          required
        />

        <Input
          id={`refund-amount-${orderId}`}
          name="amount"
          label="Amount refunded"
          hint={`In dollars, up to ${captured}.`}
          inputMode="decimal"
          placeholder="203.40"
          required
        />

        <Textarea
          id={`refund-reason-${orderId}`}
          name="reason"
          label="Why"
          hint="Kept on the refund. The next person reconciling this reads it."
          required
          rows={3}
          {...(state.error ? { error: state.error } : {})}
        />

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" intent="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" intent="primary" disabled={pending}>
            {pending ? "Working…" : "Record it"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
