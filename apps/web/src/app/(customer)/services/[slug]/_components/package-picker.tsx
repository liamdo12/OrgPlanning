"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cx } from "@occasion/ui";

/**
 * The tiers a listing is sold in. Lines 784–796.
 *
 * Radio semantics rather than a row of buttons: exactly one is chosen, and a
 * screen reader should say "2 of 3" rather than read three unrelated toggles.
 * The canvas draws a hollow dot that fills when selected, which is a radio
 * wearing different clothes.
 *
 * The choice goes into the URL, because the deposit and the balance beside it
 * are computed on the server by the function the checkout itself uses. A
 * picker holding its own state would need a second pricing path in the browser
 * to keep those figures honest.
 *
 * `replace`, not `push`: choosing a package is not somewhere you navigated to,
 * and Back should leave the listing rather than step through four tiers.
 *
 * **The canvas's three tiers are computed** — 1× / 1.53× / 2.32×, rounded to
 * five dollars (lines 2062–2069) — because it has no package data. These are
 * the rows a vendor actually wrote, so a listing with one tier draws one and a
 * listing with none is priced at its base price with no picker at all.
 */
export function PackagePicker({
  slug,
  packages,
  selectedId,
}: {
  slug: string;
  /** Prices already formatted: money is formatted once, on the server. */
  packages: ReadonlyArray<{
    id: string;
    name: string;
    description: string | null;
    priceLabel: string;
  }>;
  selectedId: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function select(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("pkg", id);
    router.replace(`/services/${slug}?${next.toString()}`, { scroll: false });
  }

  return (
    <div role="radiogroup" aria-label="Packages" className="grid gap-[10px]">
      {packages.map((tier) => {
        const selected = tier.id === selectedId;

        return (
          <button
            key={tier.id}
            type="button"
            role="radio"
            aria-checked={selected}
            // Roving tabindex, which is what a radio group is: Tab reaches the
            // group once and lands on the chosen option.
            tabIndex={selected ? 0 : -1}
            onClick={() => select(tier.id)}
            className={cx(
              "flex cursor-pointer items-center gap-[12px] rounded-[18px] border-[1.5px] p-[15px] text-left",
              selected ? "border-role bg-role-tint" : "border-glass-edge-soft bg-chip",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "size-[18px] flex-none rounded-pill border-[1.5px]",
                selected ? "border-role bg-role" : "border-glass-edge-soft bg-transparent",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold">{tier.name}</span>
              {tier.description ? (
                <span className="block text-[13.5px] text-body">{tier.description}</span>
              ) : null}
            </span>
            <span className="text-[15px] font-bold whitespace-nowrap">{tier.priceLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
