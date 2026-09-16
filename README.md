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
cp .env.example .env.local     # then fill in the values

pnpm db:start                  # local Supabase; prints the keys for .env.local
pnpm dev                       # http://localhost:3000
```

Local Supabase ports: API `54321`, database `54322`, Studio `54323`, Inbucket
(email testing) `54324`.

Configuration goes in `.env.local`, which Next loads itself. Exporting a
variable in your shell will **not** reach the app: Turborepo runs tasks in
strict environment mode and filters anything a task has not declared.

## Commands

| Command                        | What it does                                              |
| ------------------------------ | --------------------------------------------------------- |
| `pnpm dev`                     | Runs every package in watch mode plus the Next dev server |
| `pnpm build`                   | Builds the packages, then a standalone Next build         |
| `pnpm lint`                    | ESLint across the workspace, including the boundary rules |
| `pnpm typecheck`               | `tsc --noEmit` per package                                |
| `pnpm test`                    | Vitest per package                                        |
| `pnpm format` / `format:check` | Prettier                                                  |
| `pnpm db:start` / `db:stop`    | Local Supabase stack                                      |

## Layout

```
apps/web/          Next.js App Router — UI, server actions, route handlers
packages/core/     domain logic; framework-free, env-free
packages/db/       Drizzle schema, migrations, seed
packages/ui/       glass design system
packages/config/   tsconfig / eslint / tailwind / prettier presets
design/            exported design canvas — read-only reference
docs/              design-gaps.md (architecture and runbook land with later work)
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
  Two files are exempt from the rule because they legitimately need the raw
  value: `instrumentation.ts` (reads `NEXT_RUNTIME` to skip the Edge runtime)
  and the build configs. Nothing else in the app may touch `process.env`.
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
