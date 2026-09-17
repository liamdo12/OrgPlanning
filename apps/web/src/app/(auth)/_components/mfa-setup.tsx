"use client";

import { useActionState } from "react";
import { Button, Input } from "@occasion/ui";
import { confirmEnrolmentAction, startEnrolmentAction, type EnrolmentState } from "../mfa/actions";

/**
 * Setting up two-step verification.
 *
 * Two steps on purpose. The provider hands out the QR code once, when the
 * factor is created, so it is shown by the result of the first action and the
 * second action confirms a code against that same factor. The factor id and the
 * text secret travel in hidden fields; the QR image stays in component state,
 * since it is the same secret in a larger form.
 */

const INITIAL: EnrolmentState = {};

export function MfaSetup() {
  const [started, start, starting] = useActionState(startEnrolmentAction, INITIAL);
  const [confirmed, confirm, confirming] = useActionState(confirmEnrolmentAction, INITIAL);

  const factorId = confirmed.factorId ?? started.factorId;
  const secret = confirmed.secret ?? started.secret;
  const error = confirmed.error ?? started.error;

  if (!factorId) {
    return (
      <form action={start} className="grid justify-items-start gap-4">
        <p className="text-row text-body">
          Add a second step to signing in. You will need an authenticator app such as 1Password,
          Google Authenticator or Authy.
        </p>
        {error ? (
          <p role="alert" className="oc-error">
            {error}
          </p>
        ) : null}
        <Button type="submit" intent="primary" disabled={starting}>
          {starting ? "Working…" : "Set up two-step verification"}
        </Button>
      </form>
    );
  }

  return (
    <form action={confirm} className="grid justify-items-start gap-4">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="secret" value={secret ?? ""} />

      {started.qrCode ? (
        // An inline SVG data URI from the provider, not a file to optimise.
        <img
          src={started.qrCode}
          alt="Scan this code with your authenticator app"
          width={200}
          height={200}
          className="rounded-card bg-white p-3"
        />
      ) : null}

      {secret ? (
        <p className="text-row text-body">
          Cannot scan? Enter this key instead:{" "}
          <code className="break-all font-mono text-xs">{secret}</code>
        </p>
      ) : null}

      <Input
        id="mfa-code"
        name="code"
        label="Six-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
        className="max-w-[10rem]"
        error={error}
      />

      <Button type="submit" intent="primary" disabled={confirming}>
        {confirming ? "Checking…" : "Turn on two-step verification"}
      </Button>
    </form>
  );
}
