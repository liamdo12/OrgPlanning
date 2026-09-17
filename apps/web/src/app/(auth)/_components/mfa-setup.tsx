"use client";

import { useActionState } from "react";
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
      <form action={start} className="space-y-4">
        <p className="text-sm opacity-70">
          Add a second step to signing in. You will need an authenticator app such as 1Password,
          Google Authenticator or Authy.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={starting}
          className="rounded-2xl bg-[var(--color-forest)] px-4 py-3 text-sm font-semibold text-[var(--color-canvas)] disabled:opacity-60"
        >
          {starting ? "Working…" : "Set up two-step verification"}
        </button>
      </form>
    );
  }

  return (
    <form action={confirm} className="space-y-4">
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="secret" value={secret ?? ""} />

      {started.qrCode ? (
        // An inline SVG data URI from the provider, not a file to optimise.
        <img
          src={started.qrCode}
          alt="Scan this code with your authenticator app"
          width={200}
          height={200}
          className="rounded-2xl bg-white p-3"
        />
      ) : null}

      {secret ? (
        <p className="text-sm opacity-70">
          Cannot scan? Enter this key instead:{" "}
          <code className="break-all font-mono text-xs">{secret}</code>
        </p>
      ) : null}

      <div>
        <label htmlFor="mfa-code" className="mb-1 block text-sm font-medium">
          Six-digit code
        </label>
        <input
          id="mfa-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          className="w-40 rounded-2xl border border-black/10 bg-white/70 px-4 py-3 font-mono text-sm tracking-widest"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={confirming}
        className="rounded-2xl bg-[var(--color-forest)] px-4 py-3 text-sm font-semibold text-[var(--color-canvas)] disabled:opacity-60"
      >
        {confirming ? "Checking…" : "Turn on two-step verification"}
      </button>
    </form>
  );
}
