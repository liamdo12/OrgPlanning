"use client";

import { useActionState } from "react";
import { clearSecondFactorAction, type AdminActionState } from "../actions";

/**
 * The way back in for someone who lost their authenticator.
 *
 * Deliberately not self-service: the person who cannot answer the challenge is
 * anonymous as far as the application is concerned, so somebody else has to
 * decide they are who they say they are.
 */

const INITIAL: AdminActionState = {};

export function ClearSecondFactorForm() {
  const [state, action, pending] = useActionState(clearSecondFactorAction, INITIAL);

  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="clear-mfa-email" className="mb-1 block text-sm font-medium">
          Account email
        </label>
        <input
          id="clear-mfa-email"
          name="email"
          type="email"
          autoComplete="off"
          required
          className="w-72 rounded-2xl border border-black/10 bg-white/70 px-4 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-2xl border border-black/20 px-4 py-2 text-sm font-semibold disabled:opacity-60"
      >
        {pending ? "Working…" : "Clear two-step verification"}
      </button>

      {state.error ? (
        <p role="alert" className="w-full text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="w-full text-sm">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
