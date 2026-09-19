import { ValidationError } from "../errors.js";

/**
 * Every merge field the platform knows, and what it is safe to put it in.
 *
 * A merge field is a hole in a message that per-recipient data is poured into,
 * and the interesting question about each one is not what it means but what
 * happens when the wrong message carries it. Two answers, so two classes:
 *
 * - **Open** fields are already known to whoever reads the message — their own
 *   first name, the brand, a public policy URL. Interpolating one into a
 *   broadcast tells nobody anything they did not know.
 * - **Restricted** fields are per-recipient secrets or near-secrets: a
 *   single-use payment link, a verification link, the last four digits of a
 *   card or a bank account. A broadcast body is written once and sent to
 *   everybody, so a restricted field in one is a message that either leaks the
 *   first recipient's secret to all of them or fails to render for all but one.
 *   Neither is recoverable after the send.
 *
 * So the class is a property of the field, checked when a template is saved
 * rather than when it is sent. By send time the body is already stored, and
 * something else will eventually send it.
 */

export type FieldClass = "open" | "restricted";

export type MergeField = {
  /** The token as an author writes it, without braces: `first_name`. */
  readonly name: string;
  readonly label: string;
  readonly class: FieldClass;
  /** What the preview fills it with, so an author sees a real-looking message. */
  readonly sample: string;
};

/**
 * The catalogue.
 *
 * Transcribed from the prototype's sample map (`design/Event Marketplace
 * Glass.dc.html`, lines 2657–2668), which is where the vocabulary and the
 * sample values come from. The `class` column is this platform's addition: the
 * prototype fills every token from one object and has no notion of a token that
 * some messages may not carry.
 */
export const MERGE_FIELDS: readonly MergeField[] = [
  { name: "first_name", label: "First name", class: "open", sample: "Sarah" },
  { name: "customer_first_name", label: "Customer first name", class: "open", sample: "Sarah" },
  { name: "customer_name", label: "Customer name", class: "open", sample: "Sarah Mensah" },
  { name: "brand_name", label: "Brand", class: "open", sample: "Occasion" },
  { name: "vendor_name", label: "Business", class: "open", sample: "Bloom & Co" },
  { name: "service_name", label: "Service", class: "open", sample: "Classic bouquet × 2" },
  { name: "event_name", label: "Event", class: "open", sample: "Sarah's 30th" },
  { name: "event_date", label: "Event date", class: "open", sample: "Sat Mar 20, 2027" },
  { name: "order_reference", label: "Order reference", class: "open", sample: "OC-2027-0412" },
  { name: "deposit_amount", label: "Deposit", class: "open", sample: "C$65.54" },
  { name: "balance_amount", label: "Balance", class: "open", sample: "C$262.16" },
  { name: "balance_date", label: "Balance date", class: "open", sample: "Mar 6, 2027" },
  { name: "refund_amount", label: "Refund", class: "open", sample: "C$65.54" },
  { name: "payout_amount", label: "Payout", class: "open", sample: "C$1,665.00" },
  { name: "order_count", label: "Order count", class: "open", sample: "6" },
  { name: "payout_date", label: "Payout date", class: "open", sample: "Sep 18, 2026" },
  { name: "city", label: "City", class: "open", sample: "Toronto" },
  { name: "effective_date", label: "Effective date", class: "open", sample: "Oct 1, 2026" },
  { name: "quote_expiry", label: "Quote expiry", class: "open", sample: "Mar 13, 2027" },
  { name: "grace_deadline", label: "Grace deadline", class: "open", sample: "Mar 9, 2027" },
  { name: "policy_link", label: "Policy link", class: "open", sample: "occasion.ca/policy" },
  { name: "review_link", label: "Review link", class: "open", sample: "occasion.ca/r/4192" },
  {
    name: "calendar_link",
    label: "Calendar link",
    class: "open",
    sample: "occasion.ca/calendar",
  },

  // The four the red team named, and the reason this module has a class column
  // at all. Each is either a bearer credential or an identifier of a payment
  // instrument, and each is different for every recipient.
  {
    name: "payment_link",
    label: "Payment link",
    class: "restricted",
    sample: "occasion.ca/pay/••••",
  },
  {
    name: "verify_link",
    label: "Verification link",
    class: "restricted",
    sample: "occasion.ca/verify/••••",
  },
  { name: "card_last4", label: "Card", class: "restricted", sample: "•••• 4242" },
  {
    name: "bank_last4",
    label: "Bank account",
    class: "restricted",
    sample: "•••• 8841",
  },
];

const BY_NAME = new Map(MERGE_FIELDS.map((field) => [field.name, field]));

export function mergeField(name: string): MergeField | undefined {
  return BY_NAME.get(name);
}

export function isRestricted(name: string): boolean {
  return BY_NAME.get(name)?.class === "restricted";
}

/** The sample fill behind the preview, so an author reads a real-looking message. */
export function sampleValues(): Record<string, string> {
  return Object.fromEntries(MERGE_FIELDS.map((field) => [field.name, field.sample]));
}

/** `{{ first_name }}` with the spaces an author may type, or without them. */
const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Every token a body references, in the order it first appears. */
export function tokensIn(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(TOKEN)) {
    const name = match[1];
    if (name) seen.add(name);
  }
  return [...seen];
}

export { TOKEN as MERGE_TOKEN };

/**
 * Narrows a field name arriving from a form.
 *
 * A template's allowlist is written by an administrator, and a name that is not
 * in the catalogue would be an entry nothing can ever satisfy — a typo that
 * quietly becomes "this template may use a field that does not exist", which is
 * indistinguishable from a working allowlist until the first send fails.
 */
export function parseFieldName(value: unknown): string {
  if (typeof value !== "string" || !BY_NAME.has(value)) {
    throw new ValidationError(`\`${String(value)}\` is not a merge field this platform knows.`, {
      field: "unknown",
    });
  }
  return value;
}
