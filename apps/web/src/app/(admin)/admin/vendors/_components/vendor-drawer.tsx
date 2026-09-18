"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Sheet } from "@occasion/ui";

/**
 * The shell the vendor record is shown in.
 *
 * Which vendor is open lives in the query string, which is why this component
 * holds no data: the page server-renders the record and passes it in. That
 * costs a navigation to open the drawer and buys three things — the record is
 * a link somebody can send, it is rendered by the same gate as the page, and
 * nothing here has to fetch.
 *
 * Closing removes the parameter rather than hiding the element, so the URL and
 * what is on screen cannot disagree.
 */
export function VendorDrawer({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("vendor");
    const query = next.toString();
    // `scroll: false` so closing the record does not throw the list back to the
    // top, away from the row that was just being worked on.
    router.push(query ? `/admin/vendors?${query}` : "/admin/vendors", { scroll: false });
  }

  return (
    <Sheet open onClose={close} title={title} side="right">
      {children}
    </Sheet>
  );
}
