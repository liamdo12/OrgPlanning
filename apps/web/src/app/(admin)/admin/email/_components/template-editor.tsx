"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Checkbox,
  Dialog,
  GlassPanel,
  Input,
  Select,
  Textarea,
  Toast,
  ToastRegion,
} from "@occasion/ui";
import type { Audience, LiveTemplate, Recipient, RenderedEmail } from "@occasion/core";
import {
  saveTemplateAction,
  sendBroadcastAction,
  sendTestAction,
  setAutoSendAction,
  type EmailActionState,
} from "../actions";

/**
 * The editor (lines 1727–1775): recipients, subject, body, merge-field chips,
 * a preview with the fields filled in, and the three buttons the prototype
 * draws — Send, Send test to me, Save template — with the auto-send checkbox
 * under them.
 *
 * Two things the prototype does not have, both of which are the point of
 * building it for real:
 *
 * **The recipient count is real.** It comes from the audience joined to
 * consent, and it travels with the send so the domain can refuse a send whose
 * audience has moved since the dialog was drawn. The prototype's "1,204
 * accounts" is a string.
 *
 * **Sending asks first, and asks twice above fifty.** The dialog names the
 * template, the audience and the exact number. Above the threshold a second
 * checkbox has to be ticked, because the difference between a test and a
 * thousand real messages is one button press and no undo.
 */

const INITIAL: EmailActionState = {};

export type ScopeChoice = { kind: string; label: string; count: number };

