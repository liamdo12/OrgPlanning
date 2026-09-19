import { randomUUID } from "node:crypto";
import type { CoreContext, DbExecutor } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Actor } from "../identity/actor.js";
import { requireAdmin } from "../identity/service.js";
import { record } from "../audit/service.js";
import { hashToken, mintToken } from "../tokens.js";
import * as jobs from "../jobs/repo.js";
import {
  audienceLabel,
  describeScope,
  parseAudience,
  resolveRecipients,
  type Audience,
  type Recipient,
  type Scope,
} from "./audience.js";
import { isRestricted, parseFieldName, sampleValues } from "./fields.js";
import {
  assertBodyFields,
  assertNoRestrictedFields,
  render,
  templateHash,
  type RenderedEmail,
} from "./render.js";
import * as repo from "./repo.js";
import type { EmailTemplate, TemplateClass } from "./template.js";
import { builtInTemplate, builtInTemplates, type TemplateKey } from "./templates/index.js";

/**
 * Sending, and everything that has to be true before anything is sent.
 *
 * The ordering here is the design. Consent, the allowlist and the recipient
 * count are all resolved **before** a single row is written, and the write that
 * follows is what the administrator was shown. Checking any of them later —
 * per recipient inside the job, say — means a send that is half refused, which
 * is indistinguishable from a bug and impossible to explain to the people who
 * did receive it.
 */

/** Above this, the screen asks a second time. Source: the phase's own rule. */
export const SECOND_CONFIRMATION_ABOVE = 50;

/** How many sends the log shows. The prototype lists four (line 2721). */
const RECENT_LIMIT = 25;

/**
 * A template as it stands: what the platform ships, under whatever has been
 * saved over it.
 *
 * `key`, and only `key`, is not editable. Everything else an administrator may
 * change, and the row is a revision of the module rather than a separate thing.
 */
export type LiveTemplate = EmailTemplate & {
  /** Whether an administrator has saved over the shipped version. */
  edited: boolean;
  /** The `email_templates` row, where one exists, so a send can cite it. */
  overrideId: string | null;
};

function merge(base: EmailTemplate, override: repo.TemplateOverride | undefined): LiveTemplate {
  if (!override) return { ...base, edited: false, overrideId: null };

  return {
    key: base.key,
    overrideId: override.id,
    name: override.name,
    audience: override.audience,
    class: override.class,
    trigger: override.trigger ?? base.trigger,
    autoSend: override.automatic !== null,
    subject: override.subject,
    body: override.body,
    allowedFields: override.allowedFields,
    edited: true,
  };
}

export async function listTemplates(ctx: CoreContext, actor: Actor): Promise<LiveTemplate[]> {
  requireAdmin(actor);

  const overrides = new Map(
    (await repo.listOverrides(ctx.db)).map((override) => [override.key, override]),
  );
  return builtInTemplates().map((base) => merge(base, overrides.get(base.key)));
}

/**
 * One template, resolved the same way the list resolves it.
 *
 * Takes no actor: the job runner reaches this with the platform's own principal
 * to render a confirmation email, and that is not an administrator. Nothing it
 * returns is private — a template is the platform's own words — so the guard
 * belongs on the callers that expose the library to a person, not here.
 *
 * `db` defaults to the pool and is passed explicitly by every caller already
 * inside a transaction. Reading through the pool from inside one is not merely
 * untidy: the transaction is holding a connection, this read wants a second,
 * and a pool that has run out of them waits for a connection that only the
 * transaction can release — a deadlock that scales with concurrency and looks
 * like a hang rather than an error.
 */
export async function liveTemplate(
  ctx: CoreContext,
  key: string,
  db: DbExecutor = ctx.db,
): Promise<LiveTemplate> {
  const base = builtInTemplate(key);
  if (!base) throw new NotFoundError("No such template.");

  return merge(base, await repo.findOverride(db, key));
}

export type SaveTemplateInput = {
  key: string;
  name: string;
  trigger: string | null;
  autoSend: boolean;
  subject: string;
  body: string;
  allowedFields: readonly unknown[];
};

