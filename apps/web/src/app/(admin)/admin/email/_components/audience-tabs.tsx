import Link from "next/link";
import type { Audience } from "@occasion/core";

/**
 * Customers · Vendors · Both (line 1703).
 *
 * Links rather than buttons, because the audience is in the URL: it decides
 * every count on the screen below, and those counts are resolved on the server
 * against live consent. A client-side toggle would leave the numbers describing
 * the audience that was open a moment ago.
 */
export function AudienceTabs({
  audiences,
  templateKey,
}: {
  audiences: readonly { key: Audience; label: string; selected: boolean }[];
  templateKey: string;
}) {
  return (
    <div className="mb-[18px]">
      <p className="m-0 mb-[9px] text-[12px] font-bold uppercase tracking-[0.07em] text-muted">
        Send to
      </p>
      <div className="flex flex-wrap gap-2">
        {audiences.map((audience) => (
          <Link
            key={audience.key}
            href={`/admin/email?audience=${audience.key}&template=${templateKey}`}
            aria-current={audience.selected ? "true" : undefined}
            className="oc-audience-tab"
            data-selected={audience.selected ? "true" : "false"}
          >
            {audience.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
