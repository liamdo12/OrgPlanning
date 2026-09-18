"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Sheet } from "@occasion/ui";

/**
 * The shell the order record is shown in.
 *
 * Which order is open lives in the query string, which is why this component
 * holds no data: the page server-renders the record and passes it in. That
 * costs a navigation to open the drawer and buys three things — the record is a
 * link somebody can send, it is rendered by the same gate as the list, and
 * nothing here has to fetch. It matters more here than on the account list: an
 * order record shows payment intents and transfer ids, and none of that should
 * be reachable by a component that fetches on its own.
 *
 * Closing removes the parameter rather than hiding the element, so the URL and
 * what is on screen cannot disagree.
 */
export function OrderDrawer({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("order");
    const query = next.toString();
    // `scroll: false` so closing the record does not throw the list back to the
    // top, away from the row that was just being worked on.
    router.push(query ? `/admin/orders?${query}` : "/admin/orders", { scroll: false });
  }

  return (
    <Sheet open onClose={close} title={title} side="right">
      {children}
    </Sheet>
  );
}
