"use client";

import { useRef, useState } from "react";
import { cx } from "@occasion/ui";
import { MediaPlaceholder } from "./media-placeholder";
import { carouselFrames, pageIndex, showsDots, type CarouselImage } from "./service-card-media";

/**
 * The card's media block, as a pager.
 *
 * The canvas draws three dots (lines 724–728) over a gradient, and they are
 * inert `<span>`s: there is nothing to page through and nothing to press. Here
 * they are real controls, which is why the media block is no longer inside the
 * card's link — a surface that handles gestures cannot also be a navigation
 * target. The title carries the link instead.
 *
 * **It has to degrade twice**, and the state it ships into is the first one:
 * `service_media` holds no rows today, so every card renders one gradient
 * frame and no dots. A listing with a single picture renders that picture and
 * no dots. Dots appear from two frames up — three dots over one image is the
 * failure the canvas's inert version already is.
 */

/** Below this a drag is a tap that wandered, not a swipe. */
const SWIPE_THRESHOLD = 40;

export function ServiceCardCarousel({
  media,
  toneStart,
  toneEnd,
  caption,
  serviceTitle,
  className,
}: {
  media: readonly CarouselImage[];
  toneStart: string | null;
  toneEnd: string | null;
  /** The placeholder's own label, e.g. "Flowers photo". */
  caption: string;
  /** Names the pictures and the dots, so twelve cards do not all say "picture". */
  serviceTitle: string;
  className?: string;
}) {
  const frames = carouselFrames(media);
  const [index, setIndex] = useState(0);
  const dots = useRef<Array<HTMLButtonElement | null>>([]);
  const dragFrom = useRef<number | null>(null);

  const showing = frames[Math.min(index, frames.length - 1)];
  const withDots = showsDots(frames.length);

  function select(next: number, moveFocus: boolean) {
    const wrapped = pageIndex(next, 0, frames.length);
    setIndex(wrapped);
    // Roving tabindex: the selected dot is the one Tab reaches, so the arrow
    // keys have to carry focus with them or the next Tab starts from the top.
    if (moveFocus) dots.current[wrapped]?.focus();
  }

  return (
    <span
      className={cx("relative block size-full overflow-hidden", className)}
      onPointerDown={(event) => {
        dragFrom.current = event.clientX;
      }}
      onPointerUp={(event) => {
        const from = dragFrom.current;
        dragFrom.current = null;
        if (from === null || !withDots) return;
        const travelled = event.clientX - from;
        if (Math.abs(travelled) < SWIPE_THRESHOLD) return;
        select(pageIndex(index, travelled < 0 ? 1 : -1, frames.length), false);
      }}
    >
      {showing?.kind === "image" ? (
        // A plain `img`, not `next/image`: the optimiser refuses a remote host
        // that is not in `next.config`, and there is no host to add — nothing
        // has uploaded a picture yet. It becomes an optimised image when there
        // is an origin to name.
        <img
          src={showing.url}
          alt={showing.altText ?? `${serviceTitle}, picture ${index + 1} of ${frames.length}`}
          className="size-full object-cover"
        />
      ) : (
        <MediaPlaceholder toneStart={toneStart} toneEnd={toneEnd} caption={caption} />
      )}

      {withDots ? (
        <span
          // 44px tall so each dot has a hit area, anchored to the bottom of the
          // block: the canvas's 9px inset (line 724) is the visual's, not the
          // control's, and a 5px target is one nobody hits on a phone.
          className="absolute inset-x-0 bottom-0 flex h-[44px] items-end justify-center gap-[5px]"
          role="group"
          aria-label={`Pictures of ${serviceTitle}`}
        >
          {frames.map((_frame, dot) => (
            <button
              key={dot}
              ref={(element) => {
                dots.current[dot] = element;
              }}
              type="button"
              // Not `aria-pressed`: these are one selection among several, and
              // a row of pressed toggles says every dot is independently on.
              aria-current={dot === index ? "true" : undefined}
              aria-label={`Show picture ${dot + 1} of ${frames.length} of ${serviceTitle}`}
              tabIndex={dot === index ? 0 : -1}
              onClick={() => select(dot, false)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                select(pageIndex(index, event.key === "ArrowRight" ? 1 : -1, frames.length), true);
              }}
              className="grid h-[44px] w-[34px] cursor-pointer place-items-end justify-center border-0 bg-transparent pb-[9px]"
            >
              <span
                aria-hidden="true"
                className={cx(
                  "block size-[8px] rounded-pill",
                  dot === index ? "bg-[rgb(250_247_242/0.95)]" : "bg-[rgb(250_247_242/0.5)]",
                )}
              />
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
