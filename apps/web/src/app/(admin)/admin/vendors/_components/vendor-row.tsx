import Link from "next/link";
import { StatusBadge, Swatch } from "@occasion/ui";
import type { AdminVendorRow } from "@occasion/core";
import { RowAction } from "./status-action-button";
import { toneFor } from "./status-tone";

/**
 * One business in the queue.
 *
 * Line 1645: a tinted square, a two-line identity that takes the remaining
 * width, a status badge and one contextual button, wrapping on a narrow screen.
 * The rows sit flush inside a single panel with hairline separators rather than
 * being separate cards — that is the vendor list specifically; the user list
 * next door uses cards (line 1675).
 */

export function VendorRow({ vendor, query }: { vendor: AdminVendorRow; query: string }) {
  const href = query
    ? `/admin/vendors?${query}&vendor=${vendor.id}`
    : `/admin/vendors?vendor=${vendor.id}`;

  return (
    <li className="flex flex-wrap items-center gap-[14px] border-b border-hairline px-[18px] py-[13px] last:border-b-0">
      <Swatch name={vendor.name} />

      <span className="min-w-0 flex-[1_1_200px]">
        {/* The name is the link to the record: a row-wide click target would
            swallow the button beside it, and a separate "open" link would be a
            control the prototype does not have. */}
        <Link href={href} scroll={false} className="block text-[14.5px] font-bold">
          {vendor.name}
        </Link>
        <span className="block text-row text-body">{vendor.detail}</span>
      </span>

      <StatusBadge tone={toneFor(vendor.status)}>
        <span className="capitalize">{vendor.status}</span>
      </StatusBadge>

      <RowAction vendorId={vendor.id} vendorName={vendor.name} status={vendor.status} />
    </li>
  );
}