/**
 * What an edit may not change: the template's class and its audience.
 *
 * Both are read from the shipped module, never from the caller. The class
 * decides whether a send needs express consent and whether the body may carry a
 * per-recipient secret, so a class arriving in a form is that decision made by
 * whoever posted the form — and the shape of the hole is exact: post
 * `class=vendors` for the marketing template and the consent join stops
 * running, because `audience.ts` asks the class and nothing else. The audience
 * is held here for the simpler reason that it is not a thing the screen has an
 * input for; it once posted the audience *tab*, which both refused every save
 * made from the "Both" tab and silently rewrote the template's own audience
 * from whichever tab happened to be open.
 *
 * `template.ts` already says these ship as reviewed code. This is that sentence
 * enforced rather than trusted.
 */

/**
 * Saves an edit, having refused every edit that could not safely be sent.
 *
 * Author time is the only moment these checks are worth making. A body is
 * stored once and rendered by something else, possibly months later, against a
 * recipient nobody is looking at — so "this template references a field it is
 * not allowed to use" has to stop the save, not the send.
 */
export async function saveTemplate(
  ctx: CoreContext,
  actor: Actor,
  input: SaveTemplateInput,
): Promise<LiveTemplate> {
  requireAdmin(actor);

  const base = builtInTemplate(input.key);
  if (!base) throw new NotFoundError("No such template.");

  const name = input.name.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();

  if (name.length === 0)
    throw new ValidationError("A template needs a name.", { name: "required" });
  if (subject.length === 0) {
    throw new ValidationError("A template needs a subject.", { subject: "required" });
  }
  if (body.length === 0)
    throw new ValidationError("A template needs a body.", { body: "required" });

  const templateClass = base.class;
  const audience = base.audience;
  const allowedFields = [...new Set(input.allowedFields.map(parseFieldName))];

  const where = `The "${name}" template`;
  assertBodyFields(subject, allowedFields, where);
  assertBodyFields(body, allowedFields, where);

  if (templateClass === "broadcast") {
    // The red team's rule, enforced where it can still be acted on. A broadcast
    // body is written once and sent to everybody, so a per-recipient secret in
    // it is either a leak or a render failure — and by send time the words are
    // already stored and something else will send them.
    assertNoRestrictedFields(subject, body, allowedFields, where);
  }

  if (base.class === "automatic") {
    // An automatic template's allowlist may be narrowed and never widened.
    //
    // The shipped list is a contract in the other direction: it is what the
    // lifecycle undertakes to supply, every time, for every order. A field
    // added here has no such undertaking behind it, so the first send that
    // reaches it finds nothing to substitute and refuses — and these messages
    // are queued inside the transaction that moved the order, so the refusal
    // rolls back the confirmation of a booking somebody has just paid for.
    //
    // Narrowing is safe and useful: an administrator who does not want the
    // order reference in the message removes the sentence and the field.
    const supplied = new Set(base.allowedFields);
    const unsupplied = allowedFields.filter((name) => !supplied.has(name));

    if (unsupplied.length > 0) {
      throw new ValidationError(
        `${where} is sent by the platform, so it can only use the fields the platform fills in. ` +
          `${unsupplied.map((name) => `{{${name}}}`).join(", ")} ` +
          `${unsupplied.length === 1 ? "is not one of them" : "are not among them"}.`,
        { allowedFields: "unsupplied" },
      );
    }
  }

  const now = ctx.clock.realNow();

  const saved = await ctx.db.transaction(async (tx) => {
    const written = await repo.upsertOverride(
      tx,
      {
        key: base.key,
        name,
        audience,
        class: templateClass,
        trigger: input.trigger?.trim() || base.trigger,
        automatic: input.autoSend ? now : null,
        subject,
        body,
        allowedFields,
      },
      now,
    );

    await record(
      ctx,
      actor,
      {
        action: "email.template_save",
        entityType: "email_template",
        entityId: written.id,
        after: {
          key: base.key,
          class: templateClass,
          audience,
          autoSend: input.autoSend,
          allowedFields,
          // What was saved, as one value. The row is editable; this is not.
          hash: templateHash(subject, body),
        },
      },
      tx,
    );

    return written;
  });

  return merge(base, saved);
}

/**
 * The per-template auto-send toggle (the prototype's checkbox, line 1773).
 *
 * Turning it off stops the lifecycle queuing that message; it does not stop an
 * administrator sending it by hand. Implemented as a save of the current body
 * so there is one write path and one audit action for "this template changed".
 */
