import Link from "next/link";
import { GlassCard, ListRow, ListStack, StatusBadge } from "@occasion/ui";
import type { DisputeDetail } from "@occasion/core";
import { formatMoment } from "../../../../../lib/format-moment";
import { toneFor } from "./state-tone";
import { AddNoteForm, AssignControls, ResolveForm, StartReviewButton } from "./dispute-actions";

/**
 * One case file.
 *
 * The complaint, the booking behind it, what has been said internally, and the
 * decisions still available. A closed case shows the outcome and no forms: the
 * lifecycle has no way back, and a form that would be refused is worse than no
 * form at all.
 */
export function DisputeDetailPanel({ detail, meId }: { detail: DisputeDetail; meId: string }) {
  const { dispute, notes, orderInIssue } = detail;

  return (
    <div className="grid gap-5">
      <section className="grid gap-2" aria-label="The complaint">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={toneFor(dispute.state)}>{dispute.stateLabel}</StatusBadge>
          {dispute.resolutionLabel ? (
            <StatusBadge tone="neutral">{dispute.resolutionLabel}</StatusBadge>
          ) : null}
          <span className="text-sm opacity-70">Opened {formatMoment(dispute.createdAt)}</span>
        </div>

        <h3 className="m-0 text-lg font-semibold">{dispute.reason}</h3>
        {dispute.detail ? <p className="m-0 text-sm opacity-80">{dispute.detail}</p> : null}
      </section>

      <GlassCard as="section" aria-label="The booking">
        <ListStack>
          <ListRow
            title={
              <Link href={`/admin/orders?order=${dispute.orderId}`}>{dispute.orderReference}</Link>
            }
            subtitle={`${dispute.vendorName} · ${dispute.customerName}`}
            trailing={
              orderInIssue ? (
                <StatusBadge tone="danger">Held on this case</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">{dispute.orderState.replaceAll("_", " ")}</StatusBadge>
              )
            }
          />
        </ListStack>
      </GlassCard>

      {dispute.open ? (
        <section className="grid gap-3" aria-label="Who is dealing with it">
          <AssignControls
            disputeId={dispute.id}
            meId={meId}
            assignedToMe={dispute.assignedToUserId === meId}
            assignedToName={dispute.assignedToName}
          />
          {dispute.state === "open" ? <StartReviewButton disputeId={dispute.id} /> : null}
        </section>
      ) : null}

      <section className="grid gap-3" aria-label="Internal notes">
        <h4 className="m-0 text-sm font-semibold uppercase tracking-[0.06em] opacity-70">
          Internal notes
        </h4>

        {notes.length === 0 ? (
          <p className="m-0 text-sm opacity-70">Nothing written yet.</p>
        ) : (
          <ListStack>
            {notes.map((note) => (
              <ListRow
                key={note.id}
                title={note.body}
                subtitle={`${note.authorName ?? "an account since removed"} · ${formatMoment(note.createdAt)}`}
              />
            ))}
          </ListStack>
        )}

        {dispute.open ? <AddNoteForm disputeId={dispute.id} /> : null}
      </section>

      {dispute.open ? (
        <GlassCard as="section" aria-label="Close the case">
          <ResolveForm
            disputeId={dispute.id}
            orderInIssue={orderInIssue}
            orderReference={dispute.orderReference}
          />
        </GlassCard>
      ) : (
        <GlassCard as="section" aria-label="How it was resolved">
          <p className="m-0 text-sm">
            {dispute.resolutionNote ?? "Closed with no note, which should not happen."}
          </p>
          {dispute.resolvedAt ? (
            <p className="mt-2 mb-0 text-sm opacity-70">
              Closed {formatMoment(dispute.resolvedAt)}
            </p>
          ) : null}
        </GlassCard>
      )}
    </div>
  );
}
