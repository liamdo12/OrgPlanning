import { notFound } from "next/navigation";
import { GlassPanel } from "@occasion/ui";
import { AppError, openPaymentLink, parsePaymentLinkToken } from "@occasion/core";
import { createRequestContext } from "../../../../lib/core";
import { PayForm } from "./_components/pay-form";

/**
 * The one public page in this milestone: paying a balance that was declined.
 *
 * It is deliberate and minimal, and it is the only way the failed-balance
 * recovery path can work at all. The person whose card was declined off-session
 * has to be able to finish the payment, and requiring them to sign in first
 * would mean the one page they need is behind the one thing they may not have.
 *
 * The token in the URL is the whole authority. It is opaque, single-use and
 * expiring, and it is looked up by hash — the plaintext exists in their email
 * and nowhere else. No order id appears anywhere on this route, because
 * `/pay/4192` is a URL somebody can walk to every other booking.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Pay your balance · Occasion" };

const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const ctx = createRequestContext();

  let link;
  try {
    // Every reason a token is not payable — unknown, expired, already used, or
    // an order that has moved on — answers with the same 404. Saying "expired"
    // instead would confirm that the token was once real, and a token that was
    // once real names an order.
    link = await openPaymentLink(ctx, parsePaymentLinkToken(raw));
  } catch (error) {
    if (error instanceof AppError) notFound();
    throw error;
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-4 py-10">
      <GlassPanel className="w-full p-6 sm:p-8">
        <p className="text-sm text-white/60">Booking {link.reference}</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">Pay your balance</h1>
        <p className="mt-3 text-sm text-white/70">
          The card on file could not be charged, so the balance is still outstanding. Paying it here
          keeps the booking.
        </p>

        <dl className="mt-6 space-y-2 border-t border-white/10 pt-4 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="text-white/60">Balance due</dt>
            <dd className="text-lg font-semibold text-white">
              {money.format(Number(link.amount) / 100)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-white/60">Link expires</dt>
            <dd className="text-white/80">
              <time dateTime={link.expiresAt.toISOString()}>{expiry(link.expiresAt)}</time>
            </dd>
          </div>
        </dl>

        <PayForm token={raw} />

        <p className="mt-4 text-xs text-white/50">
          This link works once. If you have already paid, nothing further is needed.
        </p>
      </GlassPanel>
    </main>
  );
}

const when = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});

function expiry(at: Date): string {
  return when.format(at);
}
