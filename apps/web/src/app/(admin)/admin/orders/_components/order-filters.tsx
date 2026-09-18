"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button, FilterBar, FilterChip, Input, Select } from "@occasion/ui";

/**
 * Narrowing the list.
 *
 * All of it is an addition: the prototype draws `a_orders` as six fixed rows
 * with no filters, no search and no pagination (lines 1796–1827). Recorded in
 * `docs/design-gaps.md`. A real list needs narrowing, and an administrator
 * answering a question already knows one of four things — the state, where the
 * money got to, which business, or roughly when.
 *
 * Every choice lives in the query string rather than in client state, so the
 * page re-renders on the server with the filter applied, a filtered view has a
 * link somebody can send, and the back button does what it looks like it does.
 */

export type Choice = { value: string; label: string };

export type FilterValues = {
  state: string;
  payment: string;
  vendorId: string;
  from: string;
  to: string;
  search: string;
};

export function OrderFilters({
  values,
  states,
  payments,
  vendors,
}: {
  values: FilterValues;
  /**
   * Built on the server. A client component importing a runtime value from the
   * `@occasion/core` barrel risks pulling the domain — and the table names in
   * it — into a browser chunk; passing the list as props costs nothing.
   */
  states: readonly Choice[];
  payments: readonly Choice[];
  vendors: readonly Choice[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  function go(next: URLSearchParams) {
    // The open record and the page cursor both go: a drawer left open over a
    // list that has just been refiltered may be showing an order no longer in
    // it, and page 3 of the old filter is not page 3 of the new one.
    next.delete("order");
    next.delete("cursor");
    const query = next.toString();
    router.push(query ? `/admin/orders?${query}` : "/admin/orders");
  }

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    go(next);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams(params.toString());

    for (const key of ["q", "from", "to"]) {
      const typed = form.get(key);
      const trimmed = typeof typed === "string" ? typed.trim() : "";
      if (trimmed) next.set(key, trimmed);
      else next.delete(key);
    }

    go(next);
  }

  return (
    <div className="grid gap-4">
      <FilterBar aria-label="Filter orders by state">
        {states.map((chip) => (
          <FilterChip
            key={chip.value}
            active={values.state === chip.value}
            onSelect={() => set("state", chip.value)}
          >
            {chip.label}
          </FilterChip>
        ))}
      </FilterBar>

      {/* One form for the three typed fields, so a date range is applied as a
          range rather than reloading the page halfway through entering it. The
          two selects apply on change, because a select has no half-entered
          state to lose. */}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3" role="search">
        <Select
          id="order-payment"
          label="Payment"
          value={values.payment}
          onChange={(event) => set("payment", event.currentTarget.value)}
          options={payments}
          className="w-48"
        />

        <Select
          id="order-vendor"
          label="Vendor"
          value={values.vendorId}
          onChange={(event) => set("vendorId", event.currentTarget.value)}
          options={vendors}
          className="w-56"
        />

        {/* Uncontrolled and keyed on the value in the URL: the URL is the source
            of truth, so a remount is what makes a field follow a chip that
            cleared it, rather than an effect racing the keystrokes. */}
        <Input
          key={`from-${values.from}`}
          id="order-from"
          name="from"
          type="date"
          label="Placed from"
          defaultValue={values.from}
          className="w-44"
        />

        <Input
          key={`to-${values.to}`}
          id="order-to"
          name="to"
          type="date"
          label="to"
          defaultValue={values.to}
          className="w-44"
        />

        <Input
          key={`q-${values.search}`}
          id="order-search"
          name="q"
          type="search"
          label="Search"
          placeholder="Order, vendor, event or customer"
          defaultValue={values.search}
          className="w-64"
        />

        <Button type="submit" intent="ghost">
          Apply
        </Button>
      </form>
    </div>
  );
}
