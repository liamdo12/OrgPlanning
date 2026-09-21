"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, GlassPanel } from "@occasion/ui";

/**
 * When a customer screen throws, inside the shell and with a way out.
 *
 * Without this boundary a thrown domain error renders Next's own default page,
 * outside the shell and with no recovery affordance — on the highest-value
 * screen in the product, which is the checkout. "A capacity clash surfaces as a
 * typed error naming the date" would be true at the domain layer and invisible
 * to the person it happened to.
 *
 * Domain errors carry a message written for the person reading it, so that one
 * is shown. Everything else does not — a driver message or a stack frame is
 * neither useful nor safe — so anything unrecognised gets the general sentence
 * and the digest, which is how the instance is found in the log.
 *
 * The recovery path is two things, not one: `reset()` for a query that failed
 * once, and a link away for the case where it will fail again. An error screen
 * whose only control retries is a dead end for the second case.
 */

/**
 * The errors whose messages are safe to show.
 *
 * Matched on `name` rather than with `instanceof`: this is a client component,
 * and what reaches it is a serialised error with the class gone. Keeping the
 * list explicit is also what stops a future domain error being shown by
 * accident before anyone has read its wording.
 */
const SPEAKS_FOR_ITSELF = new Set([
  "ValidationError",
  "CapacityConflictError",
  "NotFoundError",
  "RateLimitedError",
]);

export default function CustomerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is how this instance is found in the server log, where the
    // real message already is.
    console.error("customer screen failed", error.digest ?? error.message);
  }, [error]);

  const spoken = SPEAKS_FOR_ITSELF.has(error.name) ? error.message : undefined;

  return (
    <GlassPanel as="section" className="p-8" role="alert">
      <h1 className="m-0 font-display text-[clamp(22px,3vw,30px)] font-normal">
        That did not work.
      </h1>
      <p className="mt-2 mb-0 max-w-[60ch] text-[14px] text-pretty text-ink">
        {spoken ??
          "Something failed on the way to this screen. Trying again is usually enough; if it is not, nothing you had booked has changed."}
      </p>

      {error.digest ? (
        <p className="mt-3 mb-0 font-mono text-[12.5px] text-body">Reference {error.digest}</p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button intent="primary" onClick={reset}>
          Try again
        </Button>
        <Link href="/" className="oc-button oc-button--ghost oc-button--md">
          Back to Explore
        </Link>
      </div>
    </GlassPanel>
  );
}