export async function setAutoSend(
  ctx: CoreContext,
  actor: Actor,
  key: string,
  autoSend: boolean,
): Promise<LiveTemplate> {
  requireAdmin(actor);

  const current = await liveTemplate(ctx, key);

  return saveTemplate(ctx, actor, {
    key: current.key,
    name: current.name,
    trigger: current.trigger,
    autoSend,
    subject: current.subject,
    body: current.body,
    allowedFields: current.allowedFields,
  });
}

/**
 * The fields the platform fills from the recipient's own account row.
 *
 * Everything else in a broadcast's allowlist is something only the person
 * sending it knows — the date a policy takes effect, the URL it is published
 * at. The prototype has no input for those and fills them from a sample map,
 * which is why its "send" button does nothing: a real send of that body would
 * either interpolate the sample or refuse.
 */
const FROM_THE_ACCOUNT = ["brand_name", "first_name", "customer_first_name", "customer_name"];

/**
 * What the sender has to supply before this template can go to an audience.
 *
 * Returned to the screen so it can ask, and checked again on the way in: a
 * missing value refuses the render, and refusing after the recipient rows are
 * written is a broadcast that is half sent.
 */
export function senderSuppliedFields(template: EmailTemplate): string[] {
  // Restricted fields are deliberately absent, and cannot be added by asking.
  // They are different for every recipient by definition, so a single value
  // typed once is either the wrong answer for everybody or one person's secret
  // sent to all of them. `assertSendableToAudience` refuses the template
  // outright rather than offering a box to type it into.
  return template.allowedFields.filter(
    (name) => !FROM_THE_ACCOUNT.includes(name) && !isRestricted(name),
  );
}

/**
 * Whether this template may be sent to an audience at all.
 *
 * Two refusals, and the second is the one that matters.
 *
 * **A lifecycle template may not be**, whatever its auto-send toggle says. The
 * toggle decides whether the platform queues the message when an order moves;
 * it is not a switch that turns a confirmation email into a newsletter. Reading
 * it as one was a real hole: turning auto-send off on "Failed payment" would
 * have made a template whose allowlist permits `{{payment_link}}` sendable to
 * an audience.
 *
 * **A template carrying a restricted field may not be**, whatever its class.
 * That is the general form of the same hole — `payout_notice` is class
 * `vendors`, is sent by hand, and permits `{{bank_last4}}`. Restricted fields
 * are per-recipient, and a send to an audience has one body: filling one in
 * would put a single account's last four digits in front of every vendor on the
 * platform.
 */
function assertSendableToAudience(template: LiveTemplate): void {
  if (template.class === "automatic") {
    throw new ValidationError(
      `"${template.name}" is sent by the platform when something happens to an order. It cannot be sent to an audience.`,
      { template: "automatic" },
    );
  }

  const restricted = template.allowedFields.filter(isRestricted);
  if (restricted.length > 0) {
    throw new ValidationError(
      `"${template.name}" uses ${restricted
        .map((name) => `{{${name}}}`)
        .join(", ")}, which is different for every recipient. It cannot be sent to an audience.`,
      { template: "restricted_field" },
    );
  }
}

/** The fill behind the preview, and behind "Send test to me". */
export function previewValues(ctx: CoreContext): Record<string, string> {
  return { ...sampleValues(), brand_name: ctx.config.brandName };
}

export type Preview = RenderedEmail & { templateKey: string };

/** What the editor shows under the body, with every field filled in. */
export async function previewTemplate(
  ctx: CoreContext,
  actor: Actor,
  key: string,
): Promise<Preview> {
  requireAdmin(actor);

  const template = await liveTemplate(ctx, key);
  const rendered = render(
    {
      subject: template.subject,
      body: template.body,
      allowedFields: template.allowedFields,
      values: previewValues(ctx),
    },
    `The "${template.name}" template`,
  );

  return { ...rendered, templateKey: template.key };
}

/**
 * Sends the template to the administrator asking, filled with sample values.
 *
 * Deliberately not queued: the whole point is an answer now, while the editor
 * is still open. It is also the only send on this screen that reaches exactly
 * one known address, so there is nothing to confirm and nothing to refuse.
 */
