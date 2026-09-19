"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Select, Textarea, Toast, ToastRegion } from "@occasion/ui";
import {
  addNoteAction,
  assignDisputeAction,
  resolveDisputeAction,
  startReviewAction,
  type DisputeActionState,
} from "../actions";

/**
 * What can be done with a case, and the forms that do it.
 *
 * Client components because each one reports what happened: a resolution can
 * move the booking as well as close the case, and that is the only place the
 * person finds out it did.
 */

const INITIAL: DisputeActionState = {};

function Outcome({ state, onDismiss }: { state: DisputeActionState; onDismiss: () => void }) {
  if (!state.error && !state.message) return null;

  return (
    <ToastRegion>
      <Toast tone={state.error ? "danger" : "success"} onDismiss={onDismiss}>
        {state.error ?? state.message}
      </Toast>
    </ToastRegion>
  );
}

/** A form whose only job is to submit one hidden id. */
function OneButtonForm({
  disputeId,
  action,
  label,
  working,
  intent = "secondary",
  extra,
}: {
  disputeId: string;
  action: (state: DisputeActionState, form: FormData) => Promise<DisputeActionState>;
  label: string;
  working: string;
  intent?: "primary" | "secondary" | "ghost" | "danger";
  extra?: Record<string, string>;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(
    async (previous: DisputeActionState, form: FormData) => {
      const next = await action(previous, form);
      // The action revalidates the path; this is what makes the open page
      // re-read it without a full navigation.
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );
  const [dismissed, setDismissed] = useState(false);

  return (
    <>
      <form action={submit}>
        <input type="hidden" name="disputeId" value={disputeId} />
        {Object.entries(extra ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Button type="submit" intent={intent} size="sm" disabled={pending}>
          {pending ? working : label}
        </Button>
      </form>

      <Outcome state={dismissed ? INITIAL : state} onDismiss={() => setDismissed(true)} />
    </>
  );
}

export function StartReviewButton({ disputeId }: { disputeId: string }) {
  return (
    <OneButtonForm
      disputeId={disputeId}
      action={startReviewAction}
      label="Start investigating"
      working="Working…"
      intent="primary"
    />
  );
}

/**
 * Taking a case, or putting it back.
 *
 * "Assign to me" rather than a directory of administrators: this milestone has
 * no screen listing them, and a picker over every account would offer to assign
 * a complaint to the customer who made it. The domain refuses that whatever the
 * form sends.
 */
export function AssignControls({
  disputeId,
  meId,
  assignedToMe,
  assignedToName,
}: {
  disputeId: string;
  meId: string;
  assignedToMe: boolean;
  assignedToName: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm opacity-70">
        {assignedToName ? `With ${assignedToName}` : "Nobody has picked this up"}
      </span>

      {assignedToMe ? (
        <OneButtonForm
          disputeId={disputeId}
          action={assignDisputeAction}
          label="Put it back"
          working="Working…"
          intent="ghost"
          extra={{ userId: "" }}
        />
      ) : (
        <OneButtonForm
          disputeId={disputeId}
          action={assignDisputeAction}
          label="Assign to me"
          working="Working…"
          extra={{ userId: meId }}
        />
      )}
    </div>
  );
}

export function AddNoteForm({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(
    async (previous: DisputeActionState, form: FormData) => {
      const next = await addNoteAction(previous, form);
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );
  const [dismissed, setDismissed] = useState(false);

  return (
    <>
      <form action={submit} className="grid gap-3">
        <input type="hidden" name="disputeId" value={disputeId} />
        <Textarea
          id={`note-${disputeId}`}
          name="body"
          label="Internal note"
          hint="Nobody outside the platform sees this."
          rows={3}
          required
          {...(state.error ? { error: state.error } : {})}
        />
        <div>
          <Button type="submit" intent="secondary" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Add note"}
          </Button>
        </div>
      </form>

      <Outcome
        state={dismissed || state.error ? INITIAL : state}
        onDismiss={() => setDismissed(true)}
      />
    </>
  );
}

/**
 * Closing a case.
 *
 * The booking's next state is asked for only when the booking is actually
 * waiting on this complaint. Offering it otherwise would invite somebody to
 * move an order that had nothing to do with the case — which the domain refuses
 * anyway, but a form that offers a refused choice is a form that wastes
 * somebody's afternoon.
 */
export function ResolveForm({
  disputeId,
  orderInIssue,
  orderReference,
}: {
  disputeId: string;
  orderInIssue: boolean;
  orderReference: string;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(
    async (previous: DisputeActionState, form: FormData) => {
      const next = await resolveDisputeAction(previous, form);
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );
  const [dismissed, setDismissed] = useState(false);

  return (
    <>
      <form action={submit} className="grid gap-3">
        <input type="hidden" name="disputeId" value={disputeId} />

        <Select
          id={`resolution-${disputeId}`}
          name="resolution"
          label="Outcome"
          defaultValue="vendor_warned"
          options={[
            { value: "refund_recorded", label: "Refunded — recorded against the order" },
            { value: "vendor_warned", label: "Vendor warned" },
            { value: "dismissed", label: "Dismissed — nothing to answer" },
          ]}
        />

        {orderInIssue ? (
          <Select
            id={`order-to-${disputeId}`}
            name="orderTo"
            label={`Where ${orderReference} goes`}
            hint="The booking is held on this complaint and has to go somewhere."
            defaultValue="confirmed"
            options={[
              { value: "confirmed", label: "Back to confirmed" },
              { value: "fulfilled", label: "Fulfilled" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
        ) : null}

        <Textarea
          id={`resolution-note-${disputeId}`}
          name="note"
          label="How it was resolved"
          hint="Kept on the case and on the audit trail."
          rows={3}
          required
          {...(state.error ? { error: state.error } : {})}
        />

        <div>
          <Button type="submit" intent="primary" size="sm" disabled={pending}>
            {pending ? "Closing…" : "Close the case"}
          </Button>
        </div>
      </form>

      <Outcome
        state={dismissed || state.error ? INITIAL : state}
        onDismiss={() => setDismissed(true)}
      />
    </>
  );
}
