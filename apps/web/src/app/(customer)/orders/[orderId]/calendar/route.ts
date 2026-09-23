import { NextResponse } from "next/server";
import { NotFoundError, getOrderForCustomer } from "@occasion/core";
import { requireCustomerActor } from "../../../../../lib/auth-guard";
import { createRequestContext } from "../../../../../lib/core";

/**
 * The booking, as a calendar file.
 *
 * A route handler rather than a server action, because the result is a file:
 * this way it is linkable, re-downloadable and bookmarkable, and the gate
 * registry the admin suite already walks covers route handlers, so it costs an
 * entry rather than a new kind of surface.
 *
 * `requireCustomerActor()` is its **first statement** — a layout does not run
 * for a route handler, so nothing else would stop an anonymous request — and
 * `getOrderForCustomer` then asserts the order's own read policy. Somebody
 * else's booking answers 404, exactly as a booking that does not exist does.
 *
 * Keyed on the order id, never on the reference.
 */

/** Node, not Edge: this opens a database connection and runs the domain. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TIMEZONE = "America/Toronto";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
): Promise<Response> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();
  const { orderId } = await params;

  let detail;
  try {
    detail = await getOrderForCustomer(ctx, actor, orderId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: "No such order." }, { status: 404 });
    }
    throw error;
  }

  const { order } = detail;

  if (!order.eventDate) {
    // A booking with no event has no day to put in a calendar. Refused rather
    // than given an invented date, which is the one thing a calendar file must
    // not contain.
    return NextResponse.json({ error: "This booking has no date yet." }, { status: 404 });
  }

  const body = calendar({
    uid: `${order.id}@occasion`,
    stamp: ctx.clock.realNow(),
    timeZone: order.eventTimezone || DEFAULT_TIMEZONE,
    day: order.eventDate,
    startTime: order.eventStartTime,
    summary: `${order.vendorName} · ${order.summary}`,
    description: [
      order.eventName ? `For ${order.eventName}.` : null,
      `Order ${order.reference}.`,
      order.policyName ? `${order.policyName} cancellation policy.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    location: order.eventVenue,
  });

  return new NextResponse(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${order.reference}.ics"`,
      // Somebody else's calendar file must never come out of a shared cache,
      // and this one is as personal as the booking it describes.
      "cache-control": "private, no-store",
    },
  });
}

/**
 * One `VEVENT`, in the event's own zone.
 *
 * `TZID` rather than a UTC instant, because an event is at seven in the evening
 * in Toronto whatever the reader's calendar is set to — and because converting
 * here would bake in today's answer to a question the tz database can still
 * change for a date years away.
 *
 * The end is local midnight, which is what this platform means by an event
 * ending: the row carries a date, an optional start and no duration, and the
 * last instant it could still be in progress is the end of its day. An invented
 * three hours would be a guess in a file somebody's calendar treats as fact.
 */
function calendar(input: {
  uid: string;
  stamp: Date;
  timeZone: string;
  day: string;
  startTime: string | null;
  summary: string;
  description: string;
  location: string | null;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Occasion//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${utcStamp(input.stamp)}`,
    ...whenLines(input.day, input.startTime, input.timeZone),
    `SUMMARY:${escapeText(input.summary)}`,
    `DESCRIPTION:${escapeText(input.description)}`,
    ...(input.location ? [`LOCATION:${escapeText(input.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF, which the format requires rather than prefers: a file with bare
  // newlines is rejected outright by some calendar clients.
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** `DTSTART`/`DTEND`, timed when the event has a start and all-day when not. */
function whenLines(day: string, startTime: string | null, timeZone: string): string[] {
  const compact = day.replaceAll("-", "");

  if (!startTime) {
    // An all-day event's end is exclusive, so it names the following day.
    return [`DTSTART;VALUE=DATE:${compact}`, `DTEND;VALUE=DATE:${nextDay(day)}`];
  }

  const [hour = "00", minute = "00"] = startTime.split(":");
  return [
    `DTSTART;TZID=${timeZone}:${compact}T${hour.padStart(2, "0")}${minute.padStart(2, "0")}00`,
    `DTEND;TZID=${timeZone}:${nextDay(day)}T000000`,
  ];
}

/** The calendar day after this one, as `YYYYMMDD`. */
function nextDay(day: string): string {
  // Read and written in UTC deliberately: this is arithmetic on a calendar
  // date, and letting the runtime interpret it locally moves it a day west of
  // Greenwich — which is every zone this product runs in.
  const parsed = new Date(`${day}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10).replaceAll("-", "");
}

function utcStamp(at: Date): string {
  return `${at.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

/**
 * A text value, with the four characters the format reserves escaped.
 *
 * A business called "Bloom, Petals & Co" would otherwise end the value at the
 * comma and leave the rest of the name as an unparsable property.
 */
function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

/**
 * Folds a line to the seventy-five octets the format allows.
 *
 * The limit is in octets, and an accented business name is two bytes a
 * character — but the break has to fall **between** characters, because a
 * continuation that begins mid-sequence decodes to a replacement character in
 * whatever calendar opens it. So this counts bytes and cuts on code points,
 * which is the one combination that is both within the limit and readable.
 *
 * The first line may carry seventy-five; every continuation begins with a
 * space, which counts towards its own.
 */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const parts: string[] = [];
  let current = "";
  let bytes = 0;

  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    const limit = parts.length === 0 ? 75 : 74;

    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }

    current += character;
    bytes += size;
  }

  if (current) parts.push(current);
  return parts.join("\r\n ");
}
