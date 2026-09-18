"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Toast, ToastRegion, type ButtonIntent } from "@occasion/ui";
import type { VendorStatus } from "@occasion/core";
import {
  approveVendorAction,
  blockVendorAction,
  markUnderReviewAction,
  reinstateVendorAction,
  suspendVendorAction,
  type VendorActionState,
} from "../actions";
import { SuspendDialog } from "./suspend-dialog";

/**
 * What may be done with a vendor in this state.
 *
 * One list, read twice: the row shows the first entry — the prototype draws
 * exactly one button per row (lines 2715–2720) — and the record shows all of
 * them, which is where an administrator is looking at enough to choose between
 * approving an application and refusing it.
 *
 * The order matters, because the first entry is what the row offers. It is the
 * ordinary decision in each state, never the destructive one.
 */

const INITIAL: VendorActionState = {};

export type Decision = {
  id: string;
  label: string;
  intent: ButtonIntent;
  action: (state: VendorActionState, form: FormData) => Promise<VendorActionState>;
  /** Suspension and blocking ask for a reason before they run. */
  reasonFor?: "suspend" | "block";
};

export function decisionsFor(status: VendorStatus): readonly Decision[] {
  switch (status) {
    case "pending":
      // Source: line 2716 — a pending vendor's row button is a filled Approve.
      return [
        { id: "approve", label: "Approve", intent: "primary", action: approveVendorAction },
        {
          id: "block",
          label: "Block",
          intent: "danger",
          action: blockVendorAction,
          reasonFor: "block",
        },
      ];
    case "approved":
      // Source: line 2715 — an approved vendor's row button is Suspend, drawn
      // as a warm outline rather than a red fill, because it sits in a list.
      return [
        {
          id: "suspend",
          label: "Suspend",
          intent: "danger",
          action: suspendVendorAction,
          reasonFor: "suspend",
        },
      ];
    case "suspended":
      return [
        { id: "reinstate", label: "Reinstate", intent: "primary", action: reinstateVendorAction },
      ];
    case "blocked":
      // Source: line 2718 — a blocked vendor's row button is Review. The
      // prototype's does nothing; here it is the decision that follows reading
      // the record, putting the business back in the queue for a second pass.
      return [
        { id: "review", label: "Review", intent: "secondary", action: markUnderReviewAction },
        { id: "approve", label: "Approve", intent: "primary", action: approveVendorAction },
      ];
  }
}

export function StatusActionButton({
  vendorId,
  vendorName,
  decision,
}: {
  vendorId: string;
  vendorName: string;
  decision: Decision;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  // Held here rather than in the dialog, which unmounts on success and would
  // take the only account of what happened with it.
  const [reported, setReported] = useState<VendorActionState | null>(null);

  const [state, submit, pending] = useActionState(
    async (previous: VendorActionState, form: FormData) => {
      const next = await decision.action(previous, form);
      // The action revalidates the path; this is what makes the open page
      // re-read it without a full navigation.
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );

  const outcome = reported ?? state;

  // The label repeats down the list, so on its own the page offers "Approve"
  // four times with nothing to tell them apart.
  const label = `${decision.label} ${vendorName}`;

  if (decision.reasonFor) {
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
          vendorId={vendorId}
          vendorName={vendorName}
          intent={decision.reasonFor}
          action={decision.action}
        />

        <Outcome state={outcome} onDismiss={() => setReported(null)} />
      </>
    );
  }

  return (
    <>
      <form action={submit}>
        <input type="hidden" name="vendorId" value={vendorId} />
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

/**
 * What the decision did, said once.
 *
 * On the suspend and block paths this is the *only* place the held payouts and
 * the ended sessions are reported — the row shows a badge, and a badge does not
 * say whether money stopped.
 */
function Outcome({ state, onDismiss }: { state: VendorActionState; onDismiss: () => void }) {
  if (!state.error && !state.message) return null;

  return (
    <ToastRegion>
      <Toast tone={state.error ? "danger" : "success"} onDismiss={onDismiss}>
        {state.error ?? state.message}
      </Toast>
    </ToastRegion>
  );
}

/** The row's single contextual action. */
export function RowAction({
  vendorId,
  vendorName,
  status,
}: {
  vendorId: string;
  vendorName: string;
  status: VendorStatus;
}) {
  const [first] = decisionsFor(status);
  if (!first) return null;

  return <StatusActionButton vendorId={vendorId} vendorName={vendorName} decision={first} />;
}

/** Every legal move, for the record. */
export function AllActions({
  vendorId,
  vendorName,
  status,
}: {
  vendorId: string;
  vendorName: string;
  status: VendorStatus;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {decisionsFor(status).map((decision) => (
        <StatusActionButton
          key={decision.id}
          vendorId={vendorId}
          vendorName={vendorName}
          decision={decision}
        />
      ))}
    </div>
  );
}
