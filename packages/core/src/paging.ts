/**
 * Keyset cursors, shared by the admin lists.
 *
 * Keyset rather than an offset: a row created or removed between one page and
 * the next shifts an offset, so a row repeats or vanishes. A cursor naming the
 * last row of the page cannot.
 *
 * The instant is carried as **the database's own text rendering**, never as a
 * `Date`. `created_at` is `timestamptz`, which keeps microseconds; JavaScript's
 * `Date` keeps milliseconds. A cursor built by `toISOString()` therefore names
 * an instant no row holds, so `= cursor` never matches and the id tiebreak
 * never fires — and every row inside the boundary millisecond matches neither
 * branch of the predicate and is silently unreachable at any page. That is not
 * hypothetical: rows written in one transaction share `now()` to the
 * microsecond, which is exactly the case the tiebreak exists for.
 *
 * `ordering/admin-repo.ts` has its own copy of this, from the phase that needed
 * it first; it is the same rules with an `orders`-shaped predicate. If a third
 * list wants paging, collapse the two.
 */

/** How many rows an admin list returns at once. The orders screen's own. */
export const PAGE_SIZE = 25;

export function encodeCursor(row: { cursorAt: string; id: string }): string {
  // A pipe rather than a colon: the timestamp has two of its own, so the
  // separator has to be a character neither half contains.
  return `${row.cursorAt}|${row.id}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres renders `timestamptz` as `2026-09-18 19:19:00.123456+00`. */
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/**
 * The two halves of a cursor, or nothing when it is not one.
 *
 * Both halves are checked rather than merely non-empty: they are compared
 * against `uuid` and `timestamptz` columns, and Postgres raises on a malformed
 * one instead of matching nothing. A hand-edited cursor should fall back to the
 * first page, not to the error boundary.
 */
export function decodeCursor(cursor: string): { at: string; id: string } | undefined {
  const split = cursor.lastIndexOf("|");
  if (split < 0) return undefined;

  const id = cursor.slice(split + 1);
  const at = cursor.slice(0, split);

  if (!UUID.test(id) || !PG_TIMESTAMP.test(at)) return undefined;

  return { at, id };
}
