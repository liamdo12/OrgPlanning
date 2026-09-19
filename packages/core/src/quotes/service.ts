import { and, eq, inArray } from "drizzle-orm";
import { events, quoteOffers, quoteRequests } from "@occasion/db/schema";
import { record } from "../audit/service.js";
import type { CoreContext } from "../context.js";
import { formatDay, formatShortDay } from "../email/order-facts.js";
import { queueTransactional } from "../email/service.js";
import { NotFoundError } from "../errors.js";
import type { Actor } from "../identity/actor.js";

/**
 * Quote requests, to the extent this milestone needs them.
 *
 * The request-and-offer flow belongs to the customer and vendor views, which
 * this milestone does not build. What it does need is the expiry: the seed
 * writes an open request with a deadline, and the ops screen schedules a job
 * against it, so there has to be something for that job to call. A job type
 * with no handler is a queue entry that fails for ever.
 *
 * Deliberately the whole of it. Anything else here would be guessing at a
 * screen nobody has designed.
 */

export type QuoteExpiry = {
  quoteRequestId: string;
  /** Already closed, or closed by this call. */
  alreadyClosed: boolean;
  /** Offers withdrawn from play along with it. */
  offersExpired: number;
};

/**
 * Closes a request nobody booked from, and expires the offers on it.
 *
 * Idempotent: a request that is not `open` is left alone and reported as
 * already closed, so a job that runs twice — or a request a customer closed
 * themselves between the schedule and the run — changes nothing the second
 * time.
 *
 * The offers go with it because an offer outliving its request is a price a
 * vendor is still notionally standing behind for a booking that can no longer
 * be made.
 */
export async function expireQuoteRequest(
  ctx: CoreContext,
  actor: Actor,
  quoteRequestId: string,
): Promise<QuoteExpiry> {
  return ctx.db.transaction(async (tx) => {
    // The lock is taken on this row alone, with no join. `for update` may not be
    // applied to the nullable side of an outer join, and naming the table to
    // lock instead puts a schema-qualified name where Postgres accepts only a
    // relation name. The event is read separately, below, where no lock is
    // wanted anyway — the message quotes it, nothing decides on it.
    const [request] = await tx
      .select({
        id: quoteRequests.id,
        state: quoteRequests.state,
        userId: quoteRequests.userId,
        eventId: quoteRequests.eventId,
        expiresAt: quoteRequests.expiresAt,
      })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, quoteRequestId))
      .limit(1)
      .for("update");

    if (!request) throw new NotFoundError("No such quote request.");

    if (request.state !== "open") {
      return { quoteRequestId, alreadyClosed: true, offersExpired: 0 };
    }

    const now = ctx.clock.now();

    await tx
      .update(quoteRequests)
      .set({ state: "expired", closedAt: now, updatedAt: now })
      .where(eq(quoteRequests.id, quoteRequestId));

    const expired = await tx
      .update(quoteOffers)
      .set({ state: "expired", updatedAt: now })
      .where(
        and(
          eq(quoteOffers.quoteRequestId, quoteRequestId),
          // Only the ones still in play. An accepted offer is a booking and a
          // withdrawn one is the vendor's own decision; neither is this job's
          // to overwrite.
          inArray(quoteOffers.state, ["sent"]),
        ),
      )
      .returning({ id: quoteOffers.id });

    const [event] = request.eventId
      ? await tx
          .select({ name: events.name, eventDate: events.eventDate, isDemo: events.isDemo })
          .from(events)
          .where(eq(events.id, request.eventId))
          .limit(1)
      : [];

    // The customer is told their request has closed, in the same transaction
    // that closed it. `event_date` is a calendar date read back in Toronto, so
    // it is parsed at noon UTC and cannot land on the day before.
    await queueTransactional(ctx, tx, {
      templateKey: "quote_expiring",
      userId: request.userId,
      values: {
        event_name: event?.name ?? "your request",
        event_date: event?.eventDate
          ? formatDay(new Date(`${event.eventDate}T12:00:00.000Z`))
          : formatDay(request.expiresAt),
        quote_expiry: formatShortDay(request.expiresAt),
        city: "Toronto",
      },
      about: quoteRequestId,
      isDemo: event?.isDemo ?? false,
      now: ctx.clock.realNow(),
    });

    await record(
      ctx,
      actor,
      {
        action: "quote.expire",
        entityType: "quote_request",
        entityId: quoteRequestId,
        before: { state: request.state },
        after: { state: "expired", offersExpired: expired.length },
      },
      tx,
    );

    return { quoteRequestId, alreadyClosed: false, offersExpired: expired.length };
  });
}
