"use client";

import { useActionState } from "react";
import { Button, Input } from "@occasion/ui";
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
      <Input
        id="clear-mfa-email"
        name="email"
        label="Account email"
        type="email"
        autoComplete="off"
        required
        className="w-72"
      />

      <Button type="submit" intent="ghost" disabled={pending}>
        {pending ? "Working…" : "Clear two-step verification"}
      </Button>

      {state.error ? (
        <p role="alert" className="oc-error w-full">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="w-full text-row">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
