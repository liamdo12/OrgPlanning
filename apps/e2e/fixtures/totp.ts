import { createHmac } from "node:crypto";

/**
 * A time-based one-time code, the way an authenticator app computes one.
 *
 * Fifteen lines of RFC 6238 rather than a dependency, and written out because
 * the alternative was a suite that could not test the second factor at all. The
 * provider's defaults — SHA-1, six digits, a thirty-second step — are what an
 * authenticator app assumes, and they are not configurable here.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, which is how the provider hands out the shared secret. */
function decodeBase32(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const character of cleaned) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error(`"${character}" is not base32; is this really the secret?`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

export function totp(secret: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / 30);

  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);

  return (binary % 1_000_000).toString().padStart(6, "0");
}

/**
 * Milliseconds until the current code expires.
 *
 * A code entered in the last moment of its window is checked in the next one,
 * and the provider refuses it. That is correct, and it is a flake in a suite
 * that types fast.
 */
export function msLeftInStep(at: Date = new Date()): number {
  return 30_000 - (at.getTime() % 30_000);
}
