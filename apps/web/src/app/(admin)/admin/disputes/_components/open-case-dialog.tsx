"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Input, Textarea, Toast, ToastRegion } from "@occasion/ui";
import { openDisputeAction, type DisputeActionState } from "../actions";

/**
 * Recording a complaint that arrived some other way.
 *
 * Most complaints will reach the platform through the customer views, which are
 * not built yet — and until they are, every one of them arrives by phone or
 * email. A queue that can only be filled by a screen nobody has written is a
 * queue that stays empty.
 *
 * The booking is named by its reference, which is what a customer can read out.
 */

const INITIAL: DisputeActionState = {};

export function OpenCaseDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState<DisputeActionState | null>(null);

  const [state, submit, pending] = useActionState(
    async (previous: DisputeActionState, form: FormData) => {
      const next = await openDisputeAction(previous, form);
      if (!next.error) {
        setOpen(false);
        setReported(next);
        router.refresh();
      }
      return next;
    },
    INITIAL,
  );

  return (
    <>
      <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
        Record a complaint
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Record a complaint">
        <form action={submit} className="grid gap-3">
          <Input
            id="case-reference"
            name="reference"
            label="Booking reference"
            placeholder="TO-4192"
            required
            {...(state.error ? { error: state.error } : {})}
          />
          <Input
            id="case-reason"
            name="reason"
            label="What the complaint is"
            placeholder="Delivered late"
            required
          />
          <Textarea
            id="case-detail"
            name="detail"
            label="What was said"
            hint="Internal. Nobody outside the platform sees it."
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" intent="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" intent="primary" disabled={pending}>
              {pending ? "Opening…" : "Open the case"}
            </Button>
          </div>
        </form>
      </Dialog>

      {reported?.message ? (
        <ToastRegion>
          <Toast tone="success" onDismiss={() => setReported(null)}>
            {reported.message}
          </Toast>
        </ToastRegion>
      ) : null}
    </>
  );
}
