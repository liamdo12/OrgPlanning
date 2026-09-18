import { ValidationError } from "../errors.js";
import { hashToken, mintToken } from "../tokens.js";

/**
 * The tokens that go in emails.
 *
 * An emailed URL must never carry a domain id. `/pay/4192` is a link that can
 * be walked: change the number and you are looking at somebody else's booking,
 * and nothing about the URL suggests to the person doing it that they have done
 * anything unusual. So the link carries an opaque token instead, and the token
 * is the only thing that resolves to an order.
 *
 * Three properties, all of which are the point:
 *
 * - **Unguessable.** 128 bits from the platform's CSPRNG, base64url. A counter,
 *   a hash of the order id, or anything derived from data an attacker can see
 *   would be a longer way of writing the id.
 * - **Expiring.** A link that outlives the grace window is a way to pay a
 *   balance on an order that was cancelled for not paying it.
 * - **Single-use.** Consumed on the first successful payment, which is enforced
 *   by the update that spends it rather than by a check beforehand.
 *
 * Stored as a hash, like an admin invitation: the plaintext exists in the email
 * and nowhere else, so reading the table gives you links you cannot use.
 */

/** 16 bytes: 128 bits, which is past anything guessable at any rate. */
const TOKEN_BYTES = 16;

/** The secret for the email, and the digest for the row. */
export function mintPaymentLinkToken(): { token: string; digest: string } {
  const token = mintToken(TOKEN_BYTES);
  return { token, digest: hashToken(token) };
}

/** What a token off the wire is looked up as. */
export function paymentLinkDigest(token: string): string {
  return hashToken(token);
}

/**
 * Narrows a token off the wire.
 *
 * Length and alphabet only — a token is checked against the database, not
 * parsed. What this stops is a token-shaped parameter reaching a query as
 * something other than the base64url it claims to be.
 */
export function parsePaymentLinkToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(value)) {
    throw new ValidationError("That payment link is not valid.", { token: "invalid" });
  }
  return value;
}

export type PaymentLinkState = "payable" | "expired" | "consumed" | "unknown";

/**
 * What a link is good for right now.
 *
 * Every answer that is not `payable` is shown to a visitor as the same 404.
 * Telling somebody a link has *expired* rather than never existed confirms that
 * the token was once real, and a token that was once real names an order.
 */
export function paymentLinkState(
  link: { expiresAt: Date; consumedAt: Date | null } | undefined,
  now: Date,
): PaymentLinkState {
  if (!link) return "unknown";
  if (link.consumedAt) return "consumed";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "payable";
}
