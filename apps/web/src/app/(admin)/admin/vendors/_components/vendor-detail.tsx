import { Avatar, StatusBadge } from "@occasion/ui";
import type { VendorDetail } from "@occasion/core";
import { AllActions } from "./status-action-button";
import { toneFor } from "./status-tone";

/**
 * One vendor's whole record.
 *
 * An addition beyond the prototype, which has no vendor detail view at all —
 * recorded in `docs/design-gaps.md`. It exists because every decision the queue
 * offers is one somebody has to be able to justify, and a row carrying a name
 * and a category is not enough to justify suspending a business.
 *
 * Server-rendered and handed to the drawer, so nothing here fetches and the
 * same gate that protects the page protects this.
 */

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Toronto",
});

function when(value: Date | null): string {
  return value ? dateFormat.format(value) : "—";
}

function money(cents: bigint, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    Number(cents) / 100,
  );
}

/** The reason recorded on an audit row, when the decision needed one. */
function reasonOf(after: unknown): string | null {
  if (typeof after !== "object" || after === null) return null;
  const reason = (after as { reason?: unknown }).reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

export function VendorDetailPanel({ detail }: { detail: VendorDetail }) {
  const { vendor, stripe, hst, suspension, onboarding, members, heldTransfers, heldJobs, history } =
    detail;

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={toneFor(vendor.status)}>
            <span className="capitalize">{vendor.status}</span>
          </StatusBadge>
          <span className="text-row text-body">{vendor.detail}</span>
        </div>

        {suspension.reason ? (
          <p className="m-0 text-[14px] text-ink">
            Suspended {when(suspension.at)} — {suspension.reason}
          </p>
        ) : null}

        <AllActions vendorId={vendor.id} vendorName={vendor.name} status={vendor.status} />
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Onboarding</h3>
        <ul className="m-0 grid list-none gap-2 p-0">
          {onboarding.map((step) => (
            <li key={step.id} className="flex items-baseline gap-3 text-[14px]">
              {/* The tick is decorative; the state is in the words beside it,
                  so a screen reader does not have to interpret a symbol. */}
              <span aria-hidden="true">{step.done ? "✓" : "○"}</span>
              <span className="min-w-0 flex-1">
                <span className="font-bold">{step.label}</span>
                <span className="block text-row text-body">
                  {step.done ? step.detail : `Not done — ${step.detail}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Payments</h3>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
          <dt className="text-body">Connected account</dt>
          <dd className="m-0">{stripe.accountId ?? "None"}</dd>
          <dt className="text-body">Mode</dt>
          <dd className="m-0">{stripe.mode}</dd>
          <dt className="text-body">Charges enabled</dt>
          <dd className="m-0">{when(stripe.chargesEnabledAt)}</dd>
          <dt className="text-body">Payouts enabled</dt>
          <dd className="m-0">{when(stripe.payoutsEnabledAt)}</dd>
          <dt className="text-body">HST</dt>
          <dd className="m-0">{hst.number ?? "Not registered"}</dd>
        </dl>
        {/* The connected account's state is a mirror, not a live read, and it
            has no timestamp of its own — `updated_at` moves every time somebody
            approves or suspends the vendor, so it cannot be used to date the
            mirror without saying something false. This says what is true until
            the refresh-on-open lands. */}
        <p className="mt-2 mb-0 text-row text-body">
          Last written by onboarding. Not refreshed from the provider on open.
        </p>
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">People ({members.length})</h3>
        {members.length === 0 ? (
          <p className="m-0 text-[14px] text-body">
            Nobody is attached to this business yet, so suspending it signs nobody out.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3">
                <Avatar name={member.fullName} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold">{member.fullName}</span>
                  <span className="block text-row text-body">
                    {member.email} · {member.memberRole} · {member.userStatus}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">Held payouts</h3>
        {heldTransfers.length === 0 && heldJobs.length === 0 ? (
          <p className="m-0 text-[14px] text-body">Nothing is being held.</p>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0 text-[14px]">
            {heldTransfers.map((transfer) => (
              <li key={transfer.id}>
                <span className="font-bold">{money(transfer.amount, transfer.currency)}</span>{" "}
                {transfer.orderReference} · {transfer.kind.replace("_", " ")}
                <span className="block text-row text-body">{transfer.heldReason}</span>
              </li>
            ))}
            {heldJobs.map((job) => (
              <li key={job.id}>
                <span className="font-bold">Scheduled {job.type.replaceAll("_", " ")}</span> · due{" "}
                {when(job.runAfter)}
                <span className="block text-row text-body">{job.heldReason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="m-0 mb-2 text-[15px] font-bold">History</h3>
        {history.length === 0 ? (
          <p className="m-0 text-[14px] text-body">
            Nothing has changed since this record was made.
          </p>
        ) : (
          <ol className="m-0 grid list-none gap-2 p-0 text-[14px]">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="font-bold">{entry.action.replace("vendor.", "")}</span>{" "}
                <span className="text-body">
                  {/* The role is recorded as well as the person: once someone
                      can hold more than one, "who did this" is not answerable
                      by the account alone. */}
                  by {entry.actorEmail ?? "a removed account"}
                  {entry.actingRole ? ` as ${entry.actingRole}` : ""}
                </span>
                {/* The reason a decision was taken is only ever stored here.
                    `vendors.suspended_reason` holds the current suspension and
                    is cleared on the way out of one, so a block's reason — and
                    every earlier suspension's — would otherwise be collected,
                    promised to the next administrator, and never shown. */}
                {reasonOf(entry.after) ? (
                  <span className="block text-[14px] text-ink">{reasonOf(entry.after)}</span>
                ) : null}
                <span className="block text-row text-body">{when(entry.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
