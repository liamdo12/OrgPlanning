"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button, GlassPanel, Toast, ToastRegion } from "@occasion/ui";
import { clearClockAction, setClockAction, type OpsActionState } from "../actions";

/**
 * The clock override card.
 *
 * Line 1837: the current label large, then one button per state with `●` for
 * the selected one and `○` for the rest. The prototype's four are strings; ours
 * are computed from the seed's anchor, so they stay true after a reseed.
 *
 * The line the prototype does not have is the one that matters most: **this is
 * a preview**. Moving the clock changes what the queue below says is due and
 * nothing else — the platform's own timer never reads it, and the button beside
 * it can only touch demo rows. Somebody who believes they have moved the whole
 * platform forward will press that button expecting a rehearsal and think they
 * got one.
 */

const INITIAL: OpsActionState = {};

export type ClockChoice = { key: string; label: string; at: string; selected: boolean };

export function ClockCard({
  current,
  choices,
  allowed,
  expiresAt,
}: {
  /** What the queue is being read at, already formatted. */
  current: string;
  choices: readonly ClockChoice[];
  allowed: boolean;
  /** When the override lapses, formatted; absent when the clock is real. */
  expiresAt: string | null;
}) {
  const router = useRouter();

  const [state, submit, pending] = useActionState(
    async (previous: OpsActionState, form: FormData) => {
      const next = form.get("at")
        ? await setClockAction(previous, form)
        : await clearClockAction(previous, form);
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );

  return (
    <GlassPanel as="section" className="p-5">
      <h2 className="m-0 mb-1 text-[17px]">Clock override</h2>
      <p className="m-0 mb-4 text-[24px] font-bold">{current}</p>

      {allowed ? (
        <>
          <p className="m-0 mb-4 max-w-[54ch] text-row text-pretty text-body">
            A preview. It changes what the queue below lists as due; the platform&rsquo;s own timer
            never reads it, and running jobs from here touches demo data only.
            {expiresAt ? ` It lapses at ${expiresAt}.` : ""}
          </p>

          <div className="grid gap-2">
            {choices.map((choice) => (
              <form key={choice.key} action={submit}>
                <input type="hidden" name="at" value={choice.at} />
                <button
                  type="submit"
                  disabled={pending}
                  aria-pressed={choice.selected}
                  className="oc-clock-jump"
                >
                  {/* The prototype's own markers, line 2733. A symbol alone
                      would say nothing to a screen reader, so the pressed
                      state carries the meaning and this carries the look. */}
                  <span aria-hidden="true">{choice.selected ? "● " : "○ "}</span>
                  {choice.label}
                </button>
              </form>
            ))}

            {choices.some((choice) => choice.selected) ? (
              <form action={submit}>
                <Button type="submit" intent="ghost" size="sm" disabled={pending}>
                  Back to the real clock
                </Button>
              </form>
            ) : null}
          </div>
        </>
      ) : (
        <p className="m-0 max-w-[54ch] text-row text-pretty text-body">
          Not available on this deployment. Moving the clock drives real charges, so it is limited
          to local and demo tiers.
        </p>
      )}

      {state.error || state.message ? (
        <ToastRegion>
          <Toast tone={state.error ? "danger" : "success"}>{state.error ?? state.message}</Toast>
        </ToastRegion>
      ) : null}
    </GlassPanel>
  );
}
