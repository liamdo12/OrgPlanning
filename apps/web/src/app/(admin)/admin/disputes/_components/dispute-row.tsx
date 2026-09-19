import Link from "next/link";
import { ListRow, StatusBadge } from "@occasion/ui";
import type { DisputeSummary } from "@occasion/core";
import { toneFor } from "./state-tone";

/**
 * One complaint in the queue.
 *
 * The row carries what an administrator needs to decide whether to open it:
 * what the complaint is, which booking it is about, who is on both sides, and
 * whether anybody has picked it up. All of it comes off the list query rather
 * than a lookup per row.
 *
 * A link rather than a click handler, because the case opens as a query
 * parameter and a link is what a person can middle-click, share and go back
 * from.
 */
export function DisputeRow({ dispute, query }: { dispute: DisputeSummary; query: string }) {
  const href = `/admin/disputes?${new URLSearchParams(query).toString()}${query ? "&" : ""}case=${dispute.id}`;

  const detail = [
    `${dispute.orderReference} · ${dispute.vendorName}`,
    dispute.customerName,
    dispute.assignedToName ?? "unassigned",
    dispute.noteCount === 1 ? "1 note" : `${dispute.noteCount} notes`,
  ].join(" · ");

  return (
    <li className="border-b border-[color:var(--color-hairline)] last:border-b-0">
      <Link href={href} className="block no-underline" aria-label={`Open ${dispute.reason}`}>
        <ListRow
          title={dispute.reason}
          subtitle={detail}
          trailing={<StatusBadge tone={toneFor(dispute.state)}>{dispute.stateLabel}</StatusBadge>}
        />
      </Link>
    </li>
  );
}
