import { createHash } from "node:crypto";

/**
 * Deterministic UUIDs derived from a stable name.
 *
 * A reseed has to produce the same ids as the last one: fixtures, E2E specs and
 * bookmarked admin URLs all point at rows by id, and random ids would break
 * every one of them on each reset. This is UUID v5 (SHA-1, name-based) with a
 * fixed namespace.
 */

// A random but fixed namespace for this project's seed data.
const NAMESPACE = "6f9a1c2e-8d3b-4f57-9e21-0a7c4b5d6e8f";

function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex.replace(/-/g, ""), "hex");
}

export function seedId(name: string): string {
  const hash = createHash("sha1")
    .update(hexToBytes(NAMESPACE))
    .update(Buffer.from(name, "utf8"))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  // Version 5, RFC 4122 variant.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
