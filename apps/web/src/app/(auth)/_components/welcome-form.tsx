"use client";

import { useActionState } from "react";
import { Button, Input } from "@occasion/ui";
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
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />

      <p className="text-row text-body">
        Signed in as <span className="font-semibold text-ink">{email}</span>
      </p>

      <RoleChoice error={state.fieldErrors?.["role"]} />

      <Input
        id="welcome-name"
        name="fullName"
        label="Your name"
        type="text"
        autoComplete="name"
        defaultValue={suggestedName}
        required
      />

      {state.error ? (
        <p role="alert" className="oc-error">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" intent="primary" size="lg" disabled={pending}>
        {pending ? "Working…" : "Finish setting up"}
      </Button>
    </form>
  );
}
