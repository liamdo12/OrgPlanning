import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createDb, type Db } from "../client.js";
import * as s from "../schema/index.js";
import { seedId } from "./ids.js";
import { deriveFromTotal } from "./money.js";
import { CATEGORIES, PLACES, PLATFORM_SETTINGS, POLICY_TEMPLATES } from "./data/reference.js";
import { ADMIN_USER, ADMIN_VENDORS, CATALOG_VENDORS, USERS } from "./data/accounts.js";
import { SERVICES } from "./data/catalog.js";
import { EVENTS, ORDERS, QUOTE_REQUEST, RULES } from "./data/activity.js";

/**
 * Rebuilds the demo data.
 *
 * Two properties this seed is built around:
 *
 *   Deterministic — every id comes from `seedId(name)`, so reseeding does not
 *   invalidate fixtures, E2E specs or a bookmarked admin URL.
 *
 *   Relative — every instant is computed from `anchorAt`, which is the clock's
 *   "now" at seed time and is recorded in `seed_meta`. The prototype's four
 *   demo clock states are offsets ("+48h", "event−14d", "event+72h"), so
 *   storing literal dates would leave the demo describing a past that never
 *   changes.
 *
 * Idempotent by construction: every insert is an upsert keyed on the
 * deterministic id, so running it twice changes nothing.
 */

export type SeedOptions = {
  connectionString: string;
  /**
   * The instant every offset is measured from. Required rather than defaulted:
   * this package does not read the wall clock, so that seeding under an admin
   * clock override anchors to the overridden time rather than to real time.
   */
  anchorAt: Date;
  /** Skip reference data and only rebuild demo rows. */
  demoOnly?: boolean;
};

export type SeedResult = {
  anchorAt: Date;
  counts: Record<string, number>;
};

const SEED_REVISION = "2026-09-16";

const hours = (n: number) => n * 60 * 60 * 1000;
const days = (n: number) => n * 24 * 60 * 60 * 1000;

function at(anchor: Date, ms: number): Date {
  return new Date(anchor.getTime() + ms);
}

/**
 * `YYYY-MM-DD` as read in the given timezone.
 *
 * Not `toISOString().slice(0, 10)`: that is the UTC calendar date, so a seed
 * run after 20:00 in Toronto lands every event a day late relative to the
 * anchor's own local date, and the offsets stop meaning local days.
 */
function isoDate(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

const EVENT_TIMEZONE = "America/Toronto";

/** A zone's offset from UTC at a given instant, in milliseconds. */
function zoneOffsetMs(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value);

  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");

  return (
    Date.UTC(
      field("year"),
      field("month") - 1,
      field("day"),
      // `hour12: false` renders midnight as 24 in some engines.
      field("hour") % 24,
      field("minute"),
      field("second"),
    ) - value.getTime()
  );
}

/**
 * The same wall-clock time, a whole number of calendar days earlier.
 *
 * Not `instant - n * 24h`. "Fourteen days before the event" is a date on a
 * calendar, and across a daylight-saving transition a fixed 336 hours lands on
 * the day before or the day after the intended one — which is a balance charged
 * on the wrong date, and only when the event happens to sit on the far side of
 * a March or November boundary.
 *
 * One adjustment, not a loop: a wall-clock time that a transition skips or
 * repeats would land an hour out. Every instant this is asked about is an
 * evening event time, nowhere near 02:00, so the case does not arise — but it
 * is a limit of this function, not a property of the calendar.
 */
export function daysBeforeLocal(value: Date, count: number, timeZone: string): Date {
  const naive = new Date(value.getTime() - days(count));
  return new Date(
    naive.getTime() + (zoneOffsetMs(value, timeZone) - zoneOffsetMs(naive, timeZone)),
  );
}

export async function seed(options: SeedOptions): Promise<SeedResult> {
  const pool = createDb({ connectionString: options.connectionString, maxConnections: 1 });
  const { anchorAt } = options;

  try {
    const counts = await pool.db.transaction(async (tx) => {
      if (!options.demoOnly) {
        await seedReference(tx as unknown as Db);
      }
      return seedDemo(tx as unknown as Db, anchorAt);
    });

    return { anchorAt, counts };
  } finally {
    await pool.close();
  }
}

