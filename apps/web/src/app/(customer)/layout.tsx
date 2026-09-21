import type { ReactNode } from "react";
import { customerViewer } from "../../lib/auth-guard";
import { createRequestContext } from "../../lib/core";
import { resolveActiveEvent } from "../../lib/active-event";
import { CustomerShell } from "./_components/customer-shell";

/** Rendered per request: nothing it shows exists at build time. */
export const dynamic = "force-dynamic";

/**
 * Draws the shell, signed in or not. **This is not the security boundary.**
 *
 * Next.js does not re-run a layout on client-side navigation between its own
 * segments, a layout does not control whether nested segments render, and it
 * does not run at all for a server action or a route handler. Relying on this
 * to protect anything would leave every customer action open to a direct POST.
 *
 * The real gate is `requireCustomerActor()` in `src/lib/auth-guard.ts`, which
 * every customer action and route handler calls for itself, and
 * `requireCustomerPage()`, which every non-public page calls as its first
 * statement. `src/customer-authorization.test.ts` is what keeps that true.
 *
 * This layout does not gate at all, which is the one way it differs from the
 * admin group's: three of these screens are public. Explore, Results and
 * Service detail render for anybody — the prototype's own rule at line 2013 —
 * so a redirect here would refuse a visitor the product is trying to attract.
 * What it does instead is decide which shell to draw.
 */
export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const ctx = createRequestContext();

  // The signed-in chrome is drawn only for somebody the gate would let
  // through, and it asks the gate rather than re-deriving the rule: an
  // administrator is refused on these screens, so an account menu and an event
  // chip would be chrome for a surface they are about to be redirected off.
  const viewer = await customerViewer();

  const active = viewer ? await resolveActiveEvent(ctx, viewer) : undefined;

  return (
    <CustomerShell
      {...(viewer ? { email: viewer.email } : {})}
      // The switcher's options arrive with the event read that also fills in
      // `resolveActiveEvent`. Until then the chip offers the one thing that
      // works: somewhere to make an event.
      events={active ? [active] : []}
      activeEventId={active?.id}
      // From the domain clock, not the browser's, so the date picker moves with
      // a demo override instead of disagreeing with everything else on screen.
      today={ctx.clock.now().toISOString().slice(0, 10)}
    >
      {children}
    </CustomerShell>
  );
}
