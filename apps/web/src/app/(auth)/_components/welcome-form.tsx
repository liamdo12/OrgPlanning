"use client";

import { useActionState } from "react";
import { completeProfileAction, type AuthActionState } from "../actions";
import { RoleChoice } from "./role-choice";

/**
 * The one question a provider sign-in cannot answer.
 *
 * Google says who someone is; it does not say whether they came here to plan an
 * event or to sell services. The name is prefilled from the provider and stays
 * editable, because the name on a Google account is not always the name someone
 * wants on a quote.
 */

const INITIAL: AuthActionState = {};

export function WelcomeForm({
  email,
  suggestedName,
  next,
}: {
  email: string;
  suggestedName: string;
  next: string;
}) {
  const [state, action, pending] = useActionState(completeProfileAction, INITIAL);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <p className="text-sm opacity-70">
        Signed in as <span className="font-medium opacity-100">{email}</span>
      </p>

      <RoleChoice error={state.fieldErrors?.["role"]} />

      <div>
        <label htmlFor="welcome-name" className="mb-1 block text-sm font-medium">
          Your name
        </label>
        <input
          id="welcome-name"
          name="fullName"
          type="text"
          autoComplete="name"
          defaultValue={suggestedName}
          required
          className="w-full rounded-2xl border border-black/10 bg-white/70 px-4 py-3 text-sm"
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
        {pending ? "Working…" : "Finish setting up"}
      </button>
    </form>
  );
}
