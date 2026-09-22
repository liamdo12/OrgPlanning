"use client";

import { useState } from "react";
import { Dialog } from "@occasion/ui";
import { MediaPlaceholder } from "../../../_components/media-placeholder";

/**
 * The gallery the strip's count tile opens. Line 766.
 *
 * The canvas draws "+8 photos" as a label with nothing behind it. A count that
 * is not a control is a promise the screen does not keep, so here it is a
 * button, it says what it opens, and focus comes back to it when the gallery
 * closes.
 *
 * **It composes `Dialog` and adds nothing to it.** Escape, the focus return
 * and the containment all come from `useDismissable`, which is the only
 * implementation of those in the repository and pays for two bugs found once.
 * What is added here is paging: the arrow keys move between pictures, which is
 * behaviour the dialog has no opinion about.
 *
 * It ships at the design system's dialog width. Widening it from `className`
 * is the trap `Swatch` documents — `cx` is a plain join with no
 * `tailwind-merge`, so a second `max-w-*` wins or loses by source order — and a
 * full-bleed viewer is a change to the shared component rather than to this
 * screen.
 */

export type Photo = {
  id: string;
  url: string;
  altText: string | null;
};

export function PhotoLightbox({
  photos,
  serviceTitle,
  toneStart,
  toneEnd,
  label,
  className,
}: {
  photos: readonly Photo[];
  serviceTitle: string;
  toneStart: string | null;
  toneEnd: string | null;
  /** What the trigger reads, e.g. "+8 photos". */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const showing = photos[index];
  const count = photos.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open all ${count} ${count === 1 ? "picture" : "pictures"} of ${serviceTitle}`}
        className={className}
      >
        {label}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Pictures of ${serviceTitle}`}
        footer={
          <p className="m-0 mr-auto text-[13px] text-body">
            {index + 1} of {count}
          </p>
        }
      >
        <div
          // The arrow keys only. Anything cycling Tab by hand here would be a
          // second focus trap, and the dialog already has the one.
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            setIndex((at) => (at + (event.key === "ArrowRight" ? 1 : -1) + count) % count);
          }}
        >
          <div className="relative aspect-[16/10] overflow-hidden rounded-panel">
            {showing ? (
              <img
                src={showing.url}
                alt={showing.altText ?? `${serviceTitle}, picture ${index + 1} of ${count}`}
                className="size-full object-contain"
              />
            ) : (
              <MediaPlaceholder toneStart={toneStart} toneEnd={toneEnd} />
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {photos.map((photo, at) => (
              <button
                key={photo.id}
                type="button"
                aria-current={at === index ? "true" : undefined}
                aria-label={`Show picture ${at + 1} of ${count}`}
                onClick={() => setIndex(at)}
                className="oc-chip min-h-[44px] px-3"
              >
                {at + 1}
              </button>
            ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}
