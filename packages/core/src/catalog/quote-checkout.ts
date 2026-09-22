import * as catalog from "./repo.js";
import type { CoreContext } from "../context.js";
import { NotFoundError, UnauthenticatedError, ValidationError } from "../errors.js";
import { isAuthenticated, type Actor } from "../identity/actor.js";
import { assertCanActOnEvent } from "../identity/policies.js";
import { computeOrderMoney } from "../payments/money.js";
import { buildPaymentPlan, type PaymentPlanKind } from "../payments/plan.js";
import * as ordering from "../ordering/repo.js";
import { DEFAULT_TIMEZONE, eventStartInstant } from "../ordering/schedule.js";
import {
  effectivePricing,
  type CheckoutLine,
  type CheckoutRequest,
  type OrderingPolicy,
} from "../ordering/service.js";

/**
 * What a cart would cost, without buying it.
 *
 * The booking card has to show a deposit before anybody is charged, and a
 * checkout screen has to show the same number the charge will use. Two screens
 * computing it separately is two implementations of the money rules, and the
 * day they disagree is the day a customer is quoted one deposit and billed
 * another.
 *
 * So this runs the same sequence `createCheckout` runs — the platform's current
 * rates, the catalogue's prices, the service's own policy, the split, the
 * payment plan — and writes nothing. It is not a cheaper approximation: every
 * amount comes from the same functions, in the same order, from the same rows.
 *
 * Three differences from a real checkout, all deliberate:
 *
 * - **No lock.** `createCheckout` locks the event because every date it derives
 *   has to survive until the capacity hold is written. A quote writes nothing,
 *   so there is nothing for a concurrent date change to corrupt — and taking
 *   the lock would let a page refresh block a booking.
 * - **No capacity check.** A quote does not hold a date, and answering "is this
 *   free" here would be an availability read wearing a price tag. That question
 *   has its own function, and the constraint inside the checkout's transaction
 *   is what actually decides it.
 * - **No reference and no order id.** Nothing has been created.
 *
 * It refuses exactly whom a checkout refuses, through the same policy: a quote
 * for somebody else's event is a quote for a date and a guest count that are
 * none of the asker's business.
 */

export type QuotedLine = {
  serviceId: string;
  servicePackageId: string | null;
  description: string;
  quantity: number;
  unitPrice: bigint;
  lineTotal: bigint;
  currency: string;
};

/** One vendor's share of the cart, priced exactly as its order would be. */
export type QuotedOrder = {
  vendorId: string;
  vendorName: string;
  lines: QuotedLine[];
  subtotal: bigint;
  tax: bigint;
  total: bigint;
  commission: bigint;
  commissionTax: bigint;
  depositAmount: bigint;
  balanceAmount: bigint;
  currency: string;
  /** Why the plan has this shape, so a screen can say so rather than guess. */
  planKind: PaymentPlanKind;
  balanceDueAt: Date | null;
  coolingWindowEndsAt: Date;
  policyTemplateId: string | null;
};

export type CheckoutQuote = {
  eventId: string;
  orders: QuotedOrder[];
  /** What the whole cart comes to, across every vendor in it. */
  total: bigint;
  /** What would be charged now, across every vendor in it. */
  dueNow: bigint;
};

export async function quoteCheckout(
  ctx: CoreContext,
  actor: Actor,
  request: CheckoutRequest,
  /**
   * Overrides the platform's settings for this one quote.
   *
   * Left out, the rates and windows come from `platform_settings`, which is
   * what a checkout reads too. A caller passing this is stating terms it
   * already holds — which is how a test prices a cart without writing to the
   * settings table.
   */
  policy?: OrderingPolicy,
): Promise<CheckoutQuote> {
  // The same three refusals a checkout makes, in the same order, so a screen
  // that can be quoted is a screen that can be bought from.
  if (!isAuthenticated(actor)) throw new UnauthenticatedError();
  if (request.lines.length === 0) {
    throw new ValidationError("A checkout needs at least one service.", { lines: "empty" });
  }
  for (const line of request.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new ValidationError("A quantity must be a whole number, at least one.", {
        quantity: "invalid",
      });
    }
  }

  const now = ctx.clock.now();
  const db = ctx.db;

  const pricing = await effectivePricing(ctx, db);
  const terms = policy ?? pricing.policy;

  // Read, not locked: see above.
  const event = await ordering.loadEventForOrder(db, request.eventId);
  if (!event) throw new NotFoundError("No such event.");

  assertCanActOnEvent(actor, { id: event.id, ownerUserId: event.ownerUserId });

  const timeZone = event.timezone || DEFAULT_TIMEZONE;
  const eventStart = eventStartInstant(event.eventDate, event.startTime, timeZone);

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

  const byVendor = new Map<string, Array<{ line: CheckoutLine; priced: catalog.PricedLine }>>();

  for (const line of request.lines) {
    const service = priced.get(line.serviceId);
    // The same answer for "no such service", "that vendor is not approved" and
    // "that listing is a draft": a quote must not become the way to discover
    // any of the three.
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

  const templates = new Map<string, ordering.PolicyTerms>();
  for (const templateId of new Set(
    [...priced.values()].map((line) => line.policyTemplateId).filter((id) => id !== null),
  )) {
    const template = await ordering.loadPolicyTemplate(db, templateId);
    if (template) templates.set(templateId, template);
  }

  const quoted: QuotedOrder[] = [];

  for (const [vendorId, group] of byVendor) {
    const lines: QuotedLine[] = group.map(({ line, priced: priceLine }) => ({
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

    if (lines.some((line) => line.currency !== first.currency)) {
      throw new ValidationError("A booking cannot mix currencies.", { currency: "mixed" });
    }

    if (group.some(({ priced: line }) => line.policyTemplateId !== first.policyTemplateId)) {
      throw new ValidationError("A booking cannot mix cancellation policies.", {
        policy: "mixed",
      });
    }

    const template = first.policyTemplateId ? templates.get(first.policyTemplateId) : undefined;
    const depositBps = template?.depositBps ?? terms.defaultDepositBps;
    const coolingWindowHours = template?.freeCancellationHours ?? terms.coolingWindowHours;

    const money = computeOrderMoney({
      subtotal,
      vendorHstRegistered: first.vendorHstRegistered,
      commissionBps: pricing.commissionBps,
      hstBps: pricing.hstBps,
    });

    const plan = buildPaymentPlan({
      total: money.total,
      now,
      eventStart,
      depositBps,
      balanceLeadDays: terms.balanceLeadDays,
      coolingWindowHours,
      fullPaymentBelow: terms.fullPaymentBelow,
      timeZone,
    });

    quoted.push({
      vendorId,
      vendorName: first.vendorName,
      lines,
      subtotal: money.subtotal,
      tax: money.tax,
      total: money.total,
      commission: money.commission,
      commissionTax: money.commissionTax,
      depositAmount: plan.depositAmount,
      balanceAmount: plan.balanceAmount,
      currency: first.currency,
      planKind: plan.kind,
      balanceDueAt: plan.balanceDueAt,
      coolingWindowEndsAt: plan.coolingWindowEndsAt,
      policyTemplateId: template?.id ?? null,
    });
  }

  return {
    eventId: event.id,
    orders: quoted,
    total: quoted.reduce((sum, order) => sum + order.total, 0n),
    dueNow: quoted.reduce((sum, order) => sum + order.depositAmount, 0n),
  };
}
