"use client";

import { useActionState } from "react";
import { Button, Dialog } from "@occasion/ui";
import { refundAction, type OrderActionState } from "../actions";

/**
 * The cooling-window refund.
 *
 * **There is no amount field, and that is the design.** This is the one refund
 * the platform performs in-app, and it is safe to expose without the override
 * authority a partial would need precisely because the figure is fixed: a
 * cancellation inside the free window returns everything that has been
 * captured, and nothing has been transferred to the vendor yet, so there is no
 * reversal to keep in step.
 *
 * Partial, post-transfer, policy-computed and disputed refunds are made in the
 * provider's dashboard and recorded here afterwards. That split is a scope
 * decision with a reason: an amount field on this dialog would be an
 * unaudited override of a policy this milestone has not written.
 */

const INITIAL: OrderActionState = {};

export function RefundDialog({
  open,
  onClose,
  onDone,
  orderId,
  reference,
  amount,
  windowEnds,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (state: OrderActionState) => void;
  orderId: string;
  reference: string;
  /** What will go back: everything still captured on the order. */
  amount: string;
  /** When the free window closes, already formatted. */
  windowEnds: string;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: OrderActionState, form: FormData) => {
      const next = await refundAction(previous, form);
      if (!next.error) onDone(next);
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog open={open} onClose={onClose} title={`Refund ${reference}`}>
      <form action={submit}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="reference" value={reference} />

        <p className="m-0 mb-2 text-[24px] font-bold">{amount}</p>

        <p className="m-0 mb-4 max-w-[54ch] text-[14px] text-pretty text-ink">
          Everything captured on this order goes back, the booking is cancelled, and the date
          returns to the vendor&rsquo;s calendar. The free cancellation window closes {windowEnds};
          after that this refund is made in the Stripe dashboard and recorded here instead.
        </p>

        {state.error ? (
          <p role="alert" className="oc-error m-0 mb-4">
            {state.error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" intent="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" intent="danger" disabled={pending}>
            {pending ? "Working…" : `Refund ${amount}`}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