export async function sendTest(
  ctx: CoreContext,
  actor: Actor,
  key: string,
): Promise<{ to: string; subject: string }> {
  const admin = requireAdmin(actor);

  const template = await liveTemplate(ctx, key);
  const rendered = render(
    {
      subject: `[test] ${template.subject}`,
      body: template.body,
      allowedFields: template.allowedFields,
      values: previewValues(ctx),
    },
    `The "${template.name}" template`,
  );

  await ctx.email.send({
    to: admin.email,
    subject: rendered.subject,
    html: rendered.html,
    // The template and the person, so pressing the button twice while editing
    // is two messages rather than one silently swallowed by the provider.
    idempotencyKey: `test:${template.key}:${admin.userId}:${ctx.clock.realNow().getTime()}`,
  });

  return { to: admin.email, subject: rendered.subject };
}

export type BroadcastInput = {
  templateKey: string;
  audience: Audience;
  scope: Scope;
  /**
   * The number the administrator was shown and approved.
   *
   * Compared against the number resolved now, and a mismatch refuses the send.
   * The audience is live data: an account verifies its address, a vendor is
   * suspended, somebody withdraws consent. Without this the dialog's count is
   * decoration — it describes a send that may already be a different send by
   * the time the button is pressed.
   */
  expectedCount: number;
  /** Whether the second confirmation above the threshold was given. */
  confirmedLarge: boolean;
  /**
   * Values for the fields the platform cannot fill in.
   *
   * `senderSuppliedFields` lists them. They are the same for every recipient —
   * that is what makes them safe in a broadcast — but they are not something
   * this platform knows, so they are asked for rather than guessed at.
   */
  values?: Record<string, string>;
};

export type BroadcastResult = {
  broadcastId: string;
  templateKey: string;
  subject: string;
  recipients: number;
  description: string;
};

/**
 * Queues one message per recipient, after resolving who they actually are.
 *
 * Per recipient rather than per audience, because a provider failure is per
 * recipient: one bad address must not stop the other eleven hundred, and a
 * retry must resend to that address only. The `email_sends` row is written
 * first and its id is the job's dedupe key, so the queue can only ever hold one
 * job per message however many times this is called.
 */
export async function sendBroadcast(
  ctx: CoreContext,
  actor: Actor,
  input: BroadcastInput,
): Promise<BroadcastResult> {
  requireAdmin(actor);

  const template = await liveTemplate(ctx, input.templateKey);
  const audience = parseAudience(input.audience);

  assertSendableToAudience(template);

  const supplied = input.values ?? {};
  const missing = senderSuppliedFields(template).filter((name) => !supplied[name]?.trim());

  if (missing.length > 0) {
    // Refused before a single row is written. A render failure discovered part
    // way through the recipients is a send that half happened, which cannot be
    // taken back and cannot be finished either.
    throw new ValidationError(
      `Fill in ${missing.map((name) => `{{${name}}}`).join(", ")} before sending.`,
      { values: "missing" },
    );
  }

  const recipients = await resolveRecipients(ctx, { audience, scope: input.scope, template });

  if (recipients.length === 0) {
    throw new ValidationError(
      template.class === "broadcast"
        ? "Nobody in that audience has given express consent to marketing email, so there is nobody to send to."
        : "That audience is empty.",
      { audience: "empty" },
    );
  }

  if (recipients.length !== input.expectedCount) {
    throw new ValidationError(
      `That audience is now ${recipients.length} accounts, not ${input.expectedCount}. Check the number and send again.`,
      { audience: "changed" },
    );
  }

  if (recipients.length > SECOND_CONFIRMATION_ABOVE && !input.confirmedLarge) {
    throw new ValidationError(
      `${recipients.length} accounts is above ${SECOND_CONFIRMATION_ABOVE}. Confirm again to send.`,
      { audience: "unconfirmed" },
    );
  }

  const now = ctx.clock.realNow();
  const hash = templateHash(template.subject, template.body);
  const description = describeScope(audience, input.scope, recipients.length);

  // One id for the whole decision, minted before anything is written so every
  // row and the audit entry carry the same one.
  const broadcastId = randomUUID();
  let subject = template.subject;

  await ctx.db.transaction(async (tx) => {
    for (const recipient of recipients) {
      const rendered = renderFor(ctx, template, recipient, supplied);
      subject = rendered.subject;

      await queue(ctx, tx, {
        template,
        recipient,
        rendered,
        broadcastId,
        // The broadcast, the template version and the person. Including the
        // hash is what lets the same template be sent twice after an edit while
        // an unedited resend of the same broadcast stays one message.
        idempotencyKey: `broadcast:${broadcastId}:${hash}:${recipient.userId}`,
        // Only marketing carries one. Nothing about a confirmation email is
        // something a customer can opt out of while keeping the order.
        withUnsubscribe: template.class === "broadcast",
        // A broadcast is real work to real accounts. It is never claimable by
        // the admin "run due jobs" button under a shifted clock.
        isDemo: false,
        now,
      });
    }

    await record(
      ctx,
      actor,
      {
        action: "email.broadcast",
        entityType: "email_broadcast",
        entityId: broadcastId,
        after: {
          templateKey: template.key,
          class: template.class,
          audience,
          scope: input.scope.kind,
          recipients: recipients.length,
          description,
          // The words that went out, identified independently of the row that
          // holds them — the template can be edited an hour later.
          hash,
        },
      },
      tx,
    );
  });

  return {
    broadcastId,
    templateKey: template.key,
    subject,
    recipients: recipients.length,
    description,
  };
}

