"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchButton, SearchPill as Pill } from "@occasion/ui";
import { SearchSheet, type SearchPanelKey } from "./search-sheet";
import {
  ANY_AREA,
  ANY_CATEGORY,
  SEARCH_AREAS,
  SEARCH_CATEGORIES,
  formatSearchDate,
  nameOf,
  readSearch,
  searchToQuery,
  type SearchSelection,
} from "../_config/search";

/**
 * The header's search control, in whichever form fits.
 *
 * Two of them, at the prototype's own widths: the four-segment pill at
 * `S.vw >= 1080` and the compact button below it (lines 2320–2321). Both open
 * the same panel and submit the same way, which is why they are one component
 * — two controls with two submissions is two places for the URL to be built
 * differently.
 *
 * The swap is CSS, not JavaScript. Measuring the viewport in an effect would
 * render the wrong control on the server and correct it after hydration, which
 * is a visible jump on every load; `wide:` is the token that exists for this.
 *
 * **It holds no search state.** Everything shown is read back out of the URL,
 * and pressing Search navigates. A pill with its own copy of the search is a
 * control that can show a filter the results below it did not apply.
 *
 * The URL is read here rather than passed down, because a layout is not given
 * `searchParams` — and it is the layout that draws the header. The reader is
 * the same one the results screen uses, so the two cannot disagree about which
 * values a URL contains.
 */
export function SearchPill({ today }: { today: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [field, setField] = useState<SearchPanelKey | "all" | undefined>(undefined);

  const selection = useMemo(() => readSearch(params), [params]);

  const submit = (next: SearchSelection) => {
    setField(undefined);
    router.push(`/services${searchToQuery(next)}`);
  };

  const category = nameOf(SEARCH_CATEGORIES, selection.cat, ANY_CATEGORY);
  const area = nameOf(SEARCH_AREAS, selection.where, ANY_AREA);
  const guests = selection.guests == null ? "Any" : String(selection.guests);

  return (
    // The panel is positioned against this, so it stays under the header and
    // inside the header's own column rather than against the viewport.
    //
    // `flex: 1 1 260px`, line 225 — the basis is what makes that true at a
    // phone width. With a basis of zero this box shrinks to whatever the header
    // row has left, which is 95px at 360, while the panel hanging off it keeps
    // its own 332px minimum: the panel then started at the control's left edge
    // and ran 109px past the right edge of the screen, taking two columns of
    // the calendar with it. At 260 the row wraps instead, the search control
    // takes a line of its own, and the panel lands inside the gutter.
    <div className="relative flex min-w-0 flex-[1_1_260px]">
      {/*
       * The swap is on wrappers rather than on the controls themselves: both
       * carry `flex` of their own, and two display utilities on one element are
       * settled by Tailwind's stylesheet order rather than by the order they
       * were written in.
       */}
      <div className="hidden min-w-0 flex-1 wide:flex">
        <Pill
          activeKey={field === "all" ? undefined : field}
          onSubmit={() => submit(selection)}
          segments={[
            {
              key: "what",
              label: "What",
              value: category,
              grow: true,
              onOpen: () => setField("what"),
            },
            { key: "where", label: "Where", value: area, onOpen: () => setField("where") },
            {
              key: "when",
              label: "When",
              value: formatSearchDate(selection.when),
              onOpen: () => setField("when"),
            },
            { key: "guests", label: "Guests", value: guests, onOpen: () => setField("guests") },
          ]}
        />
      </div>

      <div className="flex min-w-0 flex-1 wide:hidden">
        <SearchButton
          value={category}
          summary={`${area} · ${formatSearchDate(selection.when)} · ${guests} guests`}
          expanded={field !== undefined}
          onOpen={() => setField((current) => (current === undefined ? "all" : undefined))}
        />
      </div>

      {/* Mounted only while open, so its draft starts from the URL each time
          rather than from an edit somebody walked away from. */}
      {field !== undefined ? (
        <SearchSheet
          field={field}
          selection={selection}
          today={today}
          onClose={() => setField(undefined)}
          onSubmit={submit}
        />
      ) : null}
    </div>
  );
}
