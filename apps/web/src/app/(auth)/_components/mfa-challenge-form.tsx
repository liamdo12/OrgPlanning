"use client";

import { useActionState } from "react";
import { Button, Input } from "@occasion/ui";
import { verifyChallengeAction, type ChallengeState } from "../mfa/actions";

/**
 * The second step of signing in.
 *
 * Reached with a valid password and a session the domain does not yet accept:
 * until this succeeds, `getActor` reports the caller as anonymous, so there is
 * nothing to be gained by navigating away from this page.
 */

const INITIAL: ChallengeState = {};

export function MfaChallengeForm({ factorId, next }: { factorId: string; next: string }) {
  const [state, action, pending] = useActionState(verifyChallengeAction, INITIAL);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />

      <Input
        id="challenge-code"
        name="code"
        label="Six-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
        autoFocus
        className="max-w-[10rem]"
        error={state.error}
      />

      <Button type="submit" intent="primary" size="lg" disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}
