"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Toast, ToastRegion } from "@occasion/ui";
import type { OrderActions as Available } from "@occasion/core";
import { fulfilOrderAction, retryBalanceAction, type OrderActionState } from "../actions";
import { RefundDialog } from "./refund-dialog";
import { RecordExternalRefundDialog } from "./record-external-refund-dialog";
import { ResolveIssueDialog } from "./resolve-issue-dialog";

/**
 * What can be done to this order, and only that.
 *
 * Which buttons appear is decided in the domain, not here: `available` comes
 * from the same lifecycle table the services check against, so the screen
 * cannot offer a move that would be refused. A button that always fails teaches
 * people the screen is broken.
 *
 * Two of the five run straight from a form — marking an order delivered and
 * retrying a balance are single decisions with nothing to fill in. The other
 * three ask something first: where an issue goes and why, a confirmation of a
 * fixed refund amount, and the provider's id for one already made.
 */

const INITIAL: OrderActionState = {};

export function OrderActions({
  orderId,
  reference,
  available,
  refundAmount,
  windowEnds,
  captured,
  heldTransfers,
}: {
  orderId: string;
  reference: string;
  available: Available;
  refundAmount: string;
  windowEnds: string;
  captured: string;
  heldTransfers: number;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<"resolve" | "refund" | "record" | null>(null);
  // Held here rather than in a dialog, which unmounts on success and would take
  // the only account of what happened with it.
  const [reported, setReported] = useState<OrderActionState | null>(null);

  const done = (result: OrderActionState) => {
    setAsking(null);
    setReported(result);
    router.refresh();
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {available.fulfil ? (
          <SubmitButton
            orderId={orderId}
            reference={reference}
            label="Mark fulfilled"
            busy="Working…"
            action={fulfilOrderAction}
            onDone={setReported}
          />
        ) : null}

        {available.retryBalance ? (
          <SubmitButton
            orderId={orderId}
            reference={reference}
            label="Retry balance"
            busy="Charging…"
            intent="secondary"
            action={retryBalanceAction}
            onDone={setReported}
          />
        ) : null}

        {available.resolveIssue ? (
          <Button intent="primary" size="sm" onClick={() => setAsking("resolve")}>
            Resolve issue
          </Button>
        ) : null}

        {available.refundInApp ? (
          <Button intent="danger" size="sm" onClick={() => setAsking("refund")}>
            Refund
          </Button>
        ) : null}

        {available.recordExternalRefund ? (
          <Button intent="ghost" size="sm" onClick={() => setAsking("record")}>
            Record a dashboard refund
          </Button>
        ) : null}
      </div>

      {/* Why the in-app refund is not offered, rather than its absence. An
          administrator who cannot find the button needs to be told where the
          refund is made instead, not left looking for it. */}
      {available.refundBlocked ? (
        <p className="mt-2 mb-0 max-w-[60ch] text-row text-body">{available.refundBlocked}</p>
      ) : null}

      {available.resolveIssue ? (
        <ResolveIssueDialog
          open={asking === "resolve"}
          onClose={() => setAsking(null)}
          onDone={done}
          orderId={orderId}
          reference={reference}
          resolutions={available.resolutions}
          heldTransfers={heldTransfers}
        />
      ) : null}

      {available.refundInApp ? (
        <RefundDialog
          open={asking === "refund"}
          onClose={() => setAsking(null)}
          onDone={done}
          orderId={orderId}
          reference={reference}
          amount={refundAmount}
          windowEnds={windowEnds}
        />
      ) : null}

      {available.recordExternalRefund ? (
        <RecordExternalRefundDialog
          open={asking === "record"}
          onClose={() => setAsking(null)}
          onDone={done}
          orderId={orderId}
          reference={reference}
          captured={captured}
        />
      ) : null}

      <Outcome state={reported ?? INITIAL} onDismiss={() => setReported(null)} />
    </>
  );
}

/** One decision with nothing to fill in. */
function SubmitButton({
  orderId,
  reference,
  label,
  busy,
  intent = "primary",
  action,
  onDone,
}: {
  orderId: string;
  reference: string;
  label: string;
  busy: string;
  intent?: "primary" | "secondary";
  action: (state: OrderActionState, form: FormData) => Promise<OrderActionState>;
  onDone: (state: OrderActionState) => void;
}) {
  const router = useRouter();

  const [, submit, pending] = useActionState(async (previous: OrderActionState, form: FormData) => {
    const next = await action(previous, form);
    onDone(next);
    if (!next.error) router.refresh();
    return next;
  }, INITIAL);

  return (
    <form action={submit}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="reference" value={reference} />
      <Button
        type="submit"
        intent={intent}
        size="sm"
        disabled={pending}
        aria-label={`${label} on ${reference}`}
      >
        {pending ? busy : label}
      </Button>
    </form>
  );
}

/** What the decision did, said once. */
function Outcome({ state, onDismiss }: { state: OrderActionState; onDismiss: () => void }) {
  if (!state.error && !state.message) return null;

  return (
    <ToastRegion>
      <Toast tone={state.error ? "danger" : "success"} onDismiss={onDismiss}>
        {state.error ?? state.message}
      </Toast>
    </ToastRegion>
  );
}
