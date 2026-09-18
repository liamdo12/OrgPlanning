import { GlassPanel } from "@occasion/ui";

/**
 * Where Stripe returns the customer after a hosted payment.
 *
 * It deliberately confirms nothing about the order. Reaching this URL means the
 * customer finished on the provider's page, not that the money has settled and
 * certainly not that this platform knows about it — the webhook is what moves
 * the order, and it may arrive a moment after this page renders. Saying
 * "confirmed" here would be a claim made before the fact it describes.
 *
 * The token is still in the path and is deliberately not looked up: by now it
 * is either retired or about to be, and a lookup would only produce a 404 on
 * the page somebody sees after paying.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Payment received · Occasion" };

export default function PayDonePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-4 py-10">
      <GlassPanel className="w-full p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-white">Thank you</h1>
        <p className="mt-3 text-sm text-white/70">
          Your payment has been submitted. We will email you once it settles — usually within a
          minute or two — and your booking is confirmed at that point.
        </p>
        <p className="mt-4 text-xs text-white/50">
          You can close this page. The link you used has now been spent.
        </p>
      </GlassPanel>
    </main>
  );
}