/**
 * Queues one lifecycle message.
 *
 * Called from inside the transaction that made the thing happen — an order
 * confirmed, a vendor approved — so the message and the fact it describes
 * commit together. A send queued outside that transaction is a confirmation
 * email for an order that rolled back.
 *
 * Takes no actor and asks for no authority. The caller has already decided the
 * move is allowed; this only writes down what to say about it.
 */
export async function queueTransactional(
  ctx: CoreContext,
  tx: DbExecutor,
  input: {
    templateKey: TemplateKey;
    userId: string;
    /** The values only the caller knows: an amount, a deadline, a token. */
    values: Record<string, string>;
    /**
     * What makes this send distinct from the next one on the same template.
     *
     * An order id, usually. It becomes part of the idempotency key, which is
     * what stops a webhook replayed an hour later sending a second confirmation
     * for the same booking.
     */
    about: string;
    /**
     * Whether the thing this message is about is demo data.
     *
     * It decides which runner may deliver it. A message about a demo order has
     * to be claimable by the admin "run due jobs" button under a clock
     * override, exactly as the order's other queued work is; a message about a
     * real order must never be.
     */
    isDemo: boolean;
    now: Date;
  },
): Promise<boolean> {
  const template = await liveTemplate(ctx, input.templateKey, tx);

  // The administrator's switch. A template whose auto-send is off is still in
  // the library and can still be sent by hand; the lifecycle simply stops
  // queuing it.
  if (!template.autoSend) return false;

  const recipient = await repo.findRecipient(tx, input.userId);
  if (!recipient) return false;

  const rendered = renderFor(ctx, template, recipient, input.values);

  return queue(ctx, tx, {
    template,
    recipient,
    rendered,
    broadcastId: null,
    idempotencyKey: `${template.key}:${input.about}`,
    withUnsubscribe: false,
    isDemo: input.isDemo,
    now: input.now,
    // The rendered body, which a transactional message may not keep: it can
    // contain a payment link. See `queue`.
    secretValues: input.values,
  });
}

/**
 * The write, for both paths.
 *
 * Two rows, in this order and no other: the `email_sends` row first, then the
 * job that will deliver it. The row is the record that a message was decided
 * on, and the job is only the attempt — so a crash between them leaves a queued
 * send that never went out, which is visible on the screen, rather than a job
 * pointing at nothing.
 *
 * **The rendered body is deliberately not stored.** `email_sends.merge_values`
 * keeps only the open fields, and the job payload carries the rest. A
 * balance-failed message contains a single-use payment link; writing the
 * rendered HTML into a row that the admin screen reads would put a bearer
 * credential on a page, and leave it there after the link had been used.
 */