/**
 * Writes the demo rows inside a transaction the caller already owns.
 *
 * `reseedDemo` uses this so the delete and the rebuild commit together.
 */
export function seedDemoRows(tx: unknown, anchorAt: Date): Promise<Record<string, number>> {
  return seedDemo(tx as Db, anchorAt);
}

async function seedReference(db: Db): Promise<void> {
  await db
    .insert(s.categories)
    .values(
      CATEGORIES.map((category, index) => ({
        id: seedId(`category:${category.slug}`),
        slug: category.slug,
        name: category.name,
        displayCount: category.displayCount,
        sortOrder: index,
      })),
    )
    .onConflictDoUpdate({
      target: s.categories.id,
      set: { name: sql`excluded.name`, displayCount: sql`excluded.display_count` },
    });

  await db
    .insert(s.neighbourhoods)
    .values(
      PLACES.map((place, index) => ({
        id: seedId(`place:${place.slug}`),
        slug: place.slug,
        name: place.name,
        kind: place.kind,
        subtitle: place.subtitle,
        postalPrefix: place.postalPrefix,
        searchTags: place.searchTags,
        latitude: place.latitude,
        longitude: place.longitude,
        sortOrder: index,
      })),
    )
    .onConflictDoUpdate({
      target: s.neighbourhoods.id,
      set: { name: sql`excluded.name`, subtitle: sql`excluded.subtitle` },
    });

  await db
    .insert(s.policyTemplates)
    .values(
      POLICY_TEMPLATES.map((policy) => ({
        id: seedId(`policy:${policy.tier}`),
        tier: policy.tier,
        name: policy.name,
        summary: policy.summary,
        depositBps: policy.depositBps,
        freeCancellationHours: policy.freeCancellationHours,
        lateRefundBps: policy.lateRefundBps,
      })),
    )
    .onConflictDoUpdate({
      target: s.policyTemplates.id,
      set: { summary: sql`excluded.summary`, depositBps: sql`excluded.deposit_bps` },
    });

  await db
    .insert(s.platformSettings)
    .values(
      PLATFORM_SETTINGS.map((setting) => ({
        key: setting.key,
        value: setting.value,
        description: setting.description,
      })),
    )
    .onConflictDoUpdate({
      target: s.platformSettings.key,
      set: { value: sql`excluded.value`, description: sql`excluded.description` },
    });
}

