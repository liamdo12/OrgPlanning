import Link from "next/link";
import { cx } from "@occasion/ui";
import { toggleSavedAction } from "../services/actions";

/**
 * The heart on a card. Line 738.
 *
 * Two shapes, because two different things happen. For somebody signed in it
 * is a toggle — a submit button carrying `aria-pressed`, in a form that calls
 * the action. For a visitor it is a **link** to the login screen, which comes
 * back to the listing: `aria-pressed` on something that navigates is a lie
 * about what pressing it does, and there is no saved state to report for
 * somebody with no account.
 *
 * The name says which service. Twelve buttons reading "Save service" — the
 * canvas's own label — name none of them, and a screen reader moving by
 * control hears the same three words a dozen times.
 *
 * The canvas's 32px circle (line 738) is the **visual**. The control is 44px,
 * padded around it, because a 32px target is one people miss.
 */
export function SaveHeart({
  serviceId,
  serviceSlug,
  serviceTitle,
  saved,
  signedIn,
  className,
}: {
  serviceId: string;
  serviceSlug: string;
  serviceTitle: string;
  saved: boolean;
  signedIn: boolean;
  className?: string;
}) {
  if (!signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/services/${serviceSlug}`)}`}
        aria-label={`Sign in to save ${serviceTitle}`}
        className={cx(HIT_AREA, "no-underline hover:no-underline", className)}
      >
        <Glyph saved={false} />
      </Link>
    );
  }

  return (
    <form action={toggleSavedAction} className={cx("contents", className)}>
      <input type="hidden" name="serviceId" value={serviceId} />
      <button
        type="submit"
        aria-pressed={saved}
        aria-label={saved ? `Saved — ${serviceTitle}` : `Save ${serviceTitle}`}
        className={cx(HIT_AREA, "cursor-pointer border-0 bg-transparent p-0")}
      >
        <Glyph saved={saved} />
      </button>
    </form>
  );
}

/**
 * 44px of control around the 32px the canvas draws.
 *
 * Offset by 3px so the visible circle lands on the canvas's own 9px inset
 * rather than 3px further in.
 */
const HIT_AREA = "absolute top-[3px] right-[3px] grid size-[44px] place-items-center";

function Glyph({ saved }: { saved: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        // Line 738: a 32px round chip in the page's own paper at 55%.
        "grid size-[32px] place-items-center rounded-pill bg-[rgb(250_247_242/0.55)] text-[15px] leading-none",
        saved ? "text-save" : "text-body",
      )}
    >
      {saved ? "♥" : "♡"}
    </span>
  );
}