async function queue(
  ctx: CoreContext,
  tx: DbExecutor,
  input: {
    template: LiveTemplate;
    recipient: Recipient;
    rendered: RenderedEmail;
    broadcastId: string | null;
    idempotencyKey: string;
    withUnsubscribe: boolean;
    isDemo: boolean;
    now: Date;
    secretValues?: Record<string, string>;
  },
): Promise<boolean> {
  const unsubscribe = input.withUnsubscribe ? mintToken(16) : null;

  const send = await repo.createSend(tx, {
    templateId: input.template.overrideId,
    broadcastId: input.broadcastId,
    recipientUserId: input.recipient.userId,
    toEmail: input.recipient.email,
    subject: input.rendered.subject,
    idempotencyKey: input.idempotencyKey,
    mergeValues: openValuesOf(input.template, input.secretValues ?? {}),
    // Hashed, like every other secret that travels in a URL: the plaintext goes
    // in the message and nowhere else.
    unsubscribeToken: unsubscribe ? hashToken(unsubscribe) : null,
    now: input.now,
  });

  // Already queued. The caller ran twice — a replayed webhook, a retried job —
  // and one message is the correct answer.
  if (!send) return false;

  await jobs.enqueue(tx, {
    type: "send_email",
    dedupeKey: send.id,
    runAfter: input.now,
    payload: {
      sendId: send.id,
      to: input.recipient.email,
      subject: input.rendered.subject,
      html: unsubscribe
        ? withUnsubscribeFooter(ctx, input.rendered.html, unsubscribe)
        : input.rendered.html,
    },
    isDemo: input.isDemo,
  });

  return true;
}

/** The open fields, which are safe to keep beside the send for the screen to show. */
function openValuesOf(
  template: LiveTemplate,
  values: Record<string, string>,
): Record<string, string> {
  const open: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (template.allowedFields.includes(name) && !isRestricted(name)) open[name] = value;
  }
  return open;
}

/**
 * One message for one person.
 *
 * The caller's values win over the defaults, and the defaults exist so that a
 * lifecycle caller does not have to remember the brand name or the recipient's
 * own first name — the two fields almost every template uses and neither of
 * which the caller knows anything special about.
 */
function renderFor(
  ctx: CoreContext,
  template: LiveTemplate,
  recipient: Recipient,
  values: Record<string, string>,
): RenderedEmail {
  const first = recipient.fullName.trim().split(/\s+/)[0] ?? recipient.fullName;

  return render(
    {
      subject: template.subject,
      body: template.body,
      allowedFields: template.allowedFields,
      values: {
        brand_name: ctx.config.brandName,
        first_name: first,
        customer_first_name: first,
        customer_name: recipient.fullName,
        ...values,
      },
    },
    `The "${template.name}" template`,
  );
}

/** Commercial email has to carry a working way out of it. */
function withUnsubscribeFooter(ctx: CoreContext, html: string, token: string): string {
  const url = new URL(`/unsubscribe/${token}`, ctx.config.appUrl).toString();
  return [
    html,
    `<p style="font-size: 12px; color: #5C6B62;">You are receiving this because you agreed to hear from ${ctx.config.brandName}. <a href="${url}">Unsubscribe</a>.</p>`,
  ].join("\n");
}

/**
 * Delivers one queued message, from the `send_email` job.
 *
 * The provider call is the only thing here that can fail in a way worth
 * retrying, and it is the last thing done. Everything before it is reading what
 * was already decided.
 */
export async function deliverSend(
  ctx: CoreContext,
  input: { sendId: string; to: string; subject: string; html: string },
): Promise<{ sent: boolean; detail: string }> {
  const send = await repo.findSend(ctx.db, input.sendId);
  if (!send) throw new NotFoundError("No such email.");

  // Already gone. A retry after a timeout, or the provider answering twice.
  if (send.state !== "queued" && send.state !== "failed") {
    return { sent: false, detail: `Already ${send.state} to ${send.toEmail}.` };
  }

  try {
    const result = await ctx.email.send({
      to: input.to,
      subject: input.subject,
      html: input.html,
      // The send's own id. Derived from what the message is rather than from
      // when it was tried, so a retry asks the provider to finish the send it
      // already started instead of starting a second one.
      idempotencyKey: send.id,
    });

    await repo.markSent(ctx.db, send.id, {
      providerMessageId: result.providerMessageId,
      subject: input.subject,
      now: ctx.clock.realNow(),
    });

    return { sent: true, detail: `Sent to ${send.toEmail} (${result.providerMessageId}).` };
  } catch (error) {
    // Recorded, then rethrown. The row is what the screen shows and the throw is
    // what makes the queue retry — reporting success here would leave a message
    // that never went out looking like one that did.
    await repo.markFailed(ctx.db, send.id, {
      error: error instanceof Error ? error.message : String(error),
      now: ctx.clock.realNow(),
    });
    throw error;
  }
}

