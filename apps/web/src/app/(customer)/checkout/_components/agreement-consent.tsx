"use client";

/**
 * The agreement, line 1161.
 *
 * A real checkbox with a real label, not a styled `div`: it keeps Space, it
 * keeps its state in the accessibility tree, and a screen reader reads the
 * sentence it is agreeing to as the control's name. That sentence is the whole
 * point of the control — the amount and the date are in it, because "I agree to
 * the terms" agrees to nothing a person can remember afterwards.
 *
 * The figures arrive already formatted. A client component may not import the
 * domain, and there is one money formatter in this repository.
 */
export function AgreementConsent({
  consented,
  onChange,
  disabled,
  balanceAmount,
  balanceDate,
  depositAmount,
}: {
  consented: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  /** Absent when the whole amount is taken now, and the sentence says so. */
  balanceAmount: string | null;
  balanceDate: string | null;
  depositAmount: string;
}) {
  return (
    <label
      htmlFor="agreement"
      className="mt-[16px] flex cursor-pointer items-start gap-[11px] text-[13.5px] text-pretty text-body"
    >
      <input
        id="agreement"
        type="checkbox"
        className="oc-check mt-[1px] flex-none"
        checked={consented}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        I agree to the vendor&rsquo;s cancellation policy and the terms of service, and I authorize{" "}
        {balanceAmount && balanceDate ? (
          <>
            the balance of <Figure>{balanceAmount}</Figure> to be charged to this card on{" "}
            <Figure>{balanceDate}</Figure>.
          </>
        ) : (
          <>
            <Figure>{depositAmount}</Figure> to be charged to this card now. There is no balance to
            come.
          </>
        )}
      </span>
    </label>
  );
}

/** The part of the sentence somebody will be asked about later. */
function Figure({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold text-ink">{children}</strong>;
}
