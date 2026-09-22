import { Button } from "@occasion/ui";
import { formatMoney, type EventPayments } from "@occasion/core";

/**
 * What has been taken and what is coming, lines 923–931.
 *
 * **Every figure is read, never derived here.** The deposits are the payments
 * that actually settled; the next charge and its date are columns on the order,
 * written inside the checkout's own transaction. No lead-day offset appears in
 * this file, and nothing on this screen asks the payment provider anything —
 * the panel is a render over what the planner already loaded, so a provider
 * timeout cannot take the hub down with it.
 *
 * **No card-on-file line.** The prototype draws "•••• 4242" (line 927) and
 * there is no column behind it: the schema states out loud that no card data
 * is stored anywhere in it. The two ways to draw that line today are a live
 * provider call per order on a screen that makes one domain call, or four
 * digits typed in — a fake. It arrives with the column.
 */

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "America/Toronto",
});

export function PaymentsPanel({
  payments,
  currency,
  inPlan,
}: {
  payments: EventPayments;
  currency: string;
  /** How many slots are chosen and not yet bought. */
  inPlan: number;
}) {
  return (
    <section className="rounded-panel bg-role p-5 text-surface" aria-labelledby="payments-heading">
      <h3 id="payments-heading" className="m-0 mb-[14px] text-subhead">
        Payments
      </h3>

      {/*
        A description list, not a run of paragraphs with two spans each: read
        aloud, the prototype's markup is three labels followed by three numbers
        with nothing joining them.
      */}
      <dl className="m-0 mb-4">
        <Line label="Deposits paid" value={formatMoney(payments.captured, currency)} />

        {payments.nextChargeAt === null ? (
          <Line label="Next charge" value="Nothing scheduled" />
        ) : payments.nextChargeStatus === "attention" ? (
          // Nothing is queued in this state: the charge already ran and was
          // declined. Printing its date under "Next charge" would promise a
          // charge that is not coming and leave somebody waiting for it.
          <Line
            label="Payment needed"
            value={formatMoney(payments.nextCharge, currency)}
            note="A card payment for this booking did not go through. We have emailed a link to settle it."
          />
        ) : (
          <Line
            label={`Next charge · ${dayFormat.format(payments.nextChargeAt)}`}
            value={formatMoney(payments.nextCharge, currency)}
          />
        )}
      </dl>

      {/*
        The prototype promises an email thirty days ahead so the card can be
        updated (line 928). Nothing sends one: the confirmation names the date
        when the booking is made, and the next message is the receipt for the
        charge or the notice that it failed. So this says what really happens.
      */}
      {payments.nextChargeStatus === "scheduled" ? (
        <p className="m-0 mb-4 text-[13px] text-pretty text-on-role-muted">
          Balances are charged automatically to the card the deposit was taken on, on the date above
          — the date the booking confirmation named. We email you when it goes through, and straight
          away if it does not.
        </p>
      ) : null}

      {inPlan > 0 ? (
        // `primary`, even though the prototype draws this one light on the
        // green (line 930): every other variant is *faded* when disabled, and
        // a faded label on this fill is well under the contrast floor. The
        // primary variant is the one with a vetted disabled colour pair.
        <Button
          intent="primary"
          disabled
          title="Checkout arrives with the payment screens."
          className="w-full justify-center rounded-card"
        >
          Check out {inPlan} {inPlan === 1 ? "item" : "items"} in plan
        </Button>
      ) : null}
    </section>
  );
}

function Line({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="mb-[7px] flex flex-wrap justify-between gap-2 text-[14px]">
      <dt className="text-on-role-muted">{label}</dt>
      <dd className="m-0 font-bold">{value}</dd>
      {note ? (
        <dd className="m-0 basis-full text-[13px] text-pretty text-on-role-muted">{note}</dd>
      ) : null}
    </div>
  );
}
