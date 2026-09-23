import type { PlanItem } from "@occasion/core";

/**
 * What one business's part of a plan is, as a checkout request.
 *
 * **Derived from the event's own slots, never from the URL.** The checkout link
 * carries an event and a vendor and nothing else: a request that could name a
 * service or a quantity could name one that was never planned, or six of
 * something priced for one. Both screens that need this — the page that prices
 * the cart and the action that buys it — read it from the same place, so what
 * is charged is what was shown.
 *
 * Only slots that are chosen and not yet bought. A `booked` slot already has an
 * order, and putting it in a second cart would hold its date twice.
 */
export type PlannedLine = {
  serviceId: string;
  servicePackageId?: string | undefined;
  quantity: number;
};

export function linesForVendor(items: readonly PlanItem[], vendorId: string): PlannedLine[] {
  return items
    .filter((item) => item.state.kind === "in_plan" && item.vendorId === vendorId && item.serviceId)
    .map((item) => ({
      serviceId: item.serviceId as string,
      ...(item.servicePackageId ? { servicePackageId: item.servicePackageId } : {}),
      quantity: item.quantity,
    }));
}
