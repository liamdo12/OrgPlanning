import { and, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  communicationConsents,
  emailSends,
  emailTemplates,
  orders,
  userRoles,
  users,
} from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";
import type { TemplateAudience, TemplateClass } from "./template.js";

/**
 * Database access for the email library and the send log.
 *
 * `email_templates` holds **edits only**. A template the platform ships and
 * nobody has touched has no row, so the library on screen is the modules in
 * `templates/` with whatever rows exist laid over them. The alternative — seed
 * every template as a row — makes the security-relevant part of a template, its
 * allowlist and its class, deletable data rather than reviewed code.
 */

export type TemplateOverride = {
  id: string;
  key: string;
  name: string;
  audience: TemplateAudience;
  class: TemplateClass;
  trigger: string | null;
  automatic: Date | null;
  subject: string;
  body: string;
  allowedFields: string[];
};

const templateColumns = {
  id: emailTemplates.id,
  key: emailTemplates.key,
  name: emailTemplates.name,
  audience: emailTemplates.audience,
  class: emailTemplates.class,
  trigger: emailTemplates.trigger,
  automatic: emailTemplates.automatic,
  subject: emailTemplates.subject,
  body: emailTemplates.body,
  allowedFields: emailTemplates.allowedMergeFields,
};

function toOverride(row: {
  id: string;
  key: string;
  name: string;
  audience: TemplateAudience;
  class: TemplateClass;
  trigger: string | null;
  automatic: Date | null;
  subject: string;
  body: string;
  allowedFields: unknown;
}): TemplateOverride {
  return {
    ...row,
    // `jsonb` is whatever was written; a row edited by hand is the ordinary way
    // it stops being an array of strings, and an allowlist that silently reads
    // as empty is one that refuses every send.
    allowedFields: Array.isArray(row.allowedFields)
      ? row.allowedFields.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

export async function listOverrides(db: DbExecutor): Promise<TemplateOverride[]> {
  const rows = await db.select(templateColumns).from(emailTemplates);
  return rows.map(toOverride);
}

export async function findOverride(
  db: DbExecutor,
  key: string,
): Promise<TemplateOverride | undefined> {
  const [row] = await db
    .select(templateColumns)
    .from(emailTemplates)
    .where(eq(emailTemplates.key, key))
    .limit(1);
  return row ? toOverride(row) : undefined;
}

/**
 * Writes an administrator's edit.
 *
 * Upsert on `key`, so saving a shipped template for the first time creates its
 * row and saving it again replaces it. The key is the identity; the row is a
 * revision of it.
 */
export async function upsertOverride(
  db: DbExecutor,
  input: {
    key: string;
    name: string;
    audience: TemplateAudience;
    class: TemplateClass;
    trigger: string | null;
    automatic: Date | null;
    subject: string;
    body: string;
    allowedFields: readonly string[];
  },
  now: Date,
): Promise<TemplateOverride> {
  const values = {
    key: input.key,
    name: input.name,
    audience: input.audience,
    class: input.class,
    trigger: input.trigger,
    automatic: input.automatic,
    subject: input.subject,
    body: input.body,
    allowedMergeFields: [...input.allowedFields],
    updatedAt: now,
  };

  const [row] = await db
    .insert(emailTemplates)
    .values(values)
    .onConflictDoUpdate({ target: emailTemplates.key, set: values })
    .returning(templateColumns);

  if (!row) throw new Error(`The template "${input.key}" was not written.`);
  return toOverride(row);
}

export type SendRow = {
  id: string;
  templateId: string | null;
  broadcastId: string | null;
  recipientUserId: string | null;
  toEmail: string;
  subject: string;
  state: "queued" | "sent" | "delivered" | "bounced" | "complained" | "failed";
  idempotencyKey: string;
  providerMessageId: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  openedAt: Date | null;
  bouncedAt: Date | null;
  complainedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
};

const sendColumns = {
  id: emailSends.id,
  templateId: emailSends.templateId,
  broadcastId: emailSends.broadcastId,
  recipientUserId: emailSends.recipientUserId,
  toEmail: emailSends.toEmail,
  subject: emailSends.subject,
  state: emailSends.state,
  idempotencyKey: emailSends.idempotencyKey,
  providerMessageId: emailSends.providerMessageId,
  sentAt: emailSends.sentAt,
  deliveredAt: emailSends.deliveredAt,
  openedAt: emailSends.openedAt,
  bouncedAt: emailSends.bouncedAt,
  complainedAt: emailSends.complainedAt,
  lastError: emailSends.lastError,
  createdAt: emailSends.createdAt,
};

/**
 * Records that a message is going to be sent, before anything is sent.
 *
 * `idempotencyKey` is unique, and the insert tolerates a conflict by returning
 * nothing: a queued job re-enqueued for the same recipient and the same
 * occasion resolves to one row, so a retry cannot become a second message.
 * The key is derived from what the message is about, never from the clock.
 */
export async function createSend(
  db: DbExecutor,
  input: {
    templateId: string | null;
    broadcastId: string | null;
    recipientUserId: string | null;
    toEmail: string;
    subject: string;
    idempotencyKey: string;
    mergeValues: Record<string, string> | null;
    unsubscribeToken: string | null;
    now: Date;
  },
): Promise<SendRow | undefined> {
  const [row] = await db
    .insert(emailSends)
    .values({
      templateId: input.templateId,
      broadcastId: input.broadcastId,
      recipientUserId: input.recipientUserId,
      toEmail: input.toEmail,
      subject: input.subject,
      state: "queued",
      idempotencyKey: input.idempotencyKey,
      mergeValues: input.mergeValues,
      unsubscribeToken: input.unsubscribeToken,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing({ target: emailSends.idempotencyKey })
    .returning(sendColumns);

  return row;
}

export async function findSend(db: DbExecutor, id: string): Promise<SendRow | undefined> {
  const [row] = await db.select(sendColumns).from(emailSends).where(eq(emailSends.id, id)).limit(1);
  return row;
}

export async function findSendByKey(
  db: DbExecutor,
  idempotencyKey: string,
): Promise<SendRow | undefined> {
  const [row] = await db
    .select(sendColumns)
    .from(emailSends)
    .where(eq(emailSends.idempotencyKey, idempotencyKey))
    .limit(1);
  return row;
}

export async function markSent(
  db: DbExecutor,
  id: string,
  input: { providerMessageId: string; subject: string; now: Date },
): Promise<void> {
  await db
    .update(emailSends)
    .set({
      state: "sent",
      providerMessageId: input.providerMessageId,
      subject: input.subject,
      sentAt: input.now,
      lastError: null,
      updatedAt: input.now,
    })
    .where(eq(emailSends.id, id));
}

export async function markFailed(
  db: DbExecutor,
  id: string,
  input: { error: string; now: Date },
): Promise<void> {
  await db
    .update(emailSends)
    .set({ state: "failed", lastError: input.error.slice(0, 500), updatedAt: input.now })
    .where(eq(emailSends.id, id));
}

/**
 * A verdict from the provider, arriving after the send.
 *
 * Only ever moves a row forward, and only from a state the event can follow.
 * Providers redeliver webhooks and deliver them out of order, so a `delivered`
 * arriving after a `bounced` is an ordinary thing to receive and must not
 * overwrite the bounce — the bounce is the fact that matters about that
 * address.
 */
export async function recordDeliveryEvent(
  db: DbExecutor,
  input: {
    providerMessageId: string;
    event: "delivered" | "opened" | "bounced" | "complained";
    at: Date;
  },
): Promise<boolean> {
  const set =
    input.event === "delivered"
      ? { state: "delivered" as const, deliveredAt: input.at, updatedAt: input.at }
      : input.event === "opened"
        ? { openedAt: input.at, updatedAt: input.at }
        : input.event === "bounced"
          ? { state: "bounced" as const, bouncedAt: input.at, updatedAt: input.at }
          : { state: "complained" as const, complainedAt: input.at, updatedAt: input.at };

  // An open does not change the state, so it may land on anything; the three
  // that do may only land on a row that has not already reached a verdict a
  // later event cannot improve on.
  const reachable =
    input.event === "opened"
      ? undefined
      : input.event === "delivered"
        ? inArray(emailSends.state, ["queued", "sent"])
        : inArray(emailSends.state, ["queued", "sent", "delivered"]);

  const updated = await db
    .update(emailSends)
    .set(set)
    .where(
      reachable
        ? and(eq(emailSends.providerMessageId, input.providerMessageId), reachable)
        : eq(emailSends.providerMessageId, input.providerMessageId),
    )
    .returning({ id: emailSends.id });

  return updated.length > 0;
}

export type SentSummary = {
  /** The broadcast id where there is one, otherwise the send's own id. */
  key: string;
  subject: string;
  templateId: string | null;
  recipients: number;
  toEmail: string | null;
  at: Date;
  sent: number;
  delivered: number;
  opened: number;
  bounced: number;
  failed: number;
};

/**
 * "Recently sent", grouped the way the screen reads it.
 *
 * One row per broadcast rather than per message — the prototype's log says
 * "All accounts · 1,204" (line 2721), which is one decision, not 1,204 of them.
 * A transactional send has no broadcast id and groups as itself.
 */
export async function recentSends(db: DbExecutor, limit: number): Promise<SentSummary[]> {
  const key = sql<string>`coalesce(${emailSends.broadcastId}::text, ${emailSends.id}::text)`;

  const rows = await db
    .select({
      key,
      subject: sql<string>`min(${emailSends.subject})`,
      templateId: sql<string | null>`min(${emailSends.templateId}::text)`,
      recipients: sql<number>`count(*)::int`,
      toEmail: sql<
        string | null
      >`case when count(*) = 1 then min(${emailSends.toEmail}) else null end`,
      at: sql<Date>`max(${emailSends.createdAt})`,
      sent: sql<number>`count(*) filter (where ${emailSends.sentAt} is not null)::int`,
      delivered: sql<number>`count(*) filter (where ${emailSends.deliveredAt} is not null)::int`,
      opened: sql<number>`count(*) filter (where ${emailSends.openedAt} is not null)::int`,
      bounced: sql<number>`count(*) filter (where ${emailSends.bouncedAt} is not null)::int`,
      failed: sql<number>`count(*) filter (where ${emailSends.state} = 'failed')::int`,
    })
    .from(emailSends)
    .groupBy(key)
    .orderBy(desc(sql`max(${emailSends.createdAt})`))
    .limit(limit);

  return rows;
}

/**
 * Whether the provider has ever reported anything about anything.
 *
 * Its own query rather than a scan of the page being shown: computed from the
 * most recent twenty-five groups, the banner flips back to "unavailable" as
 * soon as twenty-five newer messages arrive before their delivery events do —
 * telling an administrator the webhook is not configured when it is.
 */
export async function anyDeliveryEvents(db: DbExecutor): Promise<boolean> {
  const [row] = await db
    .select({ id: emailSends.id })
    .from(emailSends)
    .where(
      or(
        isNotNull(emailSends.deliveredAt),
        isNotNull(emailSends.openedAt),
        isNotNull(emailSends.bouncedAt),
        isNotNull(emailSends.complainedAt),
      ),
    )
    .limit(1);

  return row !== undefined;
}

/** An account's own address and name, for a transactional send. */
export type RecipientRow = {
  userId: string;
  email: string;
  fullName: string;
};

export async function findRecipient(
  db: DbExecutor,
  userId: string,
): Promise<RecipientRow | undefined> {
  const [row] = await db
    .select({ userId: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
}

/**
 * Withdraws a consent from an unsubscribe link.
 *
 * Keyed on the send's own token, so it needs no session: the person clicking it
 * is holding a secret that was mailed to exactly one address. Returns the
 * account it withdrew for, or nothing when the token is unknown — the caller
 * shows the same page either way, because telling somebody a token is not real
 * confirms which ones are.
 */
export async function userForUnsubscribeToken(
  db: DbExecutor,
  token: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: emailSends.recipientUserId })
    .from(emailSends)
    // No condition beyond the token. Filtering on delivery state was wrong in
    // the one direction that matters: a provider reports a soft bounce for a
    // message that reached the mailbox anyway, and the person who then clicks
    // Unsubscribe would be shown "Done" while their consent stood.
    .where(eq(emailSends.unsubscribeToken, token))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Every address a broadcast may reach, with its consent already applied.
 *
 * One query. An audience screen that resolves consent per recipient is an N+1
 * against a table that grows with the platform, and the count in the
 * confirmation dialog is read off this — a count that disagrees with the send
 * is worse than no count, because it is what the administrator is asked to
 * approve.
 */
export type AudienceQuery = {
  /** Roles the recipient must hold at least one of. */
  roles: readonly ("customer" | "vendor" | "admin")[];
  /** Only accounts that did something in this window, when given. */
  activeSince: Date | null;
  /** Explicit accounts, which still pass every other filter. */
  userIds: readonly string[] | null;
  /** Whether an express consent on `marketing_email` is required. */
  requireConsent: boolean;
  now: Date;
};

export async function resolveAudience(
  db: DbExecutor,
  query: AudienceQuery,
): Promise<RecipientRow[]> {
  const roles = query.roles.length > 0 ? [...query.roles] : (["customer"] as const);

  const conditions = [
    // Suspended and unverified accounts never receive platform email. A
    // suspended account is one the platform has stopped doing business with,
    // and an unverified address is one nobody has shown belongs to them.
    eq(users.status, "active"),
    isNotNull(users.emailVerifiedAt),
    exists(
      db
        .select({ one: sql`1` })
        .from(userRoles)
        .where(and(eq(userRoles.userId, users.id), inArray(userRoles.role, [...roles]))),
    ),
  ];

  if (query.requireConsent) {
    // CASL: consent is a record with a basis and a lifetime, not a flag. Only
    // **express** consent carries a commercial message — implied consent exists
    // in the table because the law recognises it, but it is inferred from a
    // transaction rather than given, and this platform does not send marketing
    // on an inference.
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(communicationConsents)
          .where(
            and(
              eq(communicationConsents.userId, users.id),
              eq(communicationConsents.channel, "marketing_email"),
              eq(communicationConsents.basis, "express"),
              isNull(communicationConsents.withdrawnAt),
              or(
                isNull(communicationConsents.expiresAt),
                gt(communicationConsents.expiresAt, query.now),
              ),
            ),
          ),
      ),
    );
  }

  if (query.activeSince) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(orders)
          .where(and(eq(orders.userId, users.id), gte(orders.createdAt, query.activeSince))),
      ),
    );
  }

  if (query.userIds) {
    if (query.userIds.length === 0) return [];
    conditions.push(inArray(users.id, [...query.userIds]));
  }

  return db
    .select({ userId: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(and(...conditions))
    .orderBy(users.email);
}

export type MarketingConsent = {
  basis: "express" | "implied" | "withdrawn";
  capturedAt: Date;
  expiresAt: Date | null;
  withdrawnAt: Date | null;
};

/**
 * What one account has agreed to, for the screen that shows it.
 *
 * Read rather than derived, because the whole point of storing consent as a
 * record with a basis and a lifetime is that an administrator answering "why
 * did this person not get the email" can see which of the three reasons it was.
 */
export async function marketingConsentFor(
  db: DbExecutor,
  userId: string,
): Promise<MarketingConsent | undefined> {
  const [row] = await db
    .select({
      basis: communicationConsents.basis,
      capturedAt: communicationConsents.capturedAt,
      expiresAt: communicationConsents.expiresAt,
      withdrawnAt: communicationConsents.withdrawnAt,
    })
    .from(communicationConsents)
    .where(
      and(
        eq(communicationConsents.userId, userId),
        eq(communicationConsents.channel, "marketing_email"),
      ),
    )
    .limit(1);

  return row;
}

/** Records an express consent, which is how an account becomes reachable. */
export async function grantMarketingConsent(
  db: DbExecutor,
  input: { userId: string; source: string; now: Date },
): Promise<void> {
  await db
    .insert(communicationConsents)
    .values({
      userId: input.userId,
      channel: "marketing_email",
      basis: "express",
      source: input.source,
      capturedAt: input.now,
      expiresAt: null,
      withdrawnAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [communicationConsents.userId, communicationConsents.channel],
      set: {
        basis: "express",
        source: input.source,
        capturedAt: input.now,
        // Express consent does not lapse; only a withdrawal ends it.
        expiresAt: null,
        withdrawnAt: null,
        updatedAt: input.now,
      },
    });
}

/** Withdraws it again, which an unsubscribe link does without a session. */
export async function withdrawMarketingConsent(
  db: DbExecutor,
  input: { userId: string; now: Date },
): Promise<void> {
  await db
    .insert(communicationConsents)
    .values({
      userId: input.userId,
      channel: "marketing_email",
      basis: "withdrawn",
      source: "unsubscribe",
      capturedAt: input.now,
      withdrawnAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [communicationConsents.userId, communicationConsents.channel],
      set: { basis: "withdrawn", withdrawnAt: input.now, updatedAt: input.now },
    });
}
