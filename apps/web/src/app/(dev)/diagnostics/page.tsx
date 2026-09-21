import { AppBackground, GlassPanel, PageHeader } from "@occasion/ui";
import { createRequestContext } from "../../../lib/core";

/**
 * The wiring, as a page.
 *
 * It exists to prove the wiring is real rather than to be product UI: it builds
 * a core context the way every server action does, so a broken environment
 * schema, a broken adapter wiring or a broken package boundary shows up
 * immediately.
 *
 * It began at `/` and moved here when Explore took that path. Its purpose did
 * not change with the address, and neither did the two things that matter
 * about it: the route is **unauthenticated**, and the diagnostic table is
 * **withheld on the production tier**. Commission rates and "a reseed path
 * exists" are not things to tell a visitor who has not identified themselves.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Diagnostics · Occasion" };

export default function Diagnostics() {
  const ctx = createRequestContext();
  const showDiagnostics = ctx.config.appTier !== "production";

  const rows: Array<[string, string]> = [
    ["APP_TIER", ctx.config.appTier],
    ["Clock override allowed", String(ctx.config.allowClockOverride)],
    ["Destructive seed allowed", String(ctx.config.allowDestructiveSeed)],
    ["Stripe mode", ctx.stripe.mode()],
    ["Commission", `${(ctx.config.commissionBps / 100).toFixed(2)}%`],
    ["HST", `${(ctx.config.hstBps / 100).toFixed(2)}%`],
    ["Currency", ctx.config.currency],
    ["Clock now", ctx.clock.now().toISOString()],
  ];

  return (
    <AppBackground>
      <main className="mx-auto max-w-xl px-4 py-16">
        <PageHeader
          title="Occasion"
          blurb={
            showDiagnostics
              ? "Monorepo foundation. The values below come from a core context built the same way every server action builds one."
              : undefined
          }
        />

        {showDiagnostics ? (
          <GlassPanel className="p-6">
            <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 text-row">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-body">{label}</dt>
                  <dd className="m-0 font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          </GlassPanel>
        ) : null}
      </main>
    </AppBackground>
  );
}
