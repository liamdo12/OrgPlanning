"use client";

import { useActionState } from "react";
import { Button, Dialog, Textarea } from "@occasion/ui";
import { suspendUserAction, type UserActionState } from "../actions";

/**
 * Why an account is being suspended.
 *
 * A dialog rather than a confirm, because suspension is not a confirmation — it
 * is an entry. The reason is what the next administrator reads when the person
 * writes in asking why they cannot sign in.
 *
 * The consequence is stated before the field rather than discovered
 * afterwards: this signs them out of everything, not just the admin screens.
 */

const INITIAL: UserActionState = {};

export function SuspendDialog({
  open,
  onClose,
  onDone,
  userId,
  name,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (state: UserActionState) => void;
  userId: string;
  name: string;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: UserActionState, form: FormData) => {
      const next = await suspendUserAction(previous, form);
      // Closing only on success: a refusal has to stay beside the field that
      // caused it, or the reason for it is gone before it is read.
      if (!next.error) onDone(next);
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog open={open} onClose={onClose} title={`Suspend ${name}`}>
      <form action={submit}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="name" value={name} />

        <p className="m-0 mb-4 max-w-[54ch] text-[14px] text-pretty text-ink">
          {name} is signed out everywhere, not only here, and cannot sign in again until an
          administrator reinstates them.
        </p>

        <Textarea
          id={`suspend-reason-${userId}`}
          name="reason"
          label="Reason"
          hint="The next administrator to open this account reads it."
          required
          rows={3}
          {...(state.error ? { error: state.error } : {})}
        />

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" intent="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" intent="danger" disabled={pending}>
            {pending ? "Working…" : "Suspend"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
