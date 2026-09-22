"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * The sort control. Lines 684–689.
 *
 * A native select styled as a pill, named by `aria-label` because the canvas
 * gives it no visible label and the options say what it is ("Sort: …").
 *
 * The canvas offers a fourth order, "Response time" (line 688). There is no
 * response-time column and no record of message latency to derive one from, so
 * it is not offered rather than offered and ignored.
 *
 * Changing the order drops the cursor: a keyset cursor is a position in one
 * ordering, and the domain answers the first page for a cursor from another —
 * so keeping it would silently lose a page rather than fail.
 */
export function ResultSort({
  sort,
  choices,
}: {
  sort: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <select
      aria-label="Sort results"
      value={sort}
      onChange={(event) => {
        const next = new URLSearchParams(params.toString());
        next.set("sort", event.currentTarget.value);
        next.delete("cursor");
        router.push(`/services?${next.toString()}`, { scroll: false });
      }}
      className="oc-glass cursor-pointer appearance-none rounded-pill border border-glass-edge-soft px-[15px] py-[8px] text-[13.5px] font-semibold"
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}
