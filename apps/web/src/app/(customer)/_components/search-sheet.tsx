"use client";

import { useId, useState } from "react";
import { SearchOption, SearchPanelGroup, Stepper, cx, useDismissable } from "@occasion/ui";
import { MonthGrid } from "./month-grid";
import {
  ANY_AREA,
  ANY_CATEGORY,
  GUESTS_MAX,
  GUESTS_MIN,
  GUESTS_STEP,
  GUEST_PRESETS,
  SEARCH_AREAS,
  SEARCH_CATEGORIES,
  type SearchSelection,
} from "../_config/search";

/**
 * The header's search panel: four fields, one submission.
 *
 * A new overlay rather than `Sheet`, for a reason that is structural and not
 * cosmetic. `.oc-scrim` is `z-index: 60` and covers the viewport; the
 * prototype's search scrim is **30** (line 462), *below* the header at 40,
 * because the header stays visible and interactive above it — the pill you are
 * editing is part of the header. `Sheet` also anchors to an edge, and this
 * hangs under the header (line 257).
 *
 * The **focus trap is not new**. `useDismissable` is the one implementation in
 * the repository and it already pays for two bugs a second copy would
 * re-introduce: the close callback held in a ref, so the Where field does not
 * lose its caret on every keystroke, and hidden inputs excluded from the
 * focusable query. The Where field is exactly the controlled input that bug
 * was about, so this is not hypothetical.
 *
 * All of the state here is draft state. Nothing is applied until Search is
 * pressed, and what Search does is navigate — the URL is the search, and this
 * panel is a way of writing one.
 *
 * **Mounted only while open**, rather than rendering `null` when it is not.
 * That is what makes the draft start from the URL every time without an effect
 * copying one into the other: closing unmounts the state, and opening seeds it
 * from `selection` afresh. A panel that remembered an abandoned edit would be a
 * control disagreeing with the page behind it.
 */

export type SearchPanelKey = "what" | "where" | "when" | "guests";

