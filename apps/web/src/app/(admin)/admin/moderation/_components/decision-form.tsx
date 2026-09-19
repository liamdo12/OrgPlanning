"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Toast, ToastRegion } from "@occasion/ui";
import { decideReportAction, type ModerationActionState } from "../actions";

/**
 * The decision on one report.
 *
 * The buttons offered are the ones that mean something for this kind of
 * content — a profile line has nowhere to be hidden to, so it gets two. The
 * list comes from the domain with the row rather than being decided here, so
 * the screen and the service cannot disagree about what is on offer.
 *
 * `remove` is the danger tone because it is the only one that destroys
 * anything.
 */

const INITIAL: ModerationActionState = {};

const LABELS: Record<string, { label: string; intent: "primary" | "secondary" | "danger" }> = {
  keep: { label: "Keep", intent: "primary" },
  hide: { label: "Hide", intent: "secondary" },
  remove: { label: "Remove", intent: "danger" },
};

export function DecisionForm({
  reportId,
  choices,
  hint,
}: {
  reportId: string;
  choices: readonly string[];
  hint?: string;
}) {
  const router = useRouter();
  const [reported, setReported] = useState<ModerationActionState | null>(null);

  const [state, submit, pending] = useActionState(
    async (previous: ModerationActionState, form: FormData) => {
      const next = await decideReportAction(previous, form);
      if (!next.error) {
        setReported(next);
        // The action revalidates the path; this is what makes the open page
        // re-read it without a full navigation.
        router.refresh();
      }
      return next;
    },
    INITIAL,
  );

  return (
    <>
      <form action={submit} className="grid gap-3">
        <input type="hidden" name="reportId" value={reportId} />

        <Input
          id={`note-${reportId}`}
          name="note"
          label="Why"
          hint={hint ?? "Kept with the decision and on the audit trail."}
          {...(state.error ? { error: state.error } : {})}
        />

        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => {
            const button = LABELS[choice];
            if (!button) return null;

            return (
              <Button
                key={choice}
                type="submit"
                name="decision"
                value={choice}
                intent={button.intent}
                size="sm"
                disabled={pending}
              >
                {pending ? "Working…" : button.label}
              </Button>
            );
          })}
        </div>
      </form>

      {reported?.message ? (
        <ToastRegion>
          <Toast tone="success" onDismiss={() => setReported(null)}>
            {reported.message}
          </Toast>
        </ToastRegion>
      ) : null}
    </>
  );
}
