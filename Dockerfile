# Multi-stage build producing a Next.js standalone image.
#
# Standalone + plain Node is the portability contract (D2): this same image runs
# on ECS/Fargate or a plain VM with no Vercel-proprietary runtime.

# ---------- deps ----------
FROM node:22.14.0-alpine AS deps
RUN corepack enable
WORKDIR /repo

# Only the manifests, so a source-only change does not reinstall the world.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY packages/config/package.json ./packages/config/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/ui/package.json ./packages/ui/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ---------- build ----------
FROM node:22.14.0-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY --from=deps /repo ./
COPY . .

# Builds the workspace packages first, then the app (turbo honours ^build).
RUN pnpm build

# ---------- runtime ----------
FROM node:22.14.0-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never run the server as root.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# `output: "standalone"` emits a self-contained server plus a minimal
# node_modules; static assets are copied alongside it.
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

# APP_TIER and the rest of the environment are supplied at run time and
# validated at boot by instrumentation.ts — a bad config never serves traffic.
CMD ["node", "apps/web/server.js"]