export function TemplateEditor({
  selected,
  template,
  preview,
  fields,
  senderFields,
  notSendable,
  scopes,
  audience,
  secondConfirmationAbove,
}: {
  /** Accounts the screen arrived with, from a Users-screen Email button. */
  selected: readonly Recipient[];
  template: LiveTemplate;
  preview: RenderedEmail;
  fields: readonly { token: string; name: string; label: string; restricted: boolean }[];
  senderFields: readonly { name: string; token: string; label: string }[];
  /** Why this template cannot go to an audience, when it cannot. */
  notSendable: string | null;
  scopes: readonly ScopeChoice[];
  audience: Audience;
  secondConfirmationAbove: number;
}) {
  const router = useRouter();
  // Arriving from a Users-screen Email button means somebody has already chosen
  // who this is for, so the scope starts there rather than on the whole
  // audience — which is the difference between a button that preselects a
  // recipient and one that merely navigates.
  const [scope, setScope] = useState<string>(
    selected.length > 0 ? "accounts" : (scopes[0]?.kind ?? "everyone"),
  );
  const [confirming, setConfirming] = useState(false);
  // The fields the platform cannot fill in. Held here rather than in the dialog
  // so that what the administrator typed survives the dialog being closed and
  // reopened — and so the Send button can refuse before opening it at all.
  const [values, setValues] = useState<Record<string, string>>({});

  const [state, submit, pending] = useActionState(
    async (previous: EmailActionState, form: FormData) => {
      const intent = form.get("intent");
      const next =
        intent === "send"
          ? await sendBroadcastAction(previous, form)
          : intent === "test"
            ? await sendTestAction(previous, form)
            : intent === "auto"
              ? await setAutoSendAction(previous, form)
              : await saveTemplateAction(previous, form);

      if (!next.error) {
        setConfirming(false);
        router.refresh();
      }
      return next;
    },
    INITIAL,
  );

  const activeScope = scopes.find((one) => one.kind === scope) ?? scopes[0];
  const count = activeScope?.count ?? 0;
  const needsSecond = count > secondConfirmationAbove;
  const unfilled = senderFields.filter((field) => !values[field.name]?.trim());

  // The domain's own answer, not a second copy of the rule. A button the screen
  // draws and the domain then refuses is worse than no button.
  const sendable = notSendable === null;

  return (
    <GlassPanel as="section" className="p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-[17px]">{template.name}</h2>
        <span className="text-[12.5px] text-muted">{template.trigger}</span>
      </div>

      <form action={submit} className="grid gap-3">
        <input type="hidden" name="key" value={template.key} />
        <input type="hidden" name="name" value={template.name} />
        <input type="hidden" name="trigger" value={template.trigger} />
        {/* The template's own auto-send, not the screen's. Saving the words
            must not decide whether the platform still sends the message, and
            the class and audience are not here at all — they ship as reviewed
            code and the domain reads them from the module. */}
        {template.autoSend ? <input type="hidden" name="autoSend" value="on" /> : null}
        {template.allowedFields.map((field) => (
          <input key={field} type="hidden" name="field" value={field} />
        ))}

        {selected.length > 0 ? (
          <p className="m-0 text-pretty text-[13px] text-muted">
            Selected from the account list: {selected.map((one) => one.email).join(", ")}.
          </p>
        ) : null}

        <Select
          id="email-scope"
          label="Recipients"
          name="scope"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
          disabled={!sendable}
          options={scopes.map((choice) => ({ value: choice.kind, label: choice.label }))}
        />

        <Input id="email-subject" label="Subject" name="subject" defaultValue={template.subject} />

        <Textarea
          id="email-body"
          label="Body"
          name="body"
          rows={9}
          defaultValue={template.body}
          hint="Merge fields are written {{like_this}} and must be among the fields listed below."
        />

        <div>
          <p className="m-0 mb-2 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
            Fields this template may use
          </p>
          <div className="flex flex-wrap gap-[7px]">
            {fields.map((field) => (
              <span
                key={field.name}
                className="oc-merge-chip"
                data-restricted={field.restricted ? "true" : "false"}
                title={
                  field.restricted
                    ? `${field.label} — different for every recipient, so a broadcast may not carry it`
                    : field.label
                }
              >
                {field.token}
              </span>
            ))}
          </div>
        </div>

        {sendable && senderFields.length > 0 ? (
          <div className="grid gap-3 rounded-[18px] border border-glass-edge bg-glass-wash p-4">
            <p className="m-0 text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted">
              Fill in before sending
            </p>
            <p className="m-0 max-w-[54ch] text-pretty text-[13px] text-muted">
              These are the same for everybody who receives this message, and the platform has no
              way to know them. The preview below shows sample values; these are what is actually
              sent.
            </p>
            {senderFields.map((field) => (
              <Input
                key={field.name}
                id={`email-value-${field.name}`}
                label={field.token}
                value={values[field.name] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
              />
            ))}
          </div>
        ) : null}

        <div className="rounded-[18px] border border-glass-edge bg-glass-wash p-4">
          <p className="m-0 mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted">
            Preview · sample values
          </p>
          <p className="m-0 mb-2 text-[14.5px] font-bold">{preview.subject}</p>
          <p className="m-0 whitespace-pre-line text-pretty text-[14px] text-row">{preview.text}</p>
        </div>

        <div className="flex flex-wrap gap-[9px]">
          {sendable ? (
            <Button
              type="button"
              intent="primary"
              className="flex-[1_1_160px]"
              disabled={pending || count === 0 || unfilled.length > 0}
              onClick={() => setConfirming(true)}
              title={
                unfilled.length > 0
                  ? `Fill in ${unfilled.map((field) => field.token).join(", ")} first.`
                  : undefined
              }
            >
              {count === 0
                ? "Nobody to send to"
                : unfilled.length > 0
                  ? `Fill in ${unfilled.map((field) => field.token).join(", ")}`
                  : `Send to ${count.toLocaleString("en-CA")}`}
            </Button>
          ) : null}

          <Button type="submit" name="intent" value="test" intent="ghost" disabled={pending}>
            Send test to me
          </Button>

          <Button type="submit" name="intent" value="save" intent="secondary" disabled={pending}>
            Save template
          </Button>
        </div>

        {sendable ? null : (
          <p className="m-0 max-w-[54ch] text-pretty text-[13px] text-muted">
            {notSendable} You can still edit the words and send a test to yourself.
          </p>
        )}
      </form>

      <form action={submit} className="mt-3">
        <input type="hidden" name="key" value={template.key} />
        <input type="hidden" name="intent" value="auto" />
        <Checkbox
          id="email-auto-send"
          name="autoSend"
          defaultChecked={template.autoSend}
          disabled={pending}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          label={
            template.autoSend
              ? `Send this automatically — ${template.trigger.toLowerCase()}`
              : "Also send this automatically in future"
          }
        />
      </form>

      {confirming && activeScope ? (
        <Dialog
          open
          title={`Send “${template.name}”?`}
          onClose={() => setConfirming(false)}
          // Rendered as its own form rather than a submit inside the one above:
          // the count and the second confirmation belong to this decision, and
          // a hidden field that survives the dialog closing is how a send goes
          // out with a number nobody looked at.
        >
          <form action={submit} className="grid gap-3">
            <input type="hidden" name="intent" value="send" />
            <input type="hidden" name="key" value={template.key} />
            <input type="hidden" name="audience" value={audience} />
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="expectedCount" value={count} />
            {scope === "accounts"
              ? selected.map((recipient) => (
                  <input
                    key={recipient.userId}
                    type="hidden"
                    name="userId"
                    value={recipient.userId}
                  />
                ))
              : null}
            {senderFields.map((field) => (
              <input
                key={field.name}
                type="hidden"
                name={`value_${field.name}`}
                value={values[field.name] ?? ""}
              />
            ))}

            <p className="m-0 text-pretty text-body">
              {activeScope.label}. “{template.name}” goes out with the merge fields filled in per
              recipient.
              {template.class === "broadcast"
                ? " Only accounts that have given express consent are included."
                : ""}
            </p>

            {needsSecond ? (
              <Checkbox
                id="email-confirm-large"
                name="confirmedLarge"
                required
                label={`Yes — send to all ${count.toLocaleString("en-CA")} accounts. This cannot be undone.`}
              />
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" intent="primary" disabled={pending}>
                Send now
              </Button>
              <Button type="button" intent="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {state.error || state.message ? (
        <ToastRegion>
          <Toast tone={state.error ? "danger" : "success"}>{state.error ?? state.message}</Toast>
        </ToastRegion>
      ) : null}
    </GlassPanel>
  );
}
