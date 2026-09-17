"use client";

import { useEffect } from "react";
import { Button, GlassPanel } from "@occasion/ui";

/**
 * When a screen throws.
 *
 * Deliberately says nothing about what went wrong: an admin screen's errors are
 * database messages and stack frames, and neither belongs in front of anyone.
 *
 * Authorization refusals do not arrive here from a page — `requireAdminPage()`
 * redirects — but a server action's do, and "Not permitted." is not a sentence
 * to show someone whose session simply expired.
 *
 * `reset()` re-renders the segment, which is the right first move for the
 * common case: a query that failed once.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is how this instance is found in the server logs, where the
    // real message already is.
    console.error("admin screen failed", error.digest ?? error.message);
  }, [error]);

  return (
    <GlassPanel as="section" className="p-8" role="alert">
      <h1 className="m-0 font-display text-[clamp(22px,3vw,30px)] font-normal">
        That did not load.
      </h1>
      <p className="mt-2 mb-0 max-w-[60ch] text-[14px] text-pretty text-ink">
        Something failed on the way to this screen. Trying again is usually enough; if it is not,
        the details are in the server log.
      </p>

      {error.digest ? (
        <p className="mt-3 mb-0 font-mono text-[12.5px] text-body">Reference {error.digest}</p>
      ) : null}

      <div className="mt-6">
        <Button intent="primary" onClick={reset}>
          Try again
        </Button>
      </div>
    </GlassPanel>
  );
}
