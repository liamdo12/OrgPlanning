# Occasion

Toronto event-services marketplace. A pnpm + Turborepo monorepo whose backend
lives in framework-independent domain packages, deployed as one Next.js app.

Implementation plan:
[`plans/260915-2246-occasion-monorepo-admin-first/plan.md`](plans/260915-2246-occasion-monorepo-admin-first/plan.md).
This milestone builds the **admin view** completely; customer and vendor views
are scoped in Phase 13 and built afterwards.

## Requirements

- Node 22.14.0 (`.nvmrc`)
- pnpm 10.30+ (`corepack enable`)
- Docker — for the local Supabase stack and the production image

## Getting started

```bash
corepack enable
pnpm install
cp .env.example apps/web/.env.local   # then fill in the values

pnpm db:start                  # local Supabase; prints the three SUPABASE_* values

# Migrations need a superuser: they grant BYPASSRLS, and Supabase's `postgres`
# role is not one. Locally that superuser is `supabase_admin`.
export ADMIN_DB_URL=postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres
DATABASE_URL=$ADMIN_DB_URL pnpm --filter @occasion/db db:reset   # schema + demo data

# The application connects as `app_rw`, which the migration creates NOLOGIN so
# that no password is ever committed. Give it one, once per stack:
docker exec supabase_db_occasion psql -U supabase_admin -d postgres \
  -c "ALTER ROLE app_rw LOGIN PASSWORD 'local-dev-only';"

# The seed writes app.planning_org_users rows; it cannot create logins at the auth
# provider, which lives outside the database. It gives every seeded account one — the
# administrator included — so you can actually sign in. It reads
# apps/web/.env.local, runs against built output, and touches demo rows only.
pnpm --filter @occasion/db build
SEED_USER_PASSWORD='choose-a-throwaway' pnpm --filter @occasion/web auth:provision

pnpm dev                       # http://localhost:3000, sign in as admin@occasion.test
```

The `@occasion/db` scripts take their connection string from the shell, not from
`apps/web/.env.local` — that file is Next's, and these run outside it.

Local Supabase ports: API `54321`, database `54322`, Studio `54323`, Inbucket
(email testing) `54324`.

Configuration goes in `apps/web/.env.local` — Next loads env files from the
directory it runs in, so a copy at the repository root is read by nothing. Exporting a
variable in your shell will **not** reach the app: Turborepo runs tasks in
strict environment mode and filters anything a task has not declared.

## Commands

| Command                                 | What it does                                              |
| --------------------------------------- | --------------------------------------------------------- |
| `pnpm dev`                              | Runs every package in watch mode plus the Next dev server |
| `pnpm build`                            | Builds the packages, then a standalone Next build         |
| `pnpm lint`                             | ESLint across the workspace, including the boundary rules |
| `pnpm typecheck`                        | `tsc --noEmit` per package                                |
| `pnpm test`                             | Vitest per package                                        |
| `pnpm format` / `format:check`          | Prettier                                                  |
| `pnpm db:start` / `db:stop`             | Local Supabase stack                                      |
| `--filter @occasion/db db:reset`        | Drop, migrate and seed the database                       |
| `--filter @occasion/db db:migrate`      | Apply pending migrations only                             |
| `--filter @occasion/web auth:provision` | Creates provider logins for the seeded accounts           |

## Layout

```
apps/web/          Next.js App Router — UI, server actions, route handlers
packages/core/     domain logic; framework-free, env-free
packages/db/       Drizzle schema, migrations, seed (see its README)
packages/ui/       glass design system
packages/config/   tsconfig / eslint / tailwind / prettier presets
design/            exported design canvas — read-only reference
docs/              design-gaps.md, payments-testing.md (architecture and runbook land with later work)
plans/             implementation plan and phase files
supabase/          local stack config
```

## Import rules (enforced by ESLint, checked in CI)

- `packages/core` may not import `next/*`, `react`, `@occasion/ui`, or anything
  from `apps/`. The domain stays portable, so extracting it to AWS later is a
  copy-out rather than a rewrite.
- `packages/ui` may not import `@occasion/core` or `@occasion/db`. Domain data
  arrives as props.
- `packages/core` and `packages/db` may not read `process.env`, touch the
  `process` global, or import the `node:process` module. Config is injected
  through `CoreContext`.
- `apps/web` validates raw environment variables in one file, `src/lib/env.ts`.
  The others are exempt because they legitimately need the raw value:
  `src/instrumentation.ts` (reads `NEXT_RUNTIME` to skip the Edge runtime),
  `src/proxy.ts` (it needs two variables before the app boots and must not fail
  a request when configuration is incomplete), and the build configs. Nothing
  else in the app may touch `process.env`. Operator scripts under `scripts/`
  are `.mjs`, which the rule's glob never covers.
- `apps/web` may not import `@occasion/core/testing`, which ships fakes.

`packages/core`'s own test suite asserts that _its_ rules actually fire — a
deleted rule fails `pnpm test`. The `packages/db` and `packages/ui` boundaries
are configured the same way but are not yet covered by tests of their own.

## The core context

Domain code never reaches for global state. `apps/web` builds a `CoreContext`
per request and threads it explicitly:

```ts
import { withCore } from "@/lib/core";

export const approveVendor = withCore(async (ctx, vendorId: string) => {
  // ctx.db, ctx.auth, ctx.stripe, ctx.email, ctx.clock, ctx.config
});
```

There are no module-level singletons in `packages/core`. That is what lets a
service be unit-tested with `createTestCoreContext()` from
`@occasion/core/testing` and no environment at all. That factory is deliberately
not exported from the package root, and `apps/web` is lint-blocked from
importing it — its fakes report every caller as anonymous and permit the clock
override, which is harmless in a test and a silent downgrade in a handler.