/**
 * A provider's later verdict about a message.
 *
 * Takes no actor: the caller is a webhook route, which has authenticated the
 * provider's signature and has no person behind it.
 */
export async function recordDeliveryEvent(
  ctx: CoreContext,
  input: {
    providerMessageId: string;
    event: "delivered" | "opened" | "bounced" | "complained";
    at: Date;
  },
): Promise<boolean> {
  return repo.recordDeliveryEvent(ctx.db, input);
}

/**
 * Withdraws consent from an unsubscribe link.
 *
 * Answers the same way whether the token was real, because a different answer
 * for a real one turns the endpoint into a way to test which tokens exist.
 */
export async function unsubscribe(ctx: CoreContext, token: string): Promise<void> {
  const userId = await repo.userForUnsubscribeToken(ctx.db, hashToken(token));
  if (!userId) return;

  await repo.withdrawMarketingConsent(ctx.db, { userId, now: ctx.clock.realNow() });
}

/** What one account has agreed to, for the screen that shows it. */
export type MarketingConsent = repo.MarketingConsent;

export function marketingConsentFor(
  ctx: CoreContext,
  userId: string,
): Promise<MarketingConsent | undefined> {
  return repo.marketingConsentFor(ctx.db, userId);
}

/**
 * Records or withdraws express consent for one account.
 *
 * One function for both directions, and audited either way. Consent is the
 * thing that decides whether a marketing message may be sent at all, so "who
 * changed this, when, and which way" has to be answerable from the log — and a
 * pair of functions is a pair of audit actions to keep in step.
 *
 * An administrator setting this is recording something that happened elsewhere
 * — a form, a phone call, a signed agreement — which is what `source` is for.
 * A withdrawal is also what the unsubscribe link does, through the same repo
 * write, so there is one way consent is stored however it was decided.
 */
export async function setMarketingConsent(
  ctx: CoreContext,
  actor: Actor,
  userId: string,
  input: { granted: boolean; source: string },
): Promise<void> {
  requireAdmin(actor);

  const now = ctx.clock.realNow();
  await ctx.db.transaction(async (tx) => {
    if (input.granted) {
      await repo.grantMarketingConsent(tx, { userId, source: input.source, now });
    } else {
      await repo.withdrawMarketingConsent(tx, { userId, now });
    }

    await record(
      ctx,
      actor,
      {
        action: input.granted ? "email.consent_grant" : "email.consent_withdraw",
        entityType: "user",
        entityId: userId,
        after: {
          channel: "marketing_email",
          basis: input.granted ? "express" : "withdrawn",
          source: input.source,
        },
      },
      tx,
    );
  });
}

export type SentSummary = repo.SentSummary & {
  /** The prototype's stats column (line 2721), or the reason there is none. */
  stats: string;
  status: "Sent" | "Queued" | "Failed";
};

export type EmailView = {
  audience: Audience;
  /**
   * The accounts the screen arrived with, from a Users-screen Email button.
   *
   * Resolved rather than taken on trust: an id in a URL names an account that
   * may since have been suspended, or may never have been reachable — and a
   * recipient list that shows a name the send will then skip is worse than one
   * that never showed it.
   */
  selected: readonly Recipient[];
  audiences: readonly { key: Audience; label: string; selected: boolean }[];
  templates: readonly LiveTemplate[];
  active: LiveTemplate;
  preview: RenderedEmail;
  fields: readonly { token: string; name: string; label: string; restricted: boolean }[];
  /** Fields the sender must supply before this template can go to an audience. */
  senderFields: readonly { name: string; token: string; label: string }[];
  /** Why this template cannot be sent to an audience, when it cannot. */
  notSendable: string | null;
  /** How many accounts the current audience and scope reach. */
  scopes: readonly { kind: Scope["kind"]; label: string; count: number }[];
  recent: readonly SentSummary[];
  secondConfirmationAbove: number;
  /** Whether provider delivery statistics are reaching this deployment. */
  statsAvailable: boolean;
};

/**
 * Everything the screen renders, in one call.
 *
 * Including the three recipient counts, which the prototype hard-codes. They
 * are three cheap aggregate queries and the alternative is a dialog whose
 * number nobody can trust.
 */
