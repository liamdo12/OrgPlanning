# CLAUDE.md

Agent context for the Occasion monorepo. Read this before changing code.

## What this is

Toronto event-services marketplace. pnpm + Turborepo, one deployable Next.js
app (`apps/web`) whose business logic lives in framework-free packages.

The plan of record is
`plans/260915-2246-occasion-monorepo-admin-first/plan.md`. It is red-teamed and
validated. Do not re-litigate a decision recorded there without new evidence —
the rationale is in the plan, and reversing one silently is how this repo
drifts. Reference plan decisions in the plan and in commit discussion, not in
code comments: a comment should explain the invariant directly, so it still
makes sense to someone who never reads the plan.

## Commands

```bash
pnpm install
pnpm dev              # packages in watch mode + Next dev server
pnpm build            # packages, then a standalone Next build
pnpm lint             # includes the boundary rules below
pnpm typecheck
pnpm test
pnpm db:start         # local Supabase (API 54321, db 54322, Studio 54323, mail 54324)

pnpm --filter @occasion/db db:reset     # drop, migrate, seed
pnpm --filter @occasion/db db:migrate   # apply pending migrations
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  pnpm --filter @occasion/db test       # suites that need a real database
```

Run the narrowest thing first (`pnpm --filter @occasion/core test`), then widen
when a shared contract changed.

Configuration lives in `.env.local`. Turborepo runs in strict environment mode,
so a variable exported in your shell does not reach the task.

## Layout

| Package           | Rule                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | UI, server actions, route handlers. Validates raw env in `src/lib/env.ts`; only `instrumentation.ts` and build configs are exempt from `no-process-env`. |
| `packages/core`   | Domain. No `next/*`, no `react`, no `@occasion/ui`, no `apps/*`, no `process` global, no `node:process`.                                                 |
| `packages/db`     | Drizzle schema, migrations, seed. Takes its connection string as an argument; same no-framework, no-process rules.                                       |
| `packages/ui`     | Presentation only. No `@occasion/core`, no `@occasion/db`. Data arrives as props.                                                                        |
| `packages/config` | tsconfig / eslint / tailwind / prettier presets.                                                                                                         |

ESLint enforces these over `src/**/*.{ts,tsx,mts,cts,js,mjs,cjs}` — the glob is
wide on purpose, since a rule that stops applying to `.tsx` would not survive
the first email template. `packages/core/src/boundaries.test.ts` asserts core's
rules actually fire, so deleting one fails `pnpm test`.

## Non-negotiables

**Context, never globals.** Every domain function takes `(ctx: CoreContext, ...)`
or comes from a factory bound to one. No module-level singletons in
`packages/core`. `apps/web` builds the context per request via
`createRequestContext()` / `withCore()`. Never import `@occasion/core/testing`
into application code — its fakes permit the clock override and report every
caller as anonymous.

**`APP_TIER`, not `NODE_ENV`.** The deployed demo is a production build that must
still demo the clock; a production tier must refuse the same build's override.
`production` + `ALLOW_CLOCK_OVERRIDE=true` fails at boot, in both the zod schema
and `createCoreContext()`, and the returned config is frozen so it cannot be
re-enabled afterwards.

**Authorization has two layers.** Every admin **server action and route
handler** calls `requireAdminActor()` from `apps/web/src/lib/auth-guard.ts` as
its first statement. A layout is NOT a security boundary — Next.js does not run
it for server actions or route handlers, and does not re-run it on client-side
navigation — so `(admin)/layout.tsx` is a UX redirect only.

Every function that accepts an entity id takes the actor as its first argument
and calls a policy from `packages/core/src/identity/policies.ts` before
returning data — a role check alone lets one vendor read another's order.
Policies throw `NotFoundError`, not `ForbiddenError`, so a refusal does not
confirm the row exists, and each one also refuses an account that is not
active.

**Authority is held, never active.** `actor.roles` decides; `actor.activeRole`
is presentation and audit provenance only. Never gate on `activeRole`.

**Revocation is a timestamp.** Suspension, role grant and role revoke all move
`users.sessions_valid_after`; `getActor` rejects tokens issued before it, and
rejects a token with no issue time at all rather than skipping the check. If you
add a way to change what someone may do, move that column too.

**The provider subject is not our primary key.** `getActor` resolves
`auth_provider_sub` → `users.id`, binding the two on first sign-in only when the
provider reports a verified address. Never query `users.id` with a token `sub`.

**Money.** `bigint` cents, CAD. Commission on the pre-tax subtotal; HST follows
the vendor as supplier, so an HST-registered vendor's tax reaches them. Rates
are integer basis points. Never a float. The split is implemented in
`packages/db/src/seed/money.ts`, with three reconciliation identities asserted
over the seeded orders. The canonical version belongs with the ordering
service; delete the seed copy rather than let the two drift once it exists.

**The database denies by default.** RLS is on for every table with no policies;
`app_rw` is exempt and the service layer is the authorization boundary. Never
add a policy to "fix" a query returning nothing — check the role first.

**Seed data is deterministic and anchor-relative.** Ids come from
`seedId(name)`; instants are offsets from `seed_meta.anchor_at`. Never write a
literal date into the seed, and never assert one in a test.

**Time.** Do not call `Date.now()` or `new Date()` in the domain — use
`ctx.clock.now()`, with `ctx.clock.realNow()` for audit timestamps. This is a
convention, not yet a lint rule. Under a clock override the job runner may touch
demo-flagged rows only.

**Stripe is test mode.** The env schema refuses anything but `sk_test_*`. Live
mode is gated on a review this plan excludes.

**Emailed URLs carry opaque single-use tokens**, never domain ids.

**Prototype parity needs a citation.** Any "matches the prototype" claim cites a
line in `design/Event Marketplace Glass.dc.html`. Divergences go in
`docs/design-gaps.md`. See `design/README.md`.

## Writing code here

- Follow the local patterns before inventing one. KISS, DRY.
- Real behaviour only. An unimplemented adapter method calls `notImplemented()`
  and throws — it does not return a plausible fake.
- Keep public contracts stable unless the change is the point, and say so.
- Comments explain the invariant, not the plan. No plan IDs, phase numbers or
  finding codes in code comments, migration names, test names or commit
  messages.
- Conventional commits, no AI references.
- Never commit secrets, `.env` files, tokens or keys.
- Back up before any schema or data change.

## Phase status

The plan's phase files carry their own `status`; treat those as authoritative
rather than duplicating them here. Work the phases in the plan's build order —
it is sequential for a solo build, and the orders-and-payments domain sits on
the critical path ahead of the cheap screens.

## Known carry-overs from the foundation

- `apps/web/src/lib/core.ts` holds the connection pool in a module-level `let`
  and nothing closes it. Harmless while no query is issued; before the schema
  lands it needs a dev-mode `globalThis` cache (module scope re-evaluates on
  every hot reload, opening another pool each time) and a SIGTERM handler.
- The Edge runtime never runs `instrumentation.ts`, so anything deployed there
  would skip environment validation entirely.
