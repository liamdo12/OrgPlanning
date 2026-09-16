import { createRequestContext } from "../lib/core";

/**
 * Foundation landing page.
 *
 * It exists to prove the wiring is real rather than to be product UI: it builds
 * a core context the way every server action will, so a broken environment
 * schema, a broken adapter wiring or a broken package boundary shows up
 * immediately. The admin shell replaces it.
 *
 * The diagnostic table is withheld on the production tier. Commission rates and
 * "a reseed path exists" are not things an anonymous visitor should be told,
 * and this route is unauthenticated.
 */
export const dynamic = "force-dynamic";

export default function Home() {
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
    <main className="mx-auto max-w-xl p-10 font-sans">
      <h1 className="text-2xl font-semibold">Occasion</h1>
      {showDiagnostics ? (
        <>
          <p className="mt-2 text-sm opacity-70">
            Monorepo foundation. The values below come from a core context built the same way every
            server action builds one.
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="opacity-70">{label}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
    </main>
  );
}
