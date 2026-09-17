import { z } from "zod";

/**
 * The one place in the repo that reads raw environment variables.
 *
 * ESLint's `no-process-env` is on everywhere else, and `packages/core` /
 * `packages/db` additionally forbid the `process` global and the process module
 * outright. Everything downstream receives config through the core context.
 *
 * Validation is lazy and memoised rather than run at import (see `getEnv`).
 */

const booleanish = z
  .union([z.literal("true"), z.literal("false")])
  .transform((value) => value === "true");

/**
 * A value that has to be filled in, not copied.
 *
 * `.env.example` ships `replace-me` for the keys only the running stack can
 * supply. Left as they are, the string is long enough to satisfy `min(1)` and
 * reaches the provider, which answers "invalid JWT: token contains an invalid
 * number of segments" — true, unhelpful, and several steps from the cause.
 */
const configured = () =>
  z
    .string()
    .min(1)
    .refine((value) => value !== "replace-me", {
      message: "still the .env.example placeholder; `pnpm supabase status` prints the real value",
    });

const envSchema = z
  .object({
    /**
     * Which deployment this is. Separate from `NODE_ENV` because the deployed
     * demo is a production Next build that must still be able to demo the
     * clock, while a real production deployment of the same build must not.
     */
    APP_TIER: z.enum(["local", "demo", "production"]),

    /** Connection string for the least-privileged application role. */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: configured(),
    SUPABASE_SERVICE_ROLE_KEY: configured(),

    /** Test mode only for this milestone; enforced below. */
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),

    RESEND_API_KEY: z.string().min(1),

    /** Absolute origin used to build single-use tokenised links in emails. */
    APP_URL: z.url(),

    /** Shared secret the cron caller presents to the jobs tick endpoint. */
    JOBS_TICK_SECRET: z.string().min(16),

    /**
     * Whether Google sign-in is configured at the provider.
     *
     * The button is rendered only when this is true. A provider button that is
     * visible but unconfigured fails at the redirect, after the person has
     * already committed to it.
     */
    AUTH_GOOGLE_ENABLED: booleanish,

    /** Whether an admin may set a clock override at all. */
    ALLOW_CLOCK_OVERRIDE: booleanish,
    /** Whether the demo data may be torn down and reseeded. */
    ALLOW_DESTRUCTIVE_SEED: booleanish,
  })
  .superRefine((value, ctx) => {
    // A production deployment must not be able to move time or drop data,
    // whatever its variables happen to say.
    if (value.APP_TIER === "production") {
      if (value.ALLOW_CLOCK_OVERRIDE) {
        ctx.addIssue({
          code: "custom",
          path: ["ALLOW_CLOCK_OVERRIDE"],
          message: "must be false when APP_TIER=production",
        });
      }
      if (value.ALLOW_DESTRUCTIVE_SEED) {
        ctx.addIssue({
          code: "custom",
          path: ["ALLOW_DESTRUCTIVE_SEED"],
          message: "must be false when APP_TIER=production",
        });
      }
    }

    // Live payments are gated on an accountant and legal review that has not
    // happened; refusing the key here is what keeps that gate honest.
    if (!value.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
      ctx.addIssue({
        code: "custom",
        path: ["STRIPE_SECRET_KEY"],
        message: "must be a Stripe test-mode key (sk_test_…); live mode is out of scope",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Returns the validated environment, parsing it once per process.
 *
 * Lazy rather than at import time so that `next build` — which loads every
 * route module — does not require production secrets on the build machine.
 * `instrumentation.ts` calls this as the server starts, so a running Node
 * process still fails immediately and loudly rather than at the moment a job
 * tries to move money.
 *
 * The Edge runtime is the gap: `register()` skips it, and its `process.env` is
 * truncated. Nothing in this app runs on Edge; anything that ever does must
 * validate its own inputs rather than assume this ran.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
  }

  cached = parsed.data;
  return cached;
}
