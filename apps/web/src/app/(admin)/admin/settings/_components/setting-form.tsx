"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Toast, ToastRegion } from "@occasion/ui";
import type { AdminSetting } from "@occasion/core";
import { updateSettingAction, type SettingsActionState } from "../actions";

/**
 * One setting, edited in place.
 *
 * The unit is spelled out beside the field rather than converted for display:
 * a commission is stored in basis points, and a form that showed "10" and saved
 * "1000" would be a form whose arithmetic somebody has to trust. The bounds are
 * on the input as well as in the domain, so the browser refuses what the
 * service would and the person finds out before they submit.
 */

const INITIAL: SettingsActionState = {};

export function SettingForm({ setting }: { setting: AdminSetting }) {
  const router = useRouter();
  const [reported, setReported] = useState<SettingsActionState | null>(null);

  const [state, submit, pending] = useActionState(
    async (previous: SettingsActionState, form: FormData) => {
      const next = await updateSettingAction(previous, form);
      setReported(next);
      if (!next.error) router.refresh();
      return next;
    },
    INITIAL,
  );

  return (
    <>
      <form action={submit} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="key" value={setting.key} />

        <Input
          id={`setting-${setting.key}`}
          name="value"
          type="number"
          step={1}
          {...(setting.min === undefined ? {} : { min: setting.min })}
          {...(setting.max === undefined ? {} : { max: setting.max })}
          label={unitFor(setting)}
          defaultValue={typeof setting.value === "number" ? String(setting.value) : ""}
          className="w-44"
          {...(state.error ? { error: state.error } : {})}
        />

        <Button type="submit" intent="secondary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
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

/** What the number in the box actually is. */
function unitFor(setting: AdminSetting): string {
  switch (setting.kind) {
    case "bps":
      return "Basis points (100 = 1%)";
    case "hours":
      return "Hours";
    case "days":
      return "Days";
    default:
      return "Value";
  }
}
