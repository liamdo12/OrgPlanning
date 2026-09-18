import { createHash, randomBytes } from "node:crypto";

/**
 * Secrets that travel in a URL.
 *
 * Two kinds of link leave this platform carrying authority — an admin
 * invitation and a payment link — and both follow the same rule: the secret is
 * minted here, never accepted from a caller, and only its hash is stored. A
 * read-only leak of either table must not hand somebody the capability the
 * table describes.
 *
 * Keeping the pair in one module rather than one per caller is what stops the
 * second one being written with a shorter token or a plaintext column, which is
 * the ordinary way this rule stops being true.
 */

/** Hex SHA-256. What is stored, and what a lookup matches on. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A URL-safe secret.
 *
 * @param bytes  entropy. 16 is 128 bits, past anything guessable at any rate an
 *               HTTP endpoint could be asked at; an invitation uses 32 because
 *               what it opens is an administrator account.
 */
export function mintToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}
