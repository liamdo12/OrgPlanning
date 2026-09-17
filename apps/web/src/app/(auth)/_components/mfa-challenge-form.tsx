"use client";

import { useActionState } from "react";
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
    <form action={action} className="space-y-4">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />

      <div>
        <label htmlFor="challenge-code" className="mb-1 block text-sm font-medium">
          Six-digit code
        </label>
        <input
          id="challenge-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          className="w-40 rounded-2xl border border-black/10 bg-white/70 px-4 py-3 font-mono text-sm tracking-widest"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-[var(--color-forest)] px-4 py-3 text-sm font-semibold text-[var(--color-canvas)] disabled:opacity-60"
      >
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
