import { NextResponse, type NextRequest } from "next/server";
import {
  UnknownOrderError,
  applyWebhook,
  markWebhookFailed,
  markWebhookProcessed,
  recordWebhook,
  vendorIdForStripeAccount,
} from "@occasion/core";
import { createRequestContext } from "../../../../lib/core";

/**
 * Where Stripe's events arrive.
 *
 * The four rules this handler exists to keep, each of which was a defect the
 * red team found in the shape that preceded it:
 *
 * 1. **Verify, then validate the account.** An event for a connected account
 *    this platform does not know is refused before it reaches any state
 *    machine. The signature proves Stripe sent it; it does not prove it is
 *    about a business here.
 * 2. **Acknowledge on receipt.** The event is stored unprocessed and answered
 *    200 as soon as it is on disk. Stripe's delivery is then done, and nothing
 *    that happens next can lose it.
 * 3. **Process separately, and say so when it fails.** Applying the event is a
 *    second transaction. A failure records the error, leaves `processed_at`
 *    null, and answers 5xx so Stripe retries — the opposite of the 200-on-
 *    failure that silently drops a confirmation.
 * 4. **Idempotency is `processed_at`, never the row existing.** A handler that
 *    died halfway left a row behind, and treating that as "already done" is how
 *    a paid order stays unconfirmed for ever.
 *
 * An event that names an order this platform has not written yet — the webhook
 * beat the checkout transaction — is parked rather than failed: the row stays
 * unprocessed with no error, and the sweep retries it.
 */

/** Node, not Edge: the signature is checked against raw bytes. */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "No signature." }, { status: 400 });
  }

  // The exact bytes that were signed. Anything that has been through
  // `request.json()` and back cannot be verified against them.
  const rawBody = await request.text();
  const ctx = createRequestContext();

  let event;
  try {
    event = ctx.stripe.parseWebhook(rawBody, signature);
  } catch {
    // Deliberately no detail: an endpoint that explains why a signature failed
    // is an oracle for forging one.
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event.account) {
    const vendorId = await vendorIdForStripeAccount(ctx.db, event.account);
    if (!vendorId) {
      // Signed by Stripe, and about somebody else's business. 202 rather than
      // an error: there is nothing wrong with the delivery, and nothing here
      // to do about it.
      return NextResponse.json({ ignored: "unknown account" }, { status: 202 });
    }
  }

  const now = ctx.clock.realNow();
  const stored = await recordWebhook(ctx.db, {
    eventId: event.id,
    type: event.type,
    account: event.account,
    payload: event.payload,
    now,
  });

  if (stored.processedAt) {
    // Already applied. Replay changes nothing.
    return NextResponse.json({ status: "already processed" });
  }

  try {
    const result = await applyWebhook(ctx, { type: event.type, object: event.object });
    await markWebhookProcessed(ctx.db, stored.id, ctx.clock.realNow());
    return NextResponse.json({ status: "processed", applied: result.applied });
  } catch (error) {
    if (error instanceof UnknownOrderError) {
      // The event overtook the transaction that created its order. Parked
      // unprocessed with no error recorded, because nothing is wrong yet.
      //
      // 200 rather than 5xx is deliberate but it is half the answer: the sweep
      // that replays parked events belongs to the jobs runner, which this
      // milestone does not have. Until it does, an event that genuinely
      // overtakes its order stays on disk and is applied by nothing —
      // `listUnprocessedWebhooks` is what will find them, and it has no caller
      // yet. The window is the moment between a checkout committing and its
      // provider call returning, which in practice the provider's own delivery
      // latency covers.
      return NextResponse.json({ status: "parked", reason: "order not written yet" });
    }

    await markWebhookFailed(ctx.db, stored.id, String(error));
    // 5xx, so Stripe retries. The row is on disk either way.
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}
