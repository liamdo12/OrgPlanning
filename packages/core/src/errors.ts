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
