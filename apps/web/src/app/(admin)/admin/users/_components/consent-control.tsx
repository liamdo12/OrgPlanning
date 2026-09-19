"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button, StatusBadge, Toast, ToastRegion } from "@occasion/ui";
import type { MarketingConsent } from "@occasion/core";
import { setConsentAction, type UserActionState } from "../actions";

/**
 * What this account has agreed to receive, and the one button that changes it.
 *
 * Not in the prototype at all — its account screen has no notion of consent,
 * because its email screen sends to string-literal audiences. Recorded in
 * `docs/design-gaps.md`.
 *
 * It says which of three things is true rather than yes or no, because that is
 * what the record stores and because "why did this person not get the email" has
 * three different answers. **Implied consent is shown as not reachable**, which
 * surprises people: the law recognises it, but it is inferred from a transaction
 * rather than given, and this platform does not send marketing on an inference.
 * Saying "implied" without saying what follows from it would leave an
 * administrator expecting a send that will not happen.
 */

const INITIAL: UserActionState = {};

function describe(consent: MarketingConsent | null): {
  label: string;
  tone: "success" | "warn" | "neutral";
  detail: string;
  reachable: boolean;
} {
  if (!consent || consent.withdrawnAt || consent.basis === "withdrawn") {
    return {
      label: "No consent",
      tone: "neutral",
      detail: consent
        ? "Withdrawn. Broadcasts skip this account."
        : "Never given. Broadcasts skip this account.",
      reachable: false,
    };
  }

  if (consent.basis === "implied") {
    return {
      label: "Implied",
      tone: "warn",
      detail:
        "Inferred from a transaction rather than given, so broadcasts skip this account. Express consent is what reaches it.",
      reachable: false,
    };
  }

  const lapsed = consent.expiresAt !== null && consent.expiresAt.getTime() <= Date.now();

  return {
    label: lapsed ? "Expired" : "Express",
    tone: lapsed ? "warn" : "success",
    detail: lapsed
      ? "Given, and since lapsed. Broadcasts skip this account."
      : "Given. This account receives broadcasts.",
    reachable: !lapsed,
  };
}

export function ConsentControl({
  userId,
  consent,
}: {
  userId: string;
  consent: MarketingConsent | null;
}) {
  const router = useRouter();
  const [state, submit, pending] = useActionState(
    async (previous: UserActionState, form: FormData) => {
      const next = await setConsentAction(previous, form);
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );

  const current = describe(consent);

  return (
    <section>
      <h3 className="m-0 mb-2 text-[15px] font-bold">Marketing email</h3>

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={current.tone}>{current.label}</StatusBadge>
        <p className="m-0 max-w-[48ch] text-pretty text-[13px] text-body">{current.detail}</p>
      </div>

      <form action={submit} className="mt-3">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="granted" value={current.reachable ? "false" : "true"} />
        <Button
          type="submit"
          intent={current.reachable ? "ghost" : "secondary"}
          size="sm"
          disabled={pending}
        >
          {pending ? "Working…" : current.reachable ? "Withdraw consent" : "Record express consent"}
        </Button>
      </form>

      <p className="m-0 mt-2 max-w-[54ch] text-pretty text-[12.5px] text-muted">
        Recording consent here writes down something that happened elsewhere — a signup box, a phone
        call, an agreement. It is audited either way.
      </p>

      {state.error || state.message ? (
        <ToastRegion>
          <Toast tone={state.error ? "danger" : "success"}>{state.error ?? state.message}</Toast>
        </ToastRegion>
      ) : null}
    </section>
  );
}
