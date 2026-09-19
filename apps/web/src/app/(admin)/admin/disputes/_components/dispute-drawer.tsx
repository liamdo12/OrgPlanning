"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Sheet } from "@occasion/ui";

/**
 * The shell one case is shown in.
 *
 * Which case is open lives in the query string, which is why this component
 * holds no data: the page server-renders the file and passes it in. That costs
 * a navigation to open the record and buys three things — the case is a link
 * somebody can send, it is rendered by the same gate as the page, and nothing
 * here has to fetch.
 */
export function DisputeDrawer({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("case");
    const query = next.toString();
    // `scroll: false` so closing the case does not throw the queue back to the
    // top, away from the row that was just being worked on.
    router.push(query ? `/admin/disputes?${query}` : "/admin/disputes", { scroll: false });
  }

  return (
    <Sheet open onClose={close} title={title} side="right">
      {children}
    </Sheet>
  );
}