export function SearchSheet({
  /** Which field was clicked, or every panel when the compact button opened it. */
  field,
  selection,
  today,
  onClose,
  onSubmit,
}: {
  field: SearchPanelKey | "all";
  selection: SearchSelection;
  today: string;
  onClose: () => void;
  onSubmit: (next: SearchSelection) => void;
}) {
  const [draft, setDraft] = useState<SearchSelection>(selection);
  const headingId = useId();
  // Always open: this component exists only while it is.
  const surface = useDismissable(true, onClose);

  const shows = (panel: SearchPanelKey) => field === "all" || field === panel;
  const patch = (next: Partial<SearchSelection>) =>
    setDraft((current) => ({ ...current, ...next }));

  return (
    <>
      {/*
       * Line 462: fixed, and at 30 — under the header's 40. Clicking it closes
       * the panel, which is why it is a button rather than a div with a
       * handler: a div is unreachable from a keyboard, and Escape is the only
       * other way out.
       */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onMouseDown={onClose}
        className="fixed inset-0 z-30 cursor-default border-0 bg-[rgb(31_42_36/0.28)]"
      />

      <div className="absolute inset-x-0 top-[calc(100%+9px)] z-[45]">
        <div
          ref={surface}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          tabIndex={-1}
          className="oc-overlay-surface max-h-[calc(100vh-120px)] min-w-[min(540px,calc(100vw-28px))] overflow-x-hidden overflow-y-auto motion-safe:animate-rise"
        >
          <h2 id={headingId} className="sr-only">
            Search services
          </h2>

          {/* Line 259: the panel's own 1240px column and the header's gutter. */}
          <div className="mx-auto grid max-w-[1240px] gap-5 px-[clamp(14px,3.5vw,32px)] pt-[18px] pb-5">
            {shows("what") ? (
              <SearchPanelGroup legend="What do you need">
                <div className="flex flex-wrap gap-2">
                  <SearchOption
                    label={ANY_CATEGORY}
                    selected={!draft.cat}
                    onSelect={() => patch({ cat: undefined })}
                  />
                  {SEARCH_CATEGORIES.map((category) => (
                    <SearchOption
                      key={category.slug}
                      label={category.name}
                      selected={draft.cat === category.slug}
                      onSelect={() => patch({ cat: category.slug })}
                    />
                  ))}
                </div>
              </SearchPanelGroup>
            ) : null}

            {shows("where") ? (
              <WherePanel value={draft.where} onChange={(where) => patch({ where })} />
            ) : null}

            {shows("when") ? (
              <SearchPanelGroup legend="When is the event">
                <MonthGrid
                  value={draft.when}
                  today={today}
                  onSelect={(when) => patch({ when, ...(when ? {} : { flex: false }) })}
                  flexible={draft.flex === true}
                  onFlexibleChange={(flex) => patch({ flex })}
                />
              </SearchPanelGroup>
            ) : null}

            {shows("guests") ? (
              <SearchPanelGroup legend="How many guests">
                <div className="mb-3 flex flex-wrap items-center gap-[14px]">
                  <Stepper
                    label="Guests"
                    decrementLabel="Fewer guests"
                    incrementLabel="More guests"
                    value={draft.guests ?? GUEST_PRESETS[1] ?? GUESTS_MIN}
                    min={GUESTS_MIN}
                    max={GUESTS_MAX}
                    step={GUESTS_STEP}
                    onChange={(guests) => patch({ guests })}
                  />
                  <p className="m-0 text-[13.5px] text-body">
                    Vendors use this to size their quotes.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {GUEST_PRESETS.map((count) => (
                    <SearchOption
                      key={count}
                      label={`${count} guests`}
                      selected={draft.guests === count}
                      onSelect={() => patch({ guests: count })}
                    />
                  ))}
                </div>
              </SearchPanelGroup>
            ) : null}

            {/* Line 374. */}
            <div className="flex flex-wrap items-center gap-[10px] border-t border-hairline pt-4">
              <button
                type="button"
                onClick={() => setDraft({})}
                className="cursor-pointer border-0 bg-transparent px-1 py-3 text-[14px] font-semibold text-body"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={onClose}
                className="oc-button oc-button--ghost ml-auto rounded-card px-5 py-[13px] text-[14px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onSubmit(draft)}
                className="oc-button oc-button--primary rounded-card px-6 py-[13px] text-[14.5px]"
              >
                {field === "all" ? "Search" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Where, with a typeahead over the areas and the popular grid below it.
 *
 * Matching is the prototype's own (lines 1937–1944): anything starting with
 * what was typed first, then anything merely containing it, so "west" offers
 * West End before Liberty Village.
 */
function WherePanel({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const fieldId = useId();
  const typed = query.trim().toLowerCase();

  const matches = typed
    ? [
        ...SEARCH_AREAS.filter((area) => area.name.toLowerCase().startsWith(typed)),
        ...SEARCH_AREAS.filter(
          (area) =>
            !area.name.toLowerCase().startsWith(typed) && area.name.toLowerCase().includes(typed),
        ),
      ]
    : [];

  return (
    <SearchPanelGroup legend="Where is the event">
      <div className="mb-3 max-w-[460px]">
        {/* The prototype's placeholder is the only label it has (line 305); a
            placeholder disappears the moment anyone types, so the field gets a
            real one and keeps the placeholder as the example it is. */}
        <label htmlFor={fieldId} className="sr-only">
          Search neighbourhoods
        </label>
        <input
          id={fieldId}
          type="search"
          className="oc-input"
          placeholder="Type a neighbourhood"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {typed ? (
        matches.length > 0 ? (
          <div className="grid max-w-[460px] gap-[2px]">
            {matches.map((area) => (
              <button
                key={area.slug}
                type="button"
                onClick={() => {
                  onChange(area.slug);
                  setQuery("");
                }}
                className={cx(
                  "flex w-full cursor-pointer items-center gap-3 rounded-tile border-0 px-3 py-[11px] text-left text-[14px] font-semibold",
                  value === area.slug ? "bg-role-tint" : "bg-transparent",
                )}
              >
                {area.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-[13.5px] text-body">
            Nothing matches in Toronto. Try a neighbourhood like Liberty Village.
          </p>
        )
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2">
          <SearchOption
            label={ANY_AREA}
            selected={!value}
            onSelect={() => onChange(undefined)}
            className="rounded-card text-left"
          />
          {SEARCH_AREAS.map((area) => (
            <SearchOption
              key={area.slug}
              label={area.name}
              selected={value === area.slug}
              onSelect={() => onChange(area.slug)}
              className="rounded-card text-left"
            />
          ))}
        </div>
      )}
    </SearchPanelGroup>
  );
}
