import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { recordEmailDeliveryEvent } from "@occasion/core";
import { createRequestContext } from "../../../../lib/core";
import { getEnv } from "../../../../lib/env";

/**
 * Where the email provider's verdicts arrive.
 *
 * Without this the send log can only say a message was handed over, which is
 * not the same as it arriving — and the prototype's "92% delivered · 61%
 * opened" column (line 2721) would be an invented number on an operations
 * screen. The screen says "Delivery stats unavailable" until events land here,
 * because a dead statistic is worse than an absent one: somebody acts on it.
 *
 * Resend signs with Svix, so the signature covers `id.timestamp.body` rather
 * than the body alone, and the secret is base64 behind a `whsec_` prefix. That
 * is a specific enough format to be worth stating: verifying the body alone
 * would accept a replay of any past event, and verifying against the prefixed
 * string rather than the decoded key fails every time in a way that looks like
 * a provider outage.
 *
 * Unlike the Stripe handler this one does not store the event first. It is not
 * money: a delivery notice this platform never receives costs a percentage on a
 * screen, and the row it would update is already correct about the only thing
 * that matters — that the message was sent.
 */

/** Node, not Edge: the signature is checked against raw bytes. */
export const runtime = "nodejs";

/** Past this, a signed payload is a replay rather than a delivery. */
const TOLERANCE_SECONDS = 5 * 60;

type SvixHeaders = { id: string; timestamp: string; signatures: string[] };

function svixHeaders(request: NextRequest): SvixHeaders | null {
  const id = request.headers.get("svix-id") ?? request.headers.get("webhook-id");
  const timestamp =
    request.headers.get("svix-timestamp") ?? request.headers.get("webhook-timestamp");
  const signature =
    request.headers.get("svix-signature") ?? request.headers.get("webhook-signature");

  if (!id || !timestamp || !signature) return null;

  // `v1,<base64> v1,<base64>` — more than one while a secret is being rotated.
  return { id, timestamp, signatures: signature.split(" ").filter(Boolean) };
}

function verified(headers: SvixHeaders, rawBody: string, secret: string): boolean {
  const sent = Number(headers.timestamp);
  if (!Number.isFinite(sent)) return false;

  // A signature with no expiry is a credential: anything that ever captured one
  // delivery could replay it for ever.
  const age = Math.abs(Math.floor(Date.now() / 1000) - sent);
  if (age > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest();

  return headers.signatures.some((entry) => {
    const [, value] = entry.split(",");
    if (!value) return false;

    const candidate = Buffer.from(value, "base64");
    // Constant time, and only after the lengths match — `timingSafeEqual`
    // throws on a length mismatch, which would itself leak the length.
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

/** The provider's vocabulary, narrowed to the four this platform records. */
function outcomeOf(type: unknown): "delivered" | "opened" | "bounced" | "complained" | null {
  switch (type) {
    case "email.delivered":
      return "delivered";
    case "email.opened":
      return "opened";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    default:
      return null;
  }
}

export async function POST(request: NextRequest) {
  const headers = svixHeaders(request);
  if (!headers) {
    return NextResponse.json({ error: "No signature." }, { status: 400 });
  }

  // The exact bytes that were signed. Anything that has been through
  // `request.json()` and back cannot be verified against them.
  const rawBody = await request.text();

  if (!verified(headers, rawBody, getEnv().EMAIL_WEBHOOK_SECRET)) {
    // Deliberately no detail: an endpoint that explains why a signature failed
    // is an oracle for forging one.
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let payload: { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  const outcome = outcomeOf(payload.type);
  const providerMessageId = payload.data?.email_id;

  if (!outcome || typeof providerMessageId !== "string") {
    // Signed, well-formed, and about something this platform does not record.
    // 202 rather than an error: there is nothing wrong with the delivery, and
    // answering 4xx would make the provider retry it for days.
    return NextResponse.json({ ignored: "unhandled event" }, { status: 202 });
  }

  const at =
    typeof payload.created_at === "string" && !Number.isNaN(Date.parse(payload.created_at))
      ? new Date(payload.created_at)
      : new Date();

  const ctx = createRequestContext();
  const matched = await recordEmailDeliveryEvent(ctx, { providerMessageId, event: outcome, at });

  // 202 for an event about a message this platform has no row for — a test send
  // from the provider's own dashboard, most often. Not a failure to retry.
  return NextResponse.json({ recorded: matched }, { status: matched ? 200 : 202 });
}
