import Link from "next/link";
import { EmptyState, ListStack, PageHeader } from "@occasion/ui";
import { listOrdersForCustomer } from "@occasion/core";
import { requireCustomerPage } from "../../../lib/auth-guard";
import { createRequestContext } from "../../../lib/core";
import { OrderRow } from "./_components/order-row";

export const metadata = { title: "Your orders · Occasion" };

/** Rendered per request: what it shows belongs to whoever is asking. */
export const dynamic = "force-dynamic";

/**
 * My orders, lines 1206–1221.
 *
 * **Only the caller's own.** The read is keyed on the signed-in user's id, so
 * there is no filter for somebody to forget and no id for anyone to substitute:
 * another customer's booking is not absent from this list because it was
 * excluded, it is absent because it was never in the query.
 */
export default async function OrdersPage() {
  const actor = await requireCustomerPage();
  const ctx = createRequestContext();

  const orders = await listOrdersForCustomer(ctx, actor);

  if (orders.length === 0) {
    return (
      <>
        <PageHeader title="Your orders" />

        <EmptyState
          title="No orders yet"
          blurb="Everything you book will be here, with what has been paid, what is scheduled and the terms it was booked under."
          action={
            <Link href="/services" className="oc-button oc-button--primary oc-button--md">
              Browse services
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Your orders" />

      <ListStack as="ul" className="list-none p-0">
        {orders.map((order) => (
          <li key={order.id}>
            <OrderRow order={order} />
          </li>
        ))}
      </ListStack>
    </>
  );
}