## Environment tiers

`APP_TIER` — **not** `NODE_ENV` — gates the demo-only capabilities. The deployed
demo runs a `NODE_ENV=production` standalone build and must still be able to
demo the clock, while a real production tier must refuse the same build's
override.

| Capability                                            | `local` | `demo`              | `production`               |
| ----------------------------------------------------- | ------- | ------------------- | -------------------------- |
| Clock override (preview)                              | ✅      | ✅                  | ❌                         |
| Job execution under override (demo-flagged rows only) | ✅      | ✅                  | ❌                         |
| Reseed demo data                                      | ✅      | ✅ (typed env name) | ❌                         |
| Live Stripe keys                                      | ❌      | ❌                  | out of scope for this plan |

A process configured as `production` with either flag on refuses to boot. That
check lives in two places on purpose — the zod schema in `apps/web/src/lib/env.ts`
and `createCoreContext()` in `packages/core` — so neither a bad deployment nor a
future caller constructing its own context can get past it.

## Money and time conventions

- Money is `bigint` **cents**, CAD. No floats anywhere near a price.
- Commission is charged on the **pre-tax subtotal**; HST follows the vendor as
  supplier, so the vendor's HST reaches the vendor.
- Rates are carried as integer **basis points** (`commissionBps`, `hstBps`).
- Nothing in the domain calls `Date.now()` or `new Date()`. Time comes from
  `ctx.clock`, so the seeded demo states are computable and the admin override
  can move them.

## The database

Every table lives in the `app` schema and is named `planning_org_*`. The schema
is what isolates them from the auth provider's own tables; the prefix is so a
table is recognisably ours in a client that lists every schema flat, and in a
log line where the schema is not shown. The one exception is `app.__migrations`,
the migration runner's own bookkeeping.

Row-level security is on for every table with no policies, so the default is
deny; the application connects as `app_rw`, which is exempt, and authorization
lives in the service layer. `anon` and `authenticated` have no grants at all.
`packages/db/README.md` covers the roles, the fallback when a managed Postgres
will not grant `BYPASSRLS`, and the money and time conventions.

The seed is deterministic and anchor-relative: every id comes from a stable
name, and every instant is an offset from `seed_meta.anchor_at`. That is what
keeps the demo's four clock states — "now", "+48h", "event−14d", "event+72h" —
meaningful however long after seeding you look at them.

Tests that need a database read `TEST_DATABASE_URL` and skip when it is unset,
so `pnpm test` passes without Postgres. CI always sets it. Locally it wants the
superuser URL, because the suites drop and rebuild the schema — and note that
running them leaves the database freshly seeded, not as you left it.

## Authorization

Two layers, and both are required:

1. **Role gate** — `requireAdmin(actor)` / `requireRole(actor, role)`. May this
   kind of actor use this entry point at all?
2. **Object policy** — `assertCanReadOrder(actor, order)` and friends in
   `packages/core/src/identity/policies.ts`. Is this actor a party to _this_
   row?

A role check alone lets any vendor read any other vendor's order by id, which
is why every domain function taking an entity id takes the actor first and
calls a policy before returning anything. Policies answer `NotFoundError`
rather than `ForbiddenError` — "you may not see order X" confirms that order X
exists.

Authority is **held, never active**: an admin browsing as a customer is still
an admin, and selecting a different role chip grants nothing. The active role
is presentation, and is recorded on every audit row.

Roles and account status are re-read from the database on every request that
asks for an actor — that is the rule for all new code, and today the admin gate
and the auth actions are the only callers, because no other route exists yet.
`users.sessions_valid_after` is moved forward by suspension, role grant and role
revocation, and a token issued before it (or carrying no issue time) is
rejected, so a revocation takes effect on the next request rather than whenever
the token would have expired.

The gate for server actions and route handlers is `requireAdminActor()` in
`apps/web/src/lib/auth-guard.ts`. `(admin)/layout.tsx` redirects for the sake of
the person browsing and is **not** the boundary: Next.js does not run a layout
for a server action.

## Signing in

Email and password, or Google where a deployment has configured it —
`AUTH_GOOGLE_ENABLED` hides the button otherwise, because a provider button that
is visible but unconfigured only fails after the person has committed to it. A
Google sign-in with no account here lands on `/welcome`, which asks the one
question the provider cannot answer: which of the two self-assignable roles they
came for.

Two-step verification is **offered, not required**. Nothing refuses an
administrator who has not enrolled — an accepted risk with compensating controls
recorded in the plan. Once someone does enrol, though, every later session has to
clear the challenge: verifying enrolment sets `users.mfa_enrolled_at`, and
`getActor` refuses a session that has not reached the second factor. The
requirement is read from that column rather than from the provider's session
object, because the session object arrives in a cookie the browser controls — a
stolen password plus an edited cookie must not be able to answer it away. Losing
an authenticator is therefore a lockout, and an administrator clears it from
`/admin`, which deletes the provider's factor as well as the flag.

The active role is a cookie. It decides what is shown and what an audit row
records; it is validated against the roles actually held and consulted by no
gate.

## Prototype parity

Any claim that something "matches the prototype" must cite a line number in
`design/Event Marketplace Glass.dc.html`. See
[`design/README.md`](design/README.md). Deliberate divergences are recorded in
`docs/design-gaps.md`.

## Deployment

`pnpm build` produces a Next standalone build; the root `Dockerfile` turns it
into an image that runs under plain Node as a non-root user. No
Vercel-proprietary runtime APIs are used, so the same image runs on ECS/Fargate
or a plain VM.

```bash
docker build -t occasion .
docker run --rm -p 3000:3000 --env-file .env.local occasion
```
