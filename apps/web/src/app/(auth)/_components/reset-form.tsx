"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type AuthActionState } from "../actions";

const INITIAL: AuthActionState = {};

/**
 * Always reports the same outcome, whether or not the address has an account.
 * Telling the difference would let anyone test which addresses are registered.
 */
export function ResetForm() {
  const [, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="reset-email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-[var(--color-forest)] px-4 py-3 text-sm font-semibold text-[var(--color-canvas)] disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send the link"}
      </button>
    </form>
  );
}