async function seedDemo(db: Db, anchorAt: Date): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // ---- accounts -----------------------------------------------------------

  const allUsers = [...USERS, ADMIN_USER];

  await db
    .insert(s.users)
    .values(
      allUsers.map((user) => ({
        id: seedId(`user:${user.key}`),
        email: user.email,
        fullName: user.fullName,
        status: user.status,
        emailVerifiedAt:
          "emailVerified" in user && user.emailVerified === false ? null : at(anchorAt, days(-200)),
        isDemo: true,
      })),
    )
    .onConflictDoUpdate({
      target: s.users.id,
      set: { status: sql`excluded.status`, fullName: sql`excluded.full_name` },
    });
  counts["users"] = allUsers.length;

  const roleRows = allUsers.flatMap((user) =>
    user.roles.map((role) => ({
      id: seedId(`user_role:${user.key}:${role}`),
      userId: seedId(`user:${user.key}`),
      role,
    })),
  );
  await db.insert(s.userRoles).values(roleRows).onConflictDoNothing();
  counts["user_roles"] = roleRows.length;

  const vendorRows = [
    ...ADMIN_VENDORS.map((vendor) => ({
      id: seedId(`vendor:${vendor.key}`),
      slug: vendor.slug,
      name: vendor.name,
      status: vendor.status,
      baseArea: vendor.baseArea,
      stripeAccountId: vendor.stripeConnected ? `acct_test_${vendor.key}` : null,
      stripeStatus: vendor.stripeConnected ? "connected" : "incomplete",
      stripeChargesEnabled: vendor.stripeConnected ? at(anchorAt, days(-150)) : null,
      stripePayoutsEnabled:
        vendor.stripeConnected && vendor.status === "approved" ? at(anchorAt, days(-150)) : null,
      hstNumber: vendor.hstRegistered ? `${100_000_000 + vendorHash(vendor.key)}RT0001` : null,
      hstRegistered: vendor.hstRegistered ? at(anchorAt, days(-400)) : null,
      onboardingPercent: "onboardingPercent" in vendor ? vendor.onboardingPercent : null,
      approvedAt: vendor.status === "approved" ? at(anchorAt, days(-160)) : null,
      suspendedAt: null,
      isDemo: true,
    })),
    ...CATALOG_VENDORS.map((vendor) => ({
      id: seedId(`vendor:${vendor.key}`),
      slug: vendor.slug,
      name: vendor.name,
      status: vendor.status,
      baseArea: vendor.baseArea,
      stripeAccountId: `acct_test_${vendor.key}`,
      stripeStatus: "connected",
      stripeChargesEnabled: at(anchorAt, days(-150)),
      stripePayoutsEnabled: at(anchorAt, days(-150)),
      hstNumber: vendor.hstRegistered ? `${100_000_000 + vendorHash(vendor.key)}RT0001` : null,
      hstRegistered: vendor.hstRegistered ? at(anchorAt, days(-400)) : null,
      onboardingPercent: null,
      approvedAt: at(anchorAt, days(-160)),
      suspendedAt: null,
      isDemo: true,
    })),
  ];

  await db
    .insert(s.vendors)
    .values(vendorRows)
    .onConflictDoUpdate({
      target: s.vendors.id,
      set: { status: sql`excluded.status`, name: sql`excluded.name` },
    });
  counts["vendors"] = vendorRows.length;

  const memberRows = ADMIN_VENDORS.filter((vendor) => vendor.ownerKey !== null).map((vendor) => ({
    id: seedId(`vendor_member:${vendor.key}`),
    vendorId: seedId(`vendor:${vendor.key}`),
    userId: seedId(`user:${vendor.ownerKey as string}`),
    role: "owner",
  }));
  await db.insert(s.vendorMembers).values(memberRows).onConflictDoNothing();
  counts["vendor_members"] = memberRows.length;

  // No express consent by default, so a broadcast test has something to refuse.
  const consentRows = USERS.map((user) => ({
    id: seedId(`consent:${user.key}:marketing_email`),
    userId: seedId(`user:${user.key}`),
    channel: "marketing_email" as const,
    basis: user.key === "sarah" ? ("express" as const) : ("implied" as const),
    expiresAt: user.key === "sarah" ? null : at(anchorAt, days(180)),
    source: "seed",
    capturedAt: at(anchorAt, days(-200)),
  }));
  await db.insert(s.communicationConsents).values(consentRows).onConflictDoNothing();
  counts["communication_consents"] = consentRows.length;

  // ---- catalogue ----------------------------------------------------------

  const serviceRows = SERVICES.map((service) => ({
    id: seedId(`service:${service.key}`),
    vendorId: seedId(`vendor:${service.vendorKey}`),
    categoryId: seedId(`category:${service.categorySlug}`),
    slug: service.slug,
    title: service.title,
    basePrice: service.basePrice,
    priceUnit: service.priceUnit,
    bookingMode: service.bookingMode,
    badge: service.badge,
    areaLabel: service.areaLabel,
    ratingAverage: service.rating,
    reviewCount: service.reviews,
    toneStart: service.tone[0],
    toneEnd: service.tone[1],
  }));
  await db
    .insert(s.services)
    .values(serviceRows)
    .onConflictDoUpdate({
      target: s.services.id,
      set: { title: sql`excluded.title`, basePrice: sql`excluded.base_price` },
    });
  counts["services"] = serviceRows.length;

  const packageRows = SERVICES.flatMap((service) =>
    service.packages.map((pkg, index) => ({
      id: seedId(`package:${service.key}:${pkg.name}`),
      serviceId: seedId(`service:${service.key}`),
      name: pkg.name,
      description: pkg.description,
      unitPrice: pkg.unitPrice,
      sortOrder: index,
    })),
  );
  await db
    .insert(s.servicePackages)
    .values(packageRows)
    .onConflictDoUpdate({
      target: s.servicePackages.id,
      set: { unitPrice: sql`excluded.unit_price` },
    });
  counts["service_packages"] = packageRows.length;

  const areaRows = SERVICES.flatMap((service) =>
    service.areas.map((area) => ({
      id: seedId(`service_area:${service.key}:${area}`),
      serviceId: seedId(`service:${service.key}`),
      neighbourhoodId: seedId(`place:${area}`),
    })),
  );
  await db.insert(s.serviceAreas).values(areaRows).onConflictDoNothing();
  counts["service_areas"] = areaRows.length;

  // ---- events -------------------------------------------------------------

  const eventRows = EVENTS.map((event) => ({
    id: seedId(`event:${event.key}`),
    ownerUserId: seedId(`user:${event.ownerKey}`),
    name: event.name,
    eventDate: isoDate(at(anchorAt, days(event.dayOffset)), EVENT_TIMEZONE),
    startTime: event.startTime,
    timezone: EVENT_TIMEZONE,
    venueName: event.venueName,
    neighbourhoodId: seedId(`place:${event.neighbourhoodSlug}`),
    guestCount: event.guestCount,
    budget: event.budget,
    visibility: "private" as const,
    isDemo: true,
  }));
  await db
    .insert(s.events)
    .values(eventRows)
    .onConflictDoUpdate({
      target: s.events.id,
      set: { eventDate: sql`excluded.event_date`, name: sql`excluded.name` },
    });
  counts["events"] = eventRows.length;

  // ---- orders, payments, transfers, refunds -------------------------------

  const vendorRegistration = new Map<string, boolean>([
    ...ADMIN_VENDORS.map((v) => [v.key, v.hstRegistered] as const),
    ...CATALOG_VENDORS.map((v) => [v.key, v.hstRegistered] as const),
  ]);
  const eventOffset = new Map(EVENTS.map((event) => [event.key, event.dayOffset] as const));

  const orderRows = [];
  const itemRows = [];
  const paymentRows = [];
  const transferRows = [];
  const refundRows = [];
  const linkRows = [];
  const jobRows = [];

  for (const order of ORDERS) {
    const orderId = seedId(`order:${order.reference}`);
    const registered = vendorRegistration.get(order.vendorKey) ?? true;
    const money = deriveFromTotal({
      totalCents: order.totalCents,
      vendorHstRegistered: registered,
      commissionBps: RULES.commissionBps,
      hstBps: RULES.hstBps,
      depositBps: RULES.depositBps,
    });

    const eventDayOffset = eventOffset.get(order.eventKey) ?? 0;
    const eventAt = at(anchorAt, days(eventDayOffset));
    const depositPaidAt = at(anchorAt, hours(order.depositPaidHoursAfterAnchor));
    const coolingEndsAt = at(depositPaidAt, hours(RULES.coolingWindowHours));
    const balanceDueAt = daysBeforeLocal(eventAt, RULES.balanceLeadDays, EVENT_TIMEZONE);
    const autoCompleteAt = at(eventAt, hours(RULES.autoCompleteHours));
    const paidInFull = "paidInFull" in order && order.paidInFull === true;
    const balanceFailed = "balanceFailed" in order && order.balanceFailed === true;
    const refunded = "refunded" in order && order.refunded === true;

    orderRows.push({
      id: orderId,
      reference: order.reference,
      userId: seedId(`user:${order.userKey}`),
      vendorId: seedId(`vendor:${order.vendorKey}`),
      eventId: seedId(`event:${order.eventKey}`),
      state: order.state,
      subtotal: money.subtotal,
      tax: money.tax,
      total: money.total,
      commission: money.commission,
      commissionTax: money.commissionTax,
      depositAmount: paidInFull ? money.total : money.depositAmount,
      balanceAmount: paidInFull ? 0n : money.balanceAmount,
      policyTemplateId: seedId("policy:moderate"),
      coolingWindowEndsAt: coolingEndsAt,
      balanceDueAt: paidInFull ? null : balanceDueAt,
      graceExpiresAt: balanceFailed ? at(anchorAt, hours(RULES.balanceGraceHours)) : null,
      // Only once an order has been delivered. The lifecycle sets this on
      // entering `fulfilled` and never clears it, so a completed order keeps
      // the instant it auto-completed at and everything earlier has none — a
      // confirmed booking carrying an auto-complete date is a deadline no job
      // is working to.
      autoCompleteAt: ["fulfilled", "completed"].includes(order.state) ? autoCompleteAt : null,
      fulfilledAt: ["fulfilled", "completed"].includes(order.state) ? eventAt : null,
      completedAt: order.state === "completed" ? autoCompleteAt : null,
      cancelledAt: order.state === "cancelled" ? at(depositPaidAt, hours(12)) : null,
      isDemo: true,
    });

    itemRows.push({
      id: seedId(`order_item:${order.reference}`),
      orderId,
      serviceId: seedId(`service:${order.serviceKey}`),
      servicePackageId: order.packageName
        ? seedId(`package:${order.serviceKey}:${order.packageName}`)
        : null,
      description: order.description,
      quantity: order.quantity,
      unitPrice: money.subtotal / BigInt(order.quantity),
      lineTotal: money.subtotal,
    });

    // The deposit (or the full amount) always succeeded: every seeded order
    // exists because a customer paid something.
    paymentRows.push({
      id: seedId(`payment:${order.reference}:deposit`),
      orderId,
      kind: paidInFull ? ("full" as const) : ("deposit" as const),
      state: refunded ? ("refunded" as const) : ("succeeded" as const),
      amount: paidInFull ? money.total : money.depositAmount,
      providerPaymentIntentId: `pi_test_${order.reference.toLowerCase()}_deposit`,
      succeededAt: depositPaidAt,
    });

    if (balanceFailed) {
      // The declined balance the admin screen shows as "Balance failed".
      paymentRows.push({
        id: seedId(`payment:${order.reference}:balance`),
        orderId,
        kind: "balance" as const,
        state: "failed" as const,
        amount: money.balanceAmount,
        providerPaymentIntentId: `pi_test_${order.reference.toLowerCase()}_balance`,
        offSession: at(anchorAt, hours(-2)),
        failureCode: "card_declined",
        failureMessage: "Your card was declined.",
        failedAt: at(anchorAt, hours(-2)),
      });

      // An opaque single-use token, never the order id: a link built from a
      // domain id can be walked to every other order by changing a number.
      linkRows.push({
        id: seedId(`payment_link:${order.reference}`),
        orderId,
        // Random even in the seed: a token derived from the order reference is
        // computable by anyone holding this repository, which is the property
        // an opaque single-use link exists to avoid. This is the one seeded
        // value that is deliberately not deterministic.
        token: randomUUID().replace(/-/g, ""),
        amount: money.balanceAmount,
        expiresAt: at(anchorAt, hours(RULES.balanceGraceHours)),
      });
    }

    if (refunded) {
      refundRows.push({
        id: seedId(`refund:${order.reference}`),
        orderId,
        paymentId: seedId(`payment:${order.reference}:deposit`),
        state: "settled" as const,
        amount: money.depositAmount,
        reason: "Cancelled inside the free window.",
        providerRefundId: `re_test_${order.reference.toLowerCase()}`,
        settledAt: at(depositPaidAt, hours(13)),
      });
    }

    // A transfer exists once the cooling window has closed. A suspended or
    // blocked vendor's payout is held rather than paid — suspension has to stop
    // money leaving, not merely hide the vendor from search.
    const vendorStatusNow =
      ADMIN_VENDORS.find((v) => v.key === order.vendorKey)?.status ?? "approved";
    const coolingClosed = coolingEndsAt.getTime() <= anchorAt.getTime();

    if (coolingClosed && !refunded) {
      const held = payoutIsHeld(vendorStatusNow);
      transferRows.push({
        id: seedId(`transfer:${order.reference}:deposit_share`),
        orderId,
        vendorId: seedId(`vendor:${order.vendorKey}`),
        kind: "deposit_share" as const,
        state: held ? ("held" as const) : ("paid" as const),
        amount: paidInFull
          ? money.depositVendorShare + money.balanceVendorShare
          : money.depositVendorShare,
        providerTransferId: held ? null : `tr_test_${order.reference.toLowerCase()}_deposit`,
        heldReason: held ? s.standingHoldReason(vendorStatusNow) : null,
        paidAt: held ? null : coolingEndsAt,
      });
    }

    // ---- jobs, derived from the order rather than hand-written -------------

    // `type:orderId`, which is the key the ordering domain computes. It is not
    // a cosmetic choice and the reference cannot serve: the domain addresses a
    // job by that key to cancel it when an order ends and to refuse a duplicate
    // when one is re-queued. A seeded job under any other key is invisible to
    // both — a cancelled demo order would keep a balance charge due against it,
    // and confirming one would schedule a second. This duplicates the domain's
    // convention because `packages/db` may not import `packages/core`;
    // `admin-orders.test.ts` asserts the two still agree.
    const jobKey = (type: string) => `${type}:${orderId}`;

    if (!coolingClosed && !refunded) {
      jobRows.push({
        id: seedId(`job:cooling:${order.reference}`),
        type: "cooling_window_transfer" as const,
        status: "queued" as const,
        dedupeKey: jobKey("cooling_window_transfer"),
        runAfter: coolingEndsAt,
        payload: { orderId, reference: order.reference },
        isDemo: true,
      });
    }

    if (!paidInFull && !refunded && order.state !== "action_required") {
      jobRows.push({
        id: seedId(`job:balance:${order.reference}`),
        type: "charge_balance" as const,
        status: "queued" as const,
        dedupeKey: jobKey("charge_balance"),
        runAfter: balanceDueAt,
        payload: { orderId, reference: order.reference, amount: money.balanceAmount.toString() },
        isDemo: true,
      });
    }

    if (balanceFailed) {
      jobRows.push({
        id: seedId(`job:grace:${order.reference}`),
        type: "balance_grace_expiry" as const,
        status: "queued" as const,
        dedupeKey: jobKey("balance_grace_expiry"),
        runAfter: at(anchorAt, hours(RULES.balanceGraceHours)),
        payload: { orderId, reference: order.reference },
        isDemo: true,
      });
    }

    // Entering `fulfilled` is what queues this, per the lifecycle table — not
    // confirmation. Queueing it earlier put a job against orders that have not
    // been delivered, under a key the domain would later find already taken:
    // marking one of them fulfilled would then schedule nothing at all.
    if (order.state === "fulfilled") {
      jobRows.push({
        id: seedId(`job:autocomplete:${order.reference}`),
        type: "auto_complete_order" as const,
        status: "queued" as const,
        dedupeKey: jobKey("auto_complete_order"),
        runAfter: autoCompleteAt,
        payload: { orderId, reference: order.reference },
        isDemo: true,
      });
    }
  }

  await db
    .insert(s.orders)
    .values(orderRows)
    .onConflictDoUpdate({
      target: s.orders.id,
      set: { state: sql`excluded.state`, balanceDueAt: sql`excluded.balance_due_at` },
    });
  counts["orders"] = orderRows.length;

  await db.insert(s.orderItems).values(itemRows).onConflictDoNothing();
  counts["order_items"] = itemRows.length;

  await db.insert(s.payments).values(paymentRows).onConflictDoNothing();
  counts["payments"] = paymentRows.length;

  if (transferRows.length > 0) {
    await db.insert(s.transfers).values(transferRows).onConflictDoNothing();
  }
  counts["transfers"] = transferRows.length;

  if (refundRows.length > 0) {
    await db.insert(s.refunds).values(refundRows).onConflictDoNothing();
  }
  counts["refunds"] = refundRows.length;

  if (linkRows.length > 0) {
    await db.insert(s.paymentLinks).values(linkRows).onConflictDoNothing();
  }
  counts["payment_links"] = linkRows.length;

  // ---- quote request ------------------------------------------------------

  const quoteEventOffset = eventOffset.get(QUOTE_REQUEST.eventKey) ?? 0;
  const quoteExpiresAt = at(
    anchorAt,
    days(quoteEventOffset - QUOTE_REQUEST.expiresDaysBeforeEvent),
  );
  const quoteRequestId = seedId(`quote_request:${QUOTE_REQUEST.key}`);

  await db
    .insert(s.quoteRequests)
    .values({
      id: quoteRequestId,
      userId: seedId(`user:${QUOTE_REQUEST.userKey}`),
      eventId: seedId(`event:${QUOTE_REQUEST.eventKey}`),
      categoryId: seedId(`category:${QUOTE_REQUEST.categorySlug}`),
      state: "open",
      brief: QUOTE_REQUEST.brief,
      answers: QUOTE_REQUEST.answers,
      guestCount: QUOTE_REQUEST.guestCount,
      budget: QUOTE_REQUEST.budget,
      expiresAt: quoteExpiresAt,
    })
    .onConflictDoUpdate({
      target: s.quoteRequests.id,
      set: { expiresAt: sql`excluded.expires_at` },
    });
  counts["quote_requests"] = 1;

  const inviteRows = QUOTE_REQUEST.invitedVendorKeys.map((vendorKey) => ({
    id: seedId(`quote_invite:${QUOTE_REQUEST.key}:${vendorKey}`),
    quoteRequestId,
    vendorId: seedId(`vendor:${vendorKey}`),
    invitedAt: at(anchorAt, days(-3)),
  }));
  await db.insert(s.quoteRequestInvites).values(inviteRows).onConflictDoNothing();
  counts["quote_request_invites"] = inviteRows.length;

  const offerRows = QUOTE_REQUEST.offers.map((offer) => ({
    id: seedId(`quote_offer:${QUOTE_REQUEST.key}:${offer.vendorKey}`),
    quoteRequestId,
    vendorId: seedId(`vendor:${offer.vendorKey}`),
    state: "sent" as const,
    subtotal: offer.subtotalCents,
    message: offer.message,
    validUntil: quoteExpiresAt,
  }));
  await db.insert(s.quoteOffers).values(offerRows).onConflictDoNothing();
  counts["quote_offers"] = offerRows.length;

  jobRows.push({
    id: seedId(`job:quote_expiry:${QUOTE_REQUEST.key}`),
    type: "expire_quote_request" as const,
    status: "queued" as const,
    dedupeKey: `${QUOTE_REQUEST.key}:expire`,
    runAfter: quoteExpiresAt,
    payload: { quoteRequestId },
    isDemo: true,
  });

  // ---- jobs ---------------------------------------------------------------

  await db
    .insert(s.jobs)
    .values(jobRows)
    .onConflictDoUpdate({
      target: s.jobs.id,
      set: { runAfter: sql`excluded.run_after`, status: sql`excluded.status` },
    });
  counts["jobs"] = jobRows.length;

  // ---- seed metadata ------------------------------------------------------

  await db.delete(s.seedMeta).where(eq(s.seedMeta.revision, SEED_REVISION));
  await db.insert(s.seedMeta).values({
    id: seedId(`seed_meta:${SEED_REVISION}`),
    anchorAt,
    revision: SEED_REVISION,
    notes: "Offsets are relative to anchor_at; see src/seed/data/activity.ts.",
  });
  counts["seed_meta"] = 1;

  return counts;
}

/**
 * Whether a vendor's payout is parked rather than paid.
 *
 * Takes the full enum rather than the narrow union the seed data happens to
 * contain today: the rule is about vendor status in general, and a seed that
 * later includes a suspended vendor must still hold the money.
 */
function payoutIsHeld(status: (typeof s.vendorStatus.enumValues)[number]): boolean {
  return status === "suspended" || status === "blocked";
}

/** A small stable integer per vendor key, for readable fake tax numbers. */
function vendorHash(key: string): number {
  let total = 0;
  for (const character of key) total = (total * 31 + character.charCodeAt(0)) % 1_000_000;
  return total;
}
