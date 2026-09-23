/**
 * Domain errors.
 *
 * The distinction that matters here is between "you may not" and "there is no
 * such thing". Leaking the difference is an enumeration oracle: a vendor who
 * gets 403 for one order id and 404 for another has learned which orders
 * exist. The object policies therefore answer with `NotFoundError` when the
 * actor is not a party to the row, and reserve `ForbiddenError` for cases
 * where the actor's own identity is the problem.
 */

export class AppError extends Error {
  override name = "AppError";
}

/** No authenticated actor, or a session that is no longer valid. */
export class UnauthenticatedError extends AppError {
  override name = "UnauthenticatedError";

  constructor(message = "Not signed in.") {
    super(message);
  }
}

/** An identified actor who is not allowed to use this entry point. */
export class ForbiddenError extends AppError {
  override name = "ForbiddenError";

  constructor(message = "Not permitted.") {
    super(message);
  }
}

/**
 * The row does not exist, or the actor is not a party to it.
 *
 * Deliberately the same answer for both.
 */
export class NotFoundError extends AppError {
  override name = "NotFoundError";

  constructor(message = "Not found.") {
    super(message);
  }
}

/** Input that failed a domain rule. */
export class ValidationError extends AppError {
  override name = "ValidationError";

  constructor(
    message: string,
    /** Field-level detail, safe to show a user. */
    readonly issues: Record<string, string> = {},
  ) {
    super(message);
  }
}

/**
 * The date a booking needs is already held.
 *
 * The exclusion constraint on active capacity blocks is what actually prevents
 * a double booking, so the clash arrives as a driver error from inside the
 * checkout transaction. Translated here because "conflicting key value violates
 * exclusion constraint" is not something to put in front of a customer, and
 * because the service and the day are the two facts a screen needs to say
 * *which* date is taken and offer another.
 */
export class CapacityConflictError extends AppError {
  override name = "CapacityConflictError";

  constructor(
    /** The service whose calendar refused the booking. */
    readonly serviceId: string,
    /** The day it is already booked for, `YYYY-MM-DD` in the event's zone. */
    readonly day: string,
  ) {
    super(`That date is already booked.`);
  }
}

/** The four figures a customer consents to when they authorise a booking. */
export type AgreedFigures = {
  total: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  /** Null when the whole amount is taken at checkout. */
  balanceDueAt: Date | null;
};

/**
 * The booking would cost something other than what the customer agreed to.
 *
 * A checkout re-reads the platform's rates inside its own transaction, so an
 * administrator saving a new commission between the screen rendering and the
 * button being pressed changes the price of a booking somebody has already read
 * and consented to. Recording that consent anyway would produce an agreement
 * for an amount nobody saw.
 *
 * So the screen states what it displayed and this is the refusal. The figures
 * that would actually be charged travel on the error, because the only useful
 * thing a screen can do with this is show them and ask again — re-quoting would
 * be a third reading of the rates and could differ from both.
 *
 * Nothing is written when this is raised: it is thrown inside the checkout's
 * transaction, so no order, no capacity block and no queued work survive it.
 */
export class AgreementMismatchError extends AppError {
  override name = "AgreementMismatchError";

  constructor(readonly terms: AgreedFigures) {
    super("The price of this booking has changed since it was shown to you.");
  }
}

/**
 * The event cannot be changed while one of its bookings is still live.
 *
 * A `ValidationError` so that every caller already handling a refused form
 * keeps working, and a subclass so the one fact a screen needs — which booking
 * — is a field rather than something to be read back out of a sentence.
 */
export class BookingLiveError extends ValidationError {
  override name = "BookingLiveError";

  constructor(
    message: string,
    /** The booking in the way, as the customer sees it named. */
    readonly reference: string,
  ) {
    super(message, { eventDate: "booked", reference });
  }
}

/** Too many attempts in the window. */
export class RateLimitedError extends AppError {
  override name = "RateLimitedError";

  constructor(
    message = "Too many attempts. Try again later.",
    /** When the caller may retry. */
    readonly retryAfter?: Date,
  ) {
    super(message);
  }
}
