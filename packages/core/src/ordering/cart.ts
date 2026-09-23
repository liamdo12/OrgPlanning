import * as catalog from "../catalog/repo.js";
import type { DbExecutor } from "../context.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { computeOrderMoney, type OrderMoney } from "../payments/money.js";
import { buildPaymentPlan, type PaymentPlan } from "../payments/plan.js";
import * as repo from "./repo.js";
import type { CheckoutLine, CheckoutRequest, OrderingPolicy } from "./service.js";

/**
 * What a cart costs, decided once for the quote and for the charge.
 *
 * A quote and a checkout have to produce the same numbers, and the only way to
 * guarantee that is for them to run the same code rather than the same
 * sequence. Two copies agreeing today is the arrangement that put the parity
 * test in `catalog-discovery.test.ts` — the test is real, but it can only
 * notice a divergence after somebody writes one.
 *
 * So this is the pricing, and both callers are thin around it. It reads the
 * catalogue, groups the cart by vendor, refuses a group that cannot be one
 * order, and builds the money and the payment plan. It **writes nothing, locks
 * nothing and holds no date** — those are the checkout's, and they are what the
 * checkout still does for itself.
 *
 * Deliberately **off the package barrel**: it is a pricing step, and
 * `money-path.test.ts` refuses a screen that can reach one. A page assembling
 * its own price from these parts is a second implementation of `createCheckout`
 * that agrees with itself and disagrees with the charge.
 */

/** One line of a cart, priced. The shape an order item is written from. */
export type PricedCartLine = {
  serviceId: string;
  servicePackageId: string | null;
  description: string;
  quantity: number;
  unitPrice: bigint;
  lineTotal: bigint;
  currency: string;
};

/** One vendor's share of the cart: what it contains and what it costs. */
export type PricedVendorCart = {
  vendorId: string;
  vendorName: string;
  lines: PricedCartLine[];
  /** The terms these lines are sold under, or nothing when they carry none. */
  template: repo.PolicyTerms | undefined;
  money: OrderMoney;
  plan: PaymentPlan;
  currency: string;
};

export type PriceCartInput = {
  /** The rates in force, read by the caller so a checkout reads them once. */
  pricing: { commissionBps: number; hstBps: number };
  /** The windows and floors in force, which a caller may state instead. */
  terms: OrderingPolicy;
  now: Date;
  eventStart: Date;
  timeZone: string;
};

/**
 * Prices a cart, one entry per vendor in it.
 *
 * The executor is an argument rather than the context, because the checkout
 * runs this inside its own transaction — after the event row is locked — and a
 * quote runs it on the pool. The rates come in as a value for the same reason:
 * every order in one cart must be priced at one reading of the settings table,
 * and a function that read them itself could not promise that.
 */
export async function priceCart(
  db: DbExecutor,
  request: CheckoutRequest,
  input: PriceCartInput,
): Promise<PricedVendorCart[]> {
  const priced = await catalog.priceServices(
    db,
    request.lines.map((line) => line.serviceId),
  );
  const packages = await catalog.pricePackages(
    db,
    request.lines
      .filter((line) => line.servicePackageId)
      .map((line) => ({
        serviceId: line.serviceId,
        servicePackageId: line.servicePackageId as string,
      })),
  );

  // Grouped by vendor, because an order belongs to one.
  const byVendor = new Map<string, Array<{ line: CheckoutLine; priced: catalog.PricedLine }>>();

  for (const line of request.lines) {
    const service = priced.get(line.serviceId);
    // The same answer for "no such service", "that vendor is not approved" and
    // "that listing is a draft": a catalogue read must not become the way to
    // discover any of the three.
    if (!service || !catalog.bookable(service)) {
      throw new NotFoundError("That service cannot be booked.");
    }

    let description = service.description;
    let unitPrice = service.unitPrice;

    if (line.servicePackageId) {
      const tier = packages.get(line.servicePackageId);
      if (!tier) throw new NotFoundError("That service cannot be booked.");
      description = `${service.description} · ${tier.name}`;
      unitPrice = tier.unitPrice;
    }

    const group = byVendor.get(service.vendorId) ?? [];
    group.push({ line, priced: { ...service, description, unitPrice } });
    byVendor.set(service.vendorId, group);
  }

  // The terms, read from the policy each service is sold under rather than
  // taken from the request. One query per distinct template rather than one per
  // line: a cart of six services under the same policy is six round trips
  // otherwise.
  const templates = new Map<string, repo.PolicyTerms>();
  for (const templateId of new Set(
    [...priced.values()].map((line) => line.policyTemplateId).filter((id) => id !== null),
  )) {
    const template = await repo.loadPolicyTemplate(db, templateId);
    if (template) templates.set(templateId, template);
  }

  const carts: PricedVendorCart[] = [];

  for (const [vendorId, group] of byVendor) {
    const lines: PricedCartLine[] = group.map(({ line, priced: priceLine }) => ({
      serviceId: priceLine.serviceId,
      servicePackageId: line.servicePackageId ?? null,
      description: priceLine.description,
      quantity: line.quantity,
      unitPrice: priceLine.unitPrice,
      lineTotal: priceLine.unitPrice * BigInt(line.quantity),
      currency: priceLine.currency,
    }));

    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0n);
    const first = group[0]?.priced as catalog.PricedLine;

    // Summing amounts in two currencies produces a number in neither. Nothing
    // in this milestone sells in anything but CAD, which is exactly why a check
    // is cheap now and a migration later.
    if (lines.some((line) => line.currency !== first.currency)) {
      throw new ValidationError("A booking cannot mix currencies.", { currency: "mixed" });
    }

    // An order carries one `policy_template_id`, so the lines under it have to
    // agree on the terms. Picking the first line's, or the cheapest, takes a
    // deposit on a cancellation policy the customer was never shown — and
    // records terms on the order that half its services were not sold under.
    if (group.some(({ priced: line }) => line.policyTemplateId !== first.policyTemplateId)) {
      throw new ValidationError("A booking cannot mix cancellation policies.", {
        policy: "mixed",
      });
    }

    // Absent is an ordinary answer: a service with no policy attached is sold
    // at the platform's own deposit rate, which is what that setting is for.
    const template = first.policyTemplateId ? templates.get(first.policyTemplateId) : undefined;

    const money = computeOrderMoney({
      subtotal,
      vendorHstRegistered: first.vendorHstRegistered,
      commissionBps: input.pricing.commissionBps,
      hstBps: input.pricing.hstBps,
    });

    const plan = buildPaymentPlan({
      total: money.total,
      now: input.now,
      eventStart: input.eventStart,
      depositBps: template?.depositBps ?? input.terms.defaultDepositBps,
      balanceLeadDays: input.terms.balanceLeadDays,
      coolingWindowHours: template?.freeCancellationHours ?? input.terms.coolingWindowHours,
      fullPaymentBelow: input.terms.fullPaymentBelow,
      timeZone: input.timeZone,
    });

    carts.push({
      vendorId,
      vendorName: first.vendorName,
      lines,
      template,
      money,
      plan,
      currency: first.currency,
    });
  }

  return carts;
}
