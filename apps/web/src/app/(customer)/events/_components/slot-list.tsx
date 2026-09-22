import Link from "next/link";
import { Button, ListRow, ListStack, StatusBadge, Swatch, cx, type StatusTone } from "@occasion/ui";
import type { PlanItem } from "@occasion/core";
import { removeFromPlanAction } from "../actions";

/**
 * The six category slots, lines 898–914.
 *
 * Built from `ListRow` with a `Swatch` in front and a badge plus two buttons
 * behind — the shape six admin lists already compose. Nothing new enters the
 * shared kit for this screen: a slot row is that row with different contents,
 * and promoting it would be a second answer to a documented shape.
 *
 * **Five presentations, four badge tones.** `Empty` takes the existing neutral
 * pair and is told apart by its actions and a faded category tile rather than
 * by a fifth tone — a tone is a colour pair in the shared stylesheet, and adding one for
 * one screen is what the four exist to prevent. The danger tone on a quote
 * count is not a failure: it is a countdown, and it is the only thing on this
 * screen that says decide now.
 *
 * **Six of the eight actions have nowhere to go yet.** Four belong to the
 * comparison and messaging screens, which are a later plan; checkout and a
 * booking's own screen arrive with the payment screens and the orders list.
 * Each is a disabled control with the reason on it, never a link: a row action
 * that leads to a 404 is worse than one that says it is not ready, and hiding
 * them would misrepresent what the product does — the quote slot is real data
 * a customer can see and would reasonably expect to act on.
 */

const PLAN_B = "Comparing and messaging vendors is planned, and is not built yet.";
const CHECKOUT_SOON = "Checkout arrives with the payment screens.";
const ORDER_SOON = "A booking's own screen arrives with your orders list.";

export function SlotList({ eventId, items }: { eventId: string; items: readonly PlanItem[] }) {
  return (
    <ListStack as="ul" className="mb-[26px] list-none p-0">
      {items.map((item) => (
        <li key={item.id}>
          <Slot eventId={eventId} item={item} />
        </li>
      ))}
    </ListStack>
  );
}

function Slot({ eventId, item }: { eventId: string; item: PlanItem }) {
  const empty = item.state.kind === "empty";

  return (
    <ListRow
      // **The muting is on the tile alone**, which is decorative and
      // `aria-hidden`, and nowhere near a colour pair somebody has to read.
      // Fading the whole row was the obvious reading of "muted" and axe caught
      // it at both widths: opacity composites through every child, so the row's
      // own primary action — a vetted pair on the role fill — dropped under the
      // contrast floor. The same trap the disabled-button tokens exist for.
      leading={
        <Swatch
          name={item.categoryName}
          size={42}
          className={cx(empty && "opacity-50")}
          {...(item.categoryTone ? { tone: item.categoryTone } : {})}
        />
      }
      title={item.categoryName}
      subtitle={detail(item)}
      trailing={
        <>
          <StatusBadge tone={tone(item.state.kind)}>{label(item)}</StatusBadge>
          {actions(eventId, item)}
        </>
      }
    />
  );
}

function tone(kind: PlanItem["state"]["kind"]): StatusTone {
  switch (kind) {
    case "booked":
      return "success";
    case "quotes":
      return "danger";
    case "in_plan":
    case "empty":
      return "neutral";
  }
}

function label(item: PlanItem): string {
  switch (item.state.kind) {
    case "booked":
      return "Booked";
    case "quotes":
      return `${item.state.count} ${item.state.count === 1 ? "quote" : "quotes"}`;
    case "in_plan":
      return "In plan";
    case "empty":
      return "Empty";
  }
}

/** What the row says under the category name. Facts only, in the row's order. */
function detail(item: PlanItem): string {
  if (item.state.kind === "empty") return "Nothing added yet";

  const parts = [
    item.vendorName,
    item.servicePackageName ?? item.serviceName,
    item.quantity > 1 ? `× ${item.quantity}` : null,
    item.arrivalTime ? `arrives ${item.arrivalTime.slice(0, 5)}` : null,
    item.orderReference,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : "Awaiting quotes";
}

function actions(eventId: string, item: PlanItem) {
  switch (item.state.kind) {
    case "booked":
      return (
        <>
          <Deferred label="Message" reason={PLAN_B} />
          <Deferred label="View order" reason={ORDER_SOON} intent="primary" />
        </>
      );

    case "quotes":
      return (
        <>
          <Deferred label="Message" reason={PLAN_B} />
          <Deferred label="Compare" reason={PLAN_B} intent="primary" />
        </>
      );

    case "in_plan":
      return (
        <>
          <form action={removeFromPlanAction}>
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="categoryId" value={item.categoryId} />
            <Button type="submit" intent="ghost" size="sm">
              Remove
            </Button>
          </form>
          <Deferred label="Check out" reason={CHECKOUT_SOON} intent="primary" />
        </>
      );

    case "empty":
      return (
        <>
          <Deferred label="Get quotes" reason={PLAN_B} />
          <Link
            href={`/services?category=${encodeURIComponent(item.categorySlug)}`}
            className="oc-button oc-button--primary oc-button--sm"
          >
            Find {item.categoryName.toLowerCase()}
          </Link>
        </>
      );
  }
}

/** A control the screen shows but cannot yet perform, with the reason on it. */
function Deferred({
  label: text,
  reason,
  intent = "ghost",
}: {
  label: string;
  reason: string;
  intent?: "ghost" | "primary";
}) {
  return (
    <Button intent={intent} size="sm" disabled title={reason}>
      {text}
    </Button>
  );
}

/** Exported for the panel, which counts the same slots the rows draw. */
export function inPlanCount(items: readonly PlanItem[]): number {
  return items.filter((item) => item.state.kind === "in_plan").length;
}

/** The categories a vendor is booked into, in the order the planner lists them. */
export function bookedCategories(items: readonly PlanItem[]): string[] {
  return items.filter((item) => item.state.kind === "booked").map((item) => item.categoryName);
}
