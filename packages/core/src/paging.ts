/**
 * Keyset cursors, shared by every paged list.
 *
 * Keyset rather than an offset: a row created or removed between one page and
 * the next shifts an offset, so a row repeats or vanishes. A cursor naming the
 * last row of the page cannot.
 *
 * A cursor is three parts — the sort it was produced by, the leading sort
 * column's value, and the id that breaks ties — joined by a pipe. The sort is
 * in there because a cursor reaches the server as a query parameter, and a
 * value shaped like a cursor is not necessarily a cursor *for this list*: the
 * account list keys on a name and the order list on an instant, so replaying
 * one on the other compares a name against a `timestamptz` and Postgres raises
 * instead of matching nothing. Carrying the sort turns that into the answer a
 * hand-edited cursor already gets — the first page.
 *
 * A timestamp is carried as **the database's own text rendering**, never as a
 * `Date`. `created_at` is `timestamptz`, which keeps microseconds; JavaScript's
 * `Date` keeps milliseconds. A cursor built by `toISOString()` therefore names
 * an instant no row holds, so `= cursor` never matches and the id tiebreak
 * never fires — and every row inside the boundary millisecond matches neither
 * branch of the predicate and is silently unreachable at any page. That is not
 * hypothetical: rows written in one transaction share `now()` to the
 * microsecond, which is exactly the case the tiebreak exists for.
 */

/** How many rows a paged list returns at once. The orders screen's own. */
export const PAGE_SIZE = 25;

/**
 * How the leading column is compared, which decides what a decoder may accept.
 *
 * A `timestamptz` comparand is validated, because Postgres raises on a
 * malformed one rather than matching no rows. A `text` comparand is not: every
 * string is a legal one, the empty string and one containing the separator
 * included.
 */
export type SortShape = "timestamptz" | "text";

export type Sort = {
  /** Rides in the cursor. Carries no `|`, which is the separator. */
  readonly id: string;
  readonly leading: SortShape;
};

/**
 * Every sort a cursor can be produced by.
 *
 * One object rather than one constant per repository, so two lists cannot end
 * up sharing an identity — which is the whole property the identity buys. The
 * direction is part of a sort's meaning and so part of its name: the orders
 * screen runs newest first and the two queues run oldest first, and a cursor
 * carried between them would page through the wrong end of the list.
 */
export const SORTS = {
  ordersNewest: { id: "orders-newest", leading: "timestamptz" },
  usersByName: { id: "users-by-name", leading: "text" },
  disputesOldest: { id: "disputes-oldest", leading: "timestamptz" },
  reportsOldest: { id: "reports-oldest", leading: "timestamptz" },
} as const satisfies Record<string, Sort>;

/** The composite sort key of one row: the leading column, then the tiebreak. */
export type CursorKey = {
  /** The leading sort column, as the database rendered it. */
  value: string;
  id: string;
};

/** Neither a uuid nor a rendered instant contains one, which is why it is this. */
const SEPARATOR = "|";

export function encodeCursor(sort: Sort, key: CursorKey): string {
  return `${sort.id}${SEPARATOR}${key.value}${SEPARATOR}${key.id}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres renders `timestamptz` as `2026-09-18 19:19:00.123456+00`. */
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/**
 * The sort key a cursor names, or nothing when it does not name one for `sort`.
 *
 * Split at the **first** separator and at the **last**, so everything between
 * them is the leading value however many separators it contains: the account
 * list is ordered by a person's name, and "Smith | Sons" is a name somebody
 * has. Neither end can absorb it — a sort id is ours and a uuid has no pipe.
 *
 * Both outer halves are checked rather than merely non-empty, because they are
 * compared against real columns. Anything that fails a check falls back to the
 * first page rather than to the error boundary.
 */
export function decodeCursor(sort: Sort, cursor: string): CursorKey | undefined {
  const first = cursor.indexOf(SEPARATOR);
  const last = cursor.lastIndexOf(SEPARATOR);
  if (first < 0 || last <= first) return undefined;

  if (cursor.slice(0, first) !== sort.id) return undefined;

  const id = cursor.slice(last + 1);
  if (!UUID.test(id)) return undefined;

  const value = cursor.slice(first + 1, last);
  if (sort.leading === "timestamptz" && !PG_TIMESTAMP.test(value)) return undefined;

  return { value, id };
}
