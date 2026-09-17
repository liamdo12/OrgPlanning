import type { ReactNode } from "react";
import { AppBackground } from "@occasion/ui";

/**
 * The ambient background behind every auth screen.
 *
 * Themed as a customer, which is what the prototype does: `authRole` starts at
 * `customer` (line 1888) and the signup chips choose from there. Someone
 * signing in has no role yet as far as this application is concerned — the
 * actor is built after the session exists, not before it.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AppBackground role="customer">{children}</AppBackground>;
}
