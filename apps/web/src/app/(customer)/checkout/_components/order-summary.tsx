import { PriceLockup, type PriceRow } from "@occasion/ui";

/**
 * The sticky order summary, lines 1166–1187.
 *
 * `PriceLockup` with its `group`, which is the component's own name for the
 * canvas's washed sub-panel at line 1176 — the deposit and the balance sit in
 * it while the subtotal, tax and total sit above. Nothing new enters the shared
 * kit: the booking card draws the same five rows without the panel, and a
 * second component would be a second answer to one shape.
 *
 * **Every amount arrives formatted.** This file multiplies nothing, applies no
 * rate and builds no currency string; the figures come from `quoteCheckout`,
 * which runs the checkout's own pricing.
 */
export function OrderSummary({
  subtotal,
  tax,
  total,
  taxLabel,
  depositLabel,
  deposit,
  balanceLabel,
  balance,
  fullPaymentNote,
  children,
}: {
  subtotal: string;
  tax: string;
  total: string;
  /** "HST 13%", built from the rate the quote was priced at. */
  taxLabel: string;
  /** "Deposit today (20%)" — the listing's own rate, never recomputed. */
  depositLabel: string;
  deposit: string;
  /** Absent when the whole amount is taken now. */
  balanceLabel: string | null;
  balance: string | null;
  /** Why the whole amount is taken now, when it is. */
  fullPaymentNote: string | null;
  /** The Pay button and whatever it has to say for itself. */
  children: React.ReactNode;
}) {
  const rows: PriceRow[] = [
    { label: "Subtotal", value: subtotal },
    { label: taxLabel, value: tax },
    { label: "Total", value: total, emphasis: "total" },
  ];

  const group: PriceRow[] = [
    {
      label: depositLabel,
      value: deposit,
      emphasis: "role",
      ...(fullPaymentNote ? { note: fullPaymentNote } : {}),
    },
    // Not drawn at all when there is none: "Balance on —" beside a zero is what
    // a customer reads as a mistake.
    ...(balanceLabel && balance ? [{ label: balanceLabel, value: balance }] : []),
  ];

  return (
    <aside
      className="oc-glass sticky top-[118px] rounded-overlay border border-glass-edge-soft p-[20px]"
      aria-labelledby="summary-heading"
    >
      <h2 id="summary-heading" className="m-0 mb-[14px] text-subhead">
        Order summary
      </h2>

      <PriceLockup rows={rows} group={group} />

      {children}

      <p className="mt-[11px] mb-0 text-center text-[12.5px] text-pretty text-body">
        A copy of this agreement is emailed to you immediately, as required in Ontario.
      </p>
    </aside>
  );
}
