/**
 * Marker for an adapter method whose implementation has not landed yet.
 *
 * Deliberately throws instead of returning a plausible-looking value: a stub
 * that quietly answers "no user" or "sent" is the kind of fake that survives
 * into a demo and misleads whoever is watching.
 */
export function notImplemented(capability: string): never {
  throw new Error(`${capability} is not implemented yet.`);
}
