"use server";

import { revalidatePath } from "next/cache";
import {
  AgreementMismatchError,
  CapacityConflictError,
  NotFoundError,
  ValidationError,
  chargeDeposit,
  createCheckout,
  eventHub,
  extendCheckoutWindow,
  formatMoney,
  listOrdersForCustomer,
} from "@occasion/core";
import { requireCustomerActor } from "../../../lib/auth-guard";
import { createRequestContext } from "../../../lib/core";
import { formatCalendarDay, formatDay } from "../../../lib/format-moment";
import { linesForVendor } from "./plan-lines";

/**
 * Taking the deposit.
 *
 * `requireCustomerActor()` first, because an action is reachable by a direct
 * POST that renders no layout. The domain then checks again — `createCheckout`
 * runs the event's own policy — so an id for somebody else's event is refused
 * there whatever this screen did.
 *
 * **Nothing about the cart comes from the client.** The request names an event
 * and a business; the lines are read back out of the event's own plan, the
 * prices out of the catalogue. The one thing the browser does send is the
 * figures it displayed, and those can only cause a refusal: if the transaction
 * would charge anything else, it aborts and the customer is asked again.
 *
 * It returns rather than redirects. The browser still has to confirm the card
 * with the provider, and a redirect here would leave that undone.
 */

/** The four figures the screen displayed, as the browser holds them. */
export type StatedTerms = {
  /** Cents, as a decimal string: a `bigint` does not survive a form. */
  totalCents: string;
  depositCents: string;
  balanceCents: string;
  /** ISO 8601, or null when the whole amount is taken now. */
  balanceDueAt: string | null;
};

/** The same four, formatted, for a screen that has to show them again. */
export type DisplayedTerms = StatedTerms & {
  total: string;
  deposit: string;
  balance: string | null;
  balanceDate: string | null;
};

export type CheckoutStart =
  | {
      ok: true;
      orderId: string;
      /** Null when the deposit had already settled — nothing left to confirm. */
      clientSecret: string | null;
    }
  | {
      ok: false;
      /**
       * `terms` means the price moved and the customer has to agree again;
       * `conflict` means the date is held; `refused` is anything the domain
       * turned down with a sentence of its own.
       */
      kind: "terms" | "conflict" | "refused";
      message: string;
      /** On `terms`, what the booking now costs. */
      terms?: DisplayedTerms;
      /** On `conflict`, the customer's own unfinished booking, if that is why. */
      openOrder?: { id: string; reference: string };
    };

export async function startCheckoutAction(input: {
  eventId: string;
  vendorId: string;
  stated: StatedTerms;
}): Promise<CheckoutStart> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();

  const eventId = input.eventId.trim();
  const vendorId = input.vendorId.trim();

  try {
    // Read here rather than trusted from the form: this is the list of things
    // the customer planned, and it is the only source of what they are buying.
    const hub = await eventHub(ctx, actor, eventId);
    const lines = linesForVendor(hub.items, vendorId);

    if (lines.length === 0) {
      return {
        ok: false,
        kind: "refused",
        message: "There is nothing left to check out for this business.",
      };
    }

    const checkout = await createCheckout(ctx, actor, {
      eventId,
      lines,
      expectation: readTerms(input.stated),
    });

    const order = checkout.orders[0];
    if (!order) {
      return { ok: false, kind: "refused", message: "That booking could not be opened." };
    }

    const deposit = await chargeDeposit(ctx, actor, order.id);

    // The thirty-minute expiry was queued when the order opened. Pushed out now
    // that a card is actually being entered, so a slow challenge does not end
    // with a charge landing against a booking the runner has already released.
    // It only ever moves later, and a job already claimed is left alone.
    await extendCheckoutWindow(ctx, actor, order.id);

    // The slot reads `Booked` from the order that now exists, and the budget
    // counts it as spent rather than committed.
    revalidatePath("/events");

    return { ok: true, orderId: order.id, clientSecret: deposit.clientSecret };
  } catch (error) {
    if (error instanceof AgreementMismatchError) {
      return {
        ok: false,
        kind: "terms",
        message:
          "The price of this booking changed while you were reading it. Nothing has been charged. Here are the new terms.",
        terms: displayTerms(error.terms, REFUSAL_CURRENCY),
      };
    }

    if (error instanceof CapacityConflictError) {
      return conflict(ctx, actor, eventId, vendorId, error);
    }

    if (error instanceof ValidationError) {
      return { ok: false, kind: "refused", message: error.message };
    }

    if (error instanceof NotFoundError) {
      return {
        ok: false,
        kind: "refused",
        message: "That booking is no longer available. Nothing has been charged.",
      };
    }

    throw error;
  }
}

