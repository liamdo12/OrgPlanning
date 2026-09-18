import type { ReactNode } from "react";
import { AppBackground } from "@occasion/ui";

/**
 * The one public group in an admin-first milestone.
 *
 * Themed as a customer, because the only page in it is one a customer opens
 * from an email. There is no session here and no navigation — somebody arriving
 * with a payment link has exactly one thing to do.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <AppBackground role="customer">{children}</AppBackground>;
}
