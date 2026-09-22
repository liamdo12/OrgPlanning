"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Stepper } from "@occasion/ui";

/**
 * The two controls on the booking card that are not the package picker.
 *
 * Both write to the URL, for the reason the picker does: the subtotal, the tax
 * and the deposit beside them are produced on the server by the function the
 * checkout itself runs, so a quantity held in component state would either
 * need a second pricing path or leave five figures describing a quantity
 * nobody has any more.
 *
 * `replace` rather than `push`: a quantity is not a place you navigated to.
 * With `push`, Back counts down one arrangement at a time instead of leaving
 * the listing.
 */

function useSelect(slug: string) {
  const router = useRouter();
  const params = useSearchParams();

  return (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`/services/${slug}?${next.toString()}`, { scroll: false });
  };
}

export function QuantityControl({
  slug,
  quantity,
  max,
  unit,
}: {
  slug: string;
  quantity: number;
  max: number;
  /** What is being counted, e.g. "bouquet", so the control names itself. */
  unit: string;
}) {
  const select = useSelect(slug);

  return (
    <Stepper
      value={quantity}
      min={1}
      max={max}
      label={`How many, in ${unit}s`}
      decrementLabel="One fewer"
      incrementLabel="One more"
      onChange={(next) => select("qty", String(next))}
    />
  );
}

export function ArrivalSelect({
  slug,
  arrivalTime,
  options,
}: {
  slug: string;
  arrivalTime: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const select = useSelect(slug);

  return (
    <select
      id="arrival-time"
      value={arrivalTime ?? ""}
      onChange={(event) => select("arrive", event.currentTarget.value)}
      className="h-[44px] w-full cursor-pointer appearance-none rounded-card border border-glass-edge-soft bg-field px-[12px] text-[14.5px] font-semibold"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