/**
 * Why the date is taken, which is sometimes the customer themselves.
 *
 * The exclusion constraint is on the service and the day and does not know
 * whose order holds it, so a customer who started a checkout and then **changed
 * the cart** meets their own hold: the new item set does not match the open
 * order, so nothing is resumed, and the date it is already holding refuses the
 * second one. Naming that is the difference between "your date is gone" and
 * "you are already halfway through booking it".
 */
async function conflict(
  ctx: ReturnType<typeof createRequestContext>,
  actor: Awaited<ReturnType<typeof requireCustomerActor>>,
  eventId: string,
  vendorId: string,
  error: CapacityConflictError,
): Promise<CheckoutStart> {
  const day = formatCalendarDay(error.day);

  const open = (await listOrdersForCustomer(ctx, actor, { eventId })).find(
    (row) => row.vendorId === vendorId && row.state === "pending_payment",
  );

  if (open) {
    return {
      ok: false,
      kind: "conflict",
      message: `You already have booking ${open.reference} with this business open for ${day}, and it is holding the date. Finish paying for it, or put the plan back the way it was and try again — an unpaid booking releases its date after thirty minutes.`,
      openOrder: { id: open.id, reference: open.reference },
    };
  }

  return {
    ok: false,
    kind: "conflict",
    message: `${day} has just been booked with this business. Nothing has been charged. Another date, or another vendor, is the way round it.`,
  };
}

/**
 * What the refused terms are spelled in.
 *
 * Every other figure on this screen carries the currency its quote was priced
 * in. This one path has no quote to read it from — the refusal carries amounts
 * and nothing else — and it is not taken from the browser, because the label on
 * an amount of money is not a thing a client gets to choose. One currency is
 * sold in, the domain refuses a cart that mixes two, and the day that changes
 * this needs the currency on the refusal rather than a different constant.
 */
const REFUSAL_CURRENCY = "CAD";

/** Cents off the wire, refused rather than coerced when they are not cents. */
function readTerms(stated: StatedTerms): {
  total: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  balanceDueAt: Date | null;
} {
  return {
    total: cents(stated.totalCents, "total"),
    depositAmount: cents(stated.depositCents, "deposit"),
    balanceAmount: cents(stated.balanceCents, "balance"),
    balanceDueAt: instant(stated.balanceDueAt),
  };
}

function cents(value: string, field: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new ValidationError("That amount is not a number of cents.", { [field]: "invalid" });
  }
  return BigInt(value);
}

function instant(value: string | null): Date | null {
  if (value === null || value === "") return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new ValidationError("That is not a date.", { balanceDueAt: "invalid" });
  }
  return parsed;
}

/** The new terms, formatted once on the server for a screen to repeat. */
function displayTerms(
  terms: {
    total: bigint;
    depositAmount: bigint;
    balanceAmount: bigint;
    balanceDueAt: Date | null;
  },
  currency: string,
): DisplayedTerms {
  return {
    totalCents: terms.total.toString(),
    depositCents: terms.depositAmount.toString(),
    balanceCents: terms.balanceAmount.toString(),
    balanceDueAt: terms.balanceDueAt?.toISOString() ?? null,
    total: formatMoney(terms.total, currency),
    deposit: formatMoney(terms.depositAmount, currency),
    balance: terms.balanceAmount > 0n ? formatMoney(terms.balanceAmount, currency) : null,
    balanceDate: terms.balanceDueAt ? formatDay(terms.balanceDueAt) : null,
  };
}
