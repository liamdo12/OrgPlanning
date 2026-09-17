"use client";

import { useActionState } from "react";
import { Button, Input } from "@occasion/ui";
import { requestPasswordResetAction, type AuthActionState } from "../actions";

const INITIAL: AuthActionState = {};

/**
 * Always reports the same outcome, whether or not the address has an account.
 * Telling the difference would let anyone test which addresses are registered.
 */
export function ResetForm() {
  const [, formAction, pending] = useActionState(requestPasswordResetAction, INITIAL);

  return (
    <form action={formAction} className="mt-6 grid gap-4">
      <Input
        id="reset-email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="sarah@example.ca"
        required
      />
      <Button type="submit" intent="primary" size="lg" disabled={pending}>
        {pending ? "Sending…" : "Send the link"}
      </Button>
    </form>
  );
}
