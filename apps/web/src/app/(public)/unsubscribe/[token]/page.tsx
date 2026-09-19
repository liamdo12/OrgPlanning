import { GlassPanel } from "@occasion/ui";
import { UnsubscribeForm } from "./_components/unsubscribe-form";

/** Rendered per request, and never cached: it is about one person's consent. */
export const dynamic = "force-dynamic";

export const metadata = { title: "Unsubscribe · Occasion" };

/**
 * Where an unsubscribe link lands.
 *
 * Two things this page is careful about, and both are the reason it is a page
 * with a button rather than a link that acts on its own:
 *
 * **A GET must not withdraw consent.** Mail clients, spam filters and link
 * scanners fetch the URLs in a message before anybody reads it. A link that
 * unsubscribed on GET would unsubscribe people who never clicked it, and the
 * first evidence would be a marketing list quietly emptying.
 *
 * **It says the same thing whether or not the token is real.** Confirming that
 * a token exists confirms that a particular address was mailed; the form posts
 * either way and the answer afterwards is identical.
 *
 * No sign-in, by design. Anti-spam law requires unsubscribing to work in a
 * couple of clicks, and somebody who no longer wants to hear from the platform
 * is exactly the person least willing to create an account to say so. The
 * token is the authority: it was mailed to one address and nothing else.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="mx-auto grid max-w-[46rem] gap-4 p-6">
      <GlassPanel as="section" className="p-6">
        <h1 className="m-0 mb-2 font-serif text-[clamp(24px,4vw,34px)] font-normal">
          Stop receiving marketing email?
        </h1>
        <p className="m-0 mb-5 max-w-[60ch] text-pretty text-body">
          This stops announcements and offers. Messages about bookings you have made — a
          confirmation, a payment, a cancellation — are part of the booking and keep coming.
        </p>

        <UnsubscribeForm token={token} />
      </GlassPanel>
    </main>
  );
}