export async function getEmailView(
  ctx: CoreContext,
  actor: Actor,
  input: { audience?: unknown; templateKey?: string; userIds?: readonly string[] },
): Promise<EmailView> {
  requireAdmin(actor);

  const audience = input.audience === undefined ? "customers" : parseAudience(input.audience);
  const templates = await listTemplates(ctx, actor);

  const active =
    (input.templateKey ? templates.find((one) => one.key === input.templateKey) : undefined) ??
    templates[0];
  if (!active) throw new NotFoundError("The template library is empty.");

  const preview = render(
    {
      subject: active.subject,
      body: active.body,
      allowedFields: active.allowedFields,
      values: previewValues(ctx),
    },
    `The "${active.name}" template`,
  );

  const userIds = input.userIds ?? [];

  // Resolved through the same query and the same filters as any other send, so
  // a preselected account that is suspended, unverified or without consent is
  // absent here exactly as it would be absent from the send.
  const selected =
    userIds.length > 0
      ? await resolveRecipients(ctx, {
          audience,
          scope: { kind: "accounts", userIds },
          template: active,
        })
      : [];

  const kinds: readonly Scope["kind"][] = ["everyone", "active_90_days", "accounts"];
  const scopes = await Promise.all(
    kinds.map(async (kind) => {
      if (kind === "accounts") {
        // Reaches nobody until somebody is picked, which is why it counts zero
        // until the screen arrives with an account.
        return {
          kind,
          label:
            selected.length > 0
              ? describeScope(audience, { kind: "accounts", userIds }, selected.length)
              : "Pick individual accounts",
          count: selected.length,
        };
      }

      const scope: Scope = kind === "everyone" ? { kind: "everyone" } : { kind: "active_90_days" };
      const recipients = await resolveRecipients(ctx, { audience, scope, template: active });
      return {
        kind,
        label: describeScope(audience, scope, recipients.length),
        count: recipients.length,
      };
    }),
  );

  const recent = (await repo.recentSends(ctx.db, RECENT_LIMIT)).map(summarise);
  const statsAvailable = await repo.anyDeliveryEvents(ctx.db);

  return {
    audience,
    selected,
    audiences: (["customers", "vendors", "both"] as const).map((key) => ({
      key,
      label: audienceLabel(key),
      selected: key === audience,
    })),
    templates,
    active,
    preview,
    fields: active.allowedFields.map((name) => ({
      token: `{{${name}}}`,
      name,
      label: name.replace(/_/g, " "),
      restricted: isRestricted(name),
    })),
    senderFields: senderSuppliedFields(active).map((name) => ({
      name,
      token: `{{${name}}}`,
      label: name.replace(/_/g, " "),
    })),
    notSendable: sendableRefusal(active),
    scopes,
    recent,
    secondConfirmationAbove: SECOND_CONFIRMATION_ABOVE,
    statsAvailable,
  };
}

/**
 * The log line for one send or one broadcast.
 *
 * The prototype's stats are invented percentages (line 2721). Here the column
 * says what the provider actually reported — and where it has reported nothing,
 * it says so rather than showing a plausible number. A dead statistic on an
 * operations screen is worse than an absent one: somebody will act on it.
 */
/** The refusal `assertSendableToAudience` would make, as a sentence to show. */
function sendableRefusal(template: LiveTemplate): string | null {
  try {
    assertSendableToAudience(template);
    return null;
  } catch (error) {
    return error instanceof ValidationError ? error.message : null;
  }
}

function summarise(row: repo.SentSummary): SentSummary {
  const status = row.failed > 0 && row.sent === 0 ? "Failed" : row.sent === 0 ? "Queued" : "Sent";

  const stats =
    row.delivered === 0 && row.opened === 0 && row.bounced === 0
      ? status === "Failed"
        ? row.failed === 1
          ? "1 message failed"
          : `${row.failed} messages failed`
        : "Delivery stats unavailable"
      : [
          `${percent(row.delivered, row.recipients)} delivered`,
          `${percent(row.opened, row.recipients)} opened`,
          ...(row.bounced > 0 ? [`${row.bounced} bounced`] : []),
        ].join(" · ");

  return { ...row, stats, status };
}

function percent(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export type { Audience, Scope, TemplateClass };
