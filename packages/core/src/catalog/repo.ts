import { eq, inArray } from "drizzle-orm";
import { servicePackages, services, vendors } from "@occasion/db/schema";
import type { DbExecutor } from "../context.js";

/**
 * What a thing costs, read at the moment it is bought.
 *
 * The price a checkout charges is never the price the request asked for. A
 * client that can name an amount can name a smaller one, and a catalogue that
 * changed between the page being rendered and the button being pressed would
 * otherwise charge yesterday's number. So the lines arrive as ids and
 * quantities, and everything with a dollar sign on it comes from here.
 */

/** A priced line as the catalogue currently sells it. */
export type PricedLine = {
  serviceId: string;
  servicePackageId: string | null;
  vendorId: string;
  vendorName: string;
  vendorStatus: string;
  vendorHstRegistered: boolean;
  /** Copied onto the order: the catalogue may change, the receipt may not. */
  description: string;
  unitPrice: bigint;
  currency: string;
};

/**
 * Prices the services a checkout names.
 *
 * One query for every line rather than one per line: a cart of six services is
 * six round trips otherwise, and the six would not see the same instant of the
 * catalogue.
 */
export async function priceServices(
  db: DbExecutor,
  serviceIds: readonly string[],
): Promise<Map<string, PricedLine>> {
  if (serviceIds.length === 0) return new Map();

  const rows = await db
    .select({
      serviceId: services.id,
      title: services.title,
      basePrice: services.basePrice,
      currency: services.currency,
      vendorId: vendors.id,
      vendorName: vendors.name,
      vendorStatus: vendors.status,
      hstRegistered: vendors.hstRegistered,
    })
    .from(services)
    .innerJoin(vendors, eq(vendors.id, services.vendorId))
    .where(inArray(services.id, [...serviceIds]));

  return new Map(
    rows.map((row) => [
      row.serviceId,
      {
        serviceId: row.serviceId,
        servicePackageId: null,
        vendorId: row.vendorId,
        vendorName: row.vendorName,
        vendorStatus: row.vendorStatus,
        vendorHstRegistered: row.hstRegistered !== null,
        description: row.title,
        unitPrice: row.basePrice,
        currency: row.currency,
      },
    ]),
  );
}

/**
 * Prices a named tier of a service.
 *
 * The package is checked against its service rather than looked up alone: a
 * request naming a cheap package of one service and an expensive service would
 * otherwise be priced by whichever row the query found.
 */
export async function pricePackages(
  db: DbExecutor,
  wanted: ReadonlyArray<{ serviceId: string; servicePackageId: string }>,
): Promise<Map<string, { id: string; name: string; unitPrice: bigint; currency: string }>> {
  if (wanted.length === 0) return new Map();

  const rows = await db
    .select({
      id: servicePackages.id,
      serviceId: servicePackages.serviceId,
      name: servicePackages.name,
      unitPrice: servicePackages.unitPrice,
      currency: servicePackages.currency,
    })
    .from(servicePackages)
    .where(
      inArray(
        servicePackages.id,
        wanted.map((line) => line.servicePackageId),
      ),
    );

  const belongs = new Set(wanted.map((line) => `${line.serviceId}:${line.servicePackageId}`));

  return new Map(
    rows
      .filter((row) => belongs.has(`${row.serviceId}:${row.id}`))
      .map((row) => [
        row.id,
        { id: row.id, name: row.name, unitPrice: row.unitPrice, currency: row.currency },
      ]),
  );
}

/**
 * Whether a service is one a customer may book at all.
 *
 * The vendor's standing, and only that. Publication is the second condition and
 * is deliberately **not** applied: `services.published_at` is written by no code
 * path in this milestone — publishing belongs to the vendor catalogue screen —
 * so requiring it would make every service unbookable and take the rule below
 * it out of service too. Recorded in `docs/design-gaps.md`; the screen that
 * starts writing that column is the change that adds the condition here.
 */
export function bookable(line: Pick<PricedLine, "vendorStatus">): boolean {
  return line.vendorStatus === "approved";
}
