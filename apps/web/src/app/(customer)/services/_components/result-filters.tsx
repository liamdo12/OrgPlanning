"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Checkbox, FilterBar, FilterChip } from "@occasion/ui";

/**
 * The category tabs and the filter panel. Lines 675 and 693–713.
 *
 * Client components for one reason, which is the repository's shipped filter
 * pattern: **their only state is a router push.** The narrowing itself lives
 * in the URL, the page re-renders on the server with it applied, and the back
 * button does what it looks like it does.
 *
 * Every change drops the cursor. A cursor names the last row of a page of the
 * *previous* list, so replaying it against a new filter starts partway through
 * a list nobody has seen the beginning of.
 *
 * Nothing here imports `@occasion/core` as a value. The price labels arrive
 * already formatted, from the server, because there is one money formatter in
 * the repository and it lives on the other side of this boundary — a second
 * one written in a component is how two screens come to disagree about a
 * figure.
 */

function usePushFilters() {
  const router = useRouter();
  const params = useSearchParams();

  return (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("cursor");
    const query = next.toString();
    router.push(query ? `/services?${query}` : "/services", { scroll: false });
  };
}

export type CategoryTab = { slug: string; name: string };

/**
 * Line 2330: the tab row is the categories *including* "All", where the home
 * page's tiles (line 2328) are the same list without it. "All" is the absence
 * of `cat` from the URL rather than a value, so a shared link carries no
 * parameter naming a category that is not one.
 */
export function CategoryTabs({
  categories,
  active,
}: {
  categories: readonly CategoryTab[];
  active: string | undefined;
}) {
  const push = usePushFilters();

  return (
    <FilterBar aria-label="Filter services by category" className="mb-[14px] gap-[6px]">
      <FilterChip active={active === undefined} onSelect={() => push((next) => next.delete("cat"))}>
        All
      </FilterChip>
      {categories.map((category) => (
        <FilterChip
          key={category.slug}
          active={active === category.slug}
          onSelect={() => push((next) => next.set("cat", category.slug))}
        >
          {category.name}
        </FilterChip>
      ))}
    </FilterBar>
  );
}

export function ResultFilters({
  bookingMode,
  modes,
  maxPrice,
  priceLabels,
  priceStep,
  topRated,
  topRatedValue,
}: {
  bookingMode: string | undefined;
  modes: ReadonlyArray<{ value: string; label: string }>;
  /** In cents, or absent for no cap. */
  maxPrice: number | undefined;
  /**
   * One label per step, formatted on the server: `priceLabels[n]` is the label
   * for `n * priceStep` cents. An index is not a price, which is what keeps
   * this component free of money arithmetic.
   */
  priceLabels: readonly string[];
  priceStep: number;
  topRated: boolean;
  topRatedValue: number;
}) {
  const push = usePushFilters();
  const steps = priceLabels.length - 1;
  const position = maxPrice === undefined ? steps : Math.round(maxPrice / priceStep);

  return (
    <div className="mb-[16px] grid gap-[18px] rounded-panel p-[18px] oc-glass [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
      <fieldset className="m-0 border-0 p-0">
        <legend className="oc-label">Booking mode</legend>
        {modes.map((mode) => (
          <Checkbox
            key={mode.value}
            id={`mode-${mode.value}`}
            className="py-[4px]"
            label={mode.label}
            checked={bookingMode === mode.value}
            onChange={(event) =>
              push((next) => {
                // Two checkboxes over one parameter: the canvas draws a pair
                // and the query takes one value, so ticking the second unticks
                // the first and unticking both means no filter at all.
                if (event.currentTarget.checked) next.set("mode", mode.value);
                else next.delete("mode");
              })
            }
          />
        ))}
      </fieldset>

      <div>
        <label htmlFor="max-price" className="oc-label">
          Price per unit
        </label>
        <input
          id="max-price"
          type="range"
          min={1}
          max={steps}
          step={1}
          // Uncontrolled and keyed on what is applied: the URL is the source of
          // truth, so the thumb has to follow a back navigation or a cleared
          // filter, and a remount does that without an effect racing the drag.
          key={position}
          defaultValue={position}
          aria-describedby="max-price-value"
          className="w-full accent-role"
          // On release, not on every pixel of the drag: `onChange` fires for
          // each intermediate value, and pushing each one would put fifty
          // entries in the history for one gesture.
          onPointerUp={(event) => commit(push, event.currentTarget, steps, priceStep)}
          onKeyUp={(event) => commit(push, event.currentTarget, steps, priceStep)}
        />
        <p id="max-price-value" className="mt-[4px] mb-0 text-[13.5px] text-body">
          {priceLabels[position] ?? priceLabels[steps]}
        </p>
      </div>

      <fieldset className="m-0 border-0 p-0">
        <legend className="oc-label">Rating</legend>
        <Checkbox
          id="top-rated"
          className="py-[4px]"
          label={`${topRatedValue} and above`}
          checked={topRated}
          onChange={(event) =>
            push((next) => {
              if (event.currentTarget.checked) next.set("rating", String(topRatedValue));
              else next.delete("rating");
            })
          }
        />
      </fieldset>
    </div>
  );
}

/**
 * Writes the slider's position back to the URL, in cents.
 *
 * The top of the range is "no cap" rather than a cap nothing exceeds: a
 * listing priced above the slider's ceiling must not disappear because
 * somebody dragged to the end.
 */
function commit(
  push: (mutate: (next: URLSearchParams) => void) => void,
  input: HTMLInputElement,
  steps: number,
  priceStep: number,
) {
  const position = Number(input.value);

  push((next) => {
    if (position >= steps || position <= 0) next.delete("max");
    else next.set("max", String(position * priceStep));
  });
}
