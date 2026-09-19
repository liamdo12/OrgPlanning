/**
 * Whether a string could be an id this platform issued.
 *
 * Every entity id here is a uuid, and Postgres raises `22P02 invalid input
 * syntax for type uuid` **before** it looks at any row — so a lookup on a value
 * somebody typed into the address bar does not come back as "no such thing", it
 * comes back as a driver error, which is not an `AppError` and therefore
 * reaches the error boundary.
 *
 * The screens that open a record from a query parameter all catch
 * `NotFoundError` and close the drawer instead of failing the page. This is
 * what makes that true for the other half of the cases: `?order=abc` is exactly
 * as much "no such record" as an id that has been deleted, and answering it
 * with an error page is both worse and a way to tell the two apart.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEntityId(value: string): boolean {
  return UUID.test(value);
}

/** The value when it could be an id, and the empty string when it could not. */
export function entityIdOr(value: string, fallback = ""): string {
  return isEntityId(value) ? value : fallback;
}
