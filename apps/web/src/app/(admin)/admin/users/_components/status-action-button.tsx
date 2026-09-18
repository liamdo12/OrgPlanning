"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Toast, ToastRegion, type ButtonIntent } from "@occasion/ui";
import type { UserAction } from "@occasion/core";
import {
  approveUserAction,
  reinstateUserAction,
  resendVerificationAction,
  type UserActionState,
} from "../actions";
import { SuspendDialog } from "./suspend-dialog";

/**
 * The one thing to do with an account in this state.
 *
 * Source: the row buttons at lines 2629–2634 — Active shows Suspend, Pending
 * shows Approve, Unverified shows "Resend email", Suspended shows Reinstate.
 * One button per row, because a row offering four decisions is a row nobody
 * reads; the rest live in the record.
 *
 * Which action belongs to which status is decided in the domain, not here, so
 * a row cannot offer something the service would refuse.
 */

const INITIAL: UserActionState = {};

type Decision = {
  label: string;
  intent: ButtonIntent;
  action?: (state: UserActionState, form: FormData) => Promise<UserActionState>;
  /** Suspension asks for a reason before it runs. */
  asksReason?: boolean;
};

function decisionFor(action: UserAction): Decision {
  switch (action) {
    case "suspend":
      return { label: "Suspend", intent: "danger", asksReason: true };
    case "approve":
      return { label: "Approve", intent: "primary", action: approveUserAction };
    case "resend-verification":
      return { label: "Resend email", intent: "secondary", action: resendVerificationAction };
    case "reinstate":
      return { label: "Reinstate", intent: "primary", action: reinstateUserAction };
  }
}

export function StatusActionButton({
  userId,
  name,
  action,
}: {
  userId: string;
  name: string;
  action: UserAction;
}) {
  const router = useRouter();
  const decision = decisionFor(action);
  const [asking, setAsking] = useState(false);
  // Held here rather than in the dialog, which unmounts on success and would
  // take the only account of what happened with it.
  const [reported, setReported] = useState<UserActionState | null>(null);

  const [state, submit, pending] = useActionState(
    async (previous: UserActionState, form: FormData) => {
      if (!decision.action) return previous;
      const next = await decision.action(previous, form);
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );

  const outcome = reported ?? state;
  // The label repeats down the list, so on its own the page offers "Suspend"
  // six times with nothing to tell them apart.
  const label = `${decision.label} ${name}`;

  if (decision.asksReason) {
    return (
      <>
        <Button
          intent={decision.intent}
          size="sm"
          onClick={() => setAsking(true)}
          aria-label={label}
        >
          {decision.label}
        </Button>

        <SuspendDialog
          open={asking}
          onClose={() => setAsking(false)}
          onDone={(result) => {
            setAsking(false);
            setReported(result);
            router.refresh();
          }}
          userId={userId}
          name={name}
        />

        <Outcome state={outcome} onDismiss={() => setReported(null)} />
      </>
    );
  }

  return (
    <>
      <form action={submit}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="name" value={name} />
        <Button
          type="submit"
          intent={decision.intent}
          size="sm"
          disabled={pending}
          aria-label={label}
        >
          {pending ? "Working…" : decision.label}
        </Button>
      </form>

      <Outcome state={outcome} onDismiss={() => setReported(null)} />
    </>
  );
}

/** What the decision did, said once. */
function Outcome({ state, onDismiss }: { state: UserActionState; onDismiss: () => void }) {
  if (!state.error && !state.message) return null;

  return (
    <ToastRegion>
      <Toast tone={state.error ? "danger" : "success"} onDismiss={onDismiss}>
        {state.error ?? state.message}
      </Toast>
    </ToastRegion>
  );
}
