"use client";

import { useActionState } from "react";
import { Button, Dialog, Input } from "@occasion/ui";
import { reseedAction, type OpsActionState } from "../actions";

/**
 * Rebuilding the demo data.
 *
 * The prototype has a "Reseed demo data" button and nothing behind it. What is
 * behind it here is the reason this is a dialog: the delete and the reseed
 * share one transaction, it touches only `is_demo` rows, and it refuses while
 * a job is running or a payment has no outcome yet — because deleting a row a
 * charge is halfway through loses the only record that the charge happened.
 *
 * The confirmation is the deployment's own name, typed. Not a checkbox: the
 * point is to make somebody read which deployment they are about to empty,
 * and `demo` and `local` are one word apart.
 */

const INITIAL: OpsActionState = {};

export function ReseedDialog({
  open,
  tier,
  onClose,
  onDone,
}: {
  open: boolean;
  tier: string;
  onClose: () => void;
  onDone: (state: OpsActionState) => void;
}) {
  const [state, submit, pending] = useActionState(
    async (previous: OpsActionState, form: FormData) => {
      const next = await reseedAction(previous, form);
      // Closing only on success: a refusal — a job still running, the wrong
      // word typed — has to stay beside the field that caused it.
      if (!next.error) onDone(next);
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog open={open} onClose={onClose} title="Reseed demo data">
      <form action={submit}>
        <p className="m-0 mb-4 max-w-[54ch] text-[14px] text-pretty text-ink">
          Every demo row is deleted and written again from the seed, in one transaction. Anything
          not flagged as demo is left alone. The seed&rsquo;s anchor moves to now, so every demo
          date shifts with it and any clock override is cleared.
        </p>

        <p className="m-0 mb-4 max-w-[54ch] text-[14px] text-pretty text-body">
          Seeded accounts come back without provider logins — nobody can sign in, the administrator
          included, until <code>auth:provision</code> is run again.
        </p>

        <Input
          id="reseed-confirmation"
          name="confirmation"
          label={`Type ${tier} to confirm`}
          hint="The deployment you are about to rebuild."
          autoComplete="off"
          required
          {...(state.error ? { error: state.error } : {})}
        />

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" intent="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" intent="danger" disabled={pending}>
            {pending ? "Rebuilding…" : "Reseed"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
