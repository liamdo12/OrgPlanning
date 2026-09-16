# @occasion/db

PostgreSQL schema, migrations, seed and test harness.

This package is a library: it takes a connection string as an argument and
never reads the environment. The CLI wrappers in `scripts/` are the one place
where a shell's variables become that argument.

## Commands

Run from the repo root, or with `--filter @occasion/db`:

```bash
pnpm db:start                    # local Postgres (repo root)
pnpm --filter @occasion/db db:migrate     # apply pending migrations
pnpm --filter @occasion/db db:seed        # upsert reference + demo data
pnpm --filter @occasion/db db:seed-demo   # demo rows only
pnpm --filter @occasion/db db:reset       # drop, migrate, seed
pnpm --filter @occasion/db db:generate    # regenerate SQL from the schema
```

`db:reset` and `db:seed-demo` refuse to run when `APP_TIER=production`; both
delete rows. `db:seed` upserts and has no tier guard, so it is the one to reach
for when you only want the reference data refreshed.

## Layout

```
src/schema/      Drizzle tables, grouped by concern
src/seed/        deterministic, anchor-relative demo data
src/migrate.ts   applies migrations/*.sql in filename order
src/reset.ts     reset() and reseedDemo()
migrations/      0000 generated from the schema, 0001 hand-written
scripts/         CLI wrappers — the only readers of the environment
test/            suites that need a real database
```

## Roles and row-level security

Row-level security is enabled on **every** table with **zero** policies, which
denies everything by default. Authorization lives in the service layer, so the
application role is exempt from RLS.

| Role                    | What it is                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `app_owner`             | Owns the schema. `NOLOGIN`. Migrations run as this role.                                          |
| `app_rw`                | What the application connects as. `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `app`, plus `BYPASSRLS`. |
| `anon`, `authenticated` | Zero grants. Nothing is reachable from a browser-side connection.                                 |

The combination is deliberate. A connection that somehow reaches the database
from the browser sees nothing at all, while the server-side service layer stays
the single place where access decisions are made — which is also what the
eventual move off this host needs, since there is no provider-specific policy
language to port.

**`BYPASSRLS` needs superuser to grant, and not every managed Postgres allows
it.** Where it is refused, the migration **fails** with a hint rather than
continuing: an application role that is neither `BYPASSRLS` nor a member of
`app_owner` reads zero rows from every table, and that surfaces as "every admin
screen is empty" with no error anywhere.

The remedy the hint names is `GRANT app_owner TO app_rw` before migrating,
which exempts `app_rw` by ownership. That also hands the application role DDL
over the schema, which is a real trade-off — so it is an explicit operator
decision, not something a migration does quietly on your behalf. Verified on a
non-superuser Postgres with `BYPASSRLS` unavailable: the migration refuses, and
after the grant it completes and `app_rw` reads normally.

`test/rls.test.ts` enumerates `pg_tables` rather than a fixed list, so a future
migration that adds a table without a grant fails there. Note what it does
_not_ cover: CI provisions Postgres as superuser, so the suite always exercises
the `BYPASSRLS` branch. The non-superuser path is covered by the migration
failing loudly, not by a test.

## Conventions

**Money** is `bigint` cents with a `currency` column. Never a float: a
marketplace splitting every amount between customer, vendor and platform
accumulates rounding error until the books stop balancing.

The split, implemented in `src/seed/money.ts`:

```
subtotal        the vendor's charge, pre-tax
tax             HST on that supply — the VENDOR is the supplier, so it is
                theirs to remit; zero when they are not registered
total           what the customer pays  (subtotal + tax)
commission      the platform's cut, on the PRE-TAX subtotal
commissionTax   HST on the platform's own service to the vendor
```

A vendor's payout is `subtotal + tax - commission - commissionTax`. Both sides
reconcile to the customer's total whether or not the vendor is registered.
`test/seed.test.ts` asserts three identities over the seeded orders —
`subtotal + tax = total`, `deposit + balance = total`, and vendor transfers plus
the platform cut equalling the total for settled orders.

**Time** is `timestamptz` everywhere. Events additionally carry a `timezone`
and store their date and start time apart, because an event happens at 5pm
local — collapsing it to one instant would move the party if the timezone rules
changed.

**Ranges** are half-open, `[start, end)`, so a booking that ends when the next
begins is not an overlap.

## The seed

Two properties it is built around:

**Deterministic.** Every id comes from `seedId(name)` — a UUID v5 over a fixed
namespace. Reseeding produces the same ids, so fixtures, E2E specs and a
bookmarked admin URL all survive a reset.

**Anchor-relative.** Every instant is an offset from `seed_meta.anchor_at`,
which is the clock's "now" at seed time. The prototype's four demo clock states
are offsets — "now", "+48h", "event−14d", "event+72h" — so literal dates would
leave the demo describing a past that never changes. Reseeding a year from now
still produces the same four states.

Every seeded row cites a line number in
`design/Event Marketplace Glass.dc.html`. Where the seed departs from the
prototype, `docs/design-gaps.md` says why.

## Testing

Suites that need a database read `TEST_DATABASE_URL` and **skip** when it is
unset, so `pnpm test` still passes on a machine with no Postgres. CI sets it,
which is where the guarantee actually lives.

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  pnpm --filter @occasion/db test
```

They run sequentially (`vitest.config.ts`): every suite rebuilds the same
database, and in parallel they would race on dropping the schema.
