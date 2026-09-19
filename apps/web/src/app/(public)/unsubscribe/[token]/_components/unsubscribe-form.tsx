"use client";

import { useActionState } from "react";
import { Button } from "@occasion/ui";
import { unsubscribeAction, type UnsubscribeState } from "../actions";

const INITIAL: UnsubscribeState = { done: false };

/**
 * The button that actually withdraws consent.
 *
 * A POST, so that a mail client or link scanner fetching the URL in the message
 * does not unsubscribe somebody who never clicked it.
 */
export function UnsubscribeForm({ token }: { token: string }) {
  const [state, submit, pending] = useActionState(unsubscribeAction, INITIAL);

  if (state.done) {
    return (
      <p className="m-0 max-w-[60ch] text-pretty text-body">
        Done. You will not receive marketing email from us again. If you book something, the
        messages about that booking still arrive.
      </p>
    );
  }

  return (
    <form action={submit}>
      <input type="hidden" name="token" value={token} />
      <Button type="submit" intent="primary" disabled={pending}>
        {pending ? "One moment…" : "Unsubscribe"}
      </Button>
    </form>
  );
}
