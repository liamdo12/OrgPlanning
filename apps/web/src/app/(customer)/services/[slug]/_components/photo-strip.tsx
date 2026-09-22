import { MediaPlaceholder } from "../../../_components/media-placeholder";
import { PhotoLightbox, type Photo } from "./photo-lightbox";

/**
 * The hero and its three thumbnails. Lines 758–766.
 *
 * A 16/10 block spanning two columns and a 2×2 grid beside it, whose last cell
 * is the canvas's "+8 photos" — a count, here with a gallery behind it.
 *
 * **Nothing has uploaded a picture yet**, so what this actually draws today is
 * four gradients and no control, and "+N" is the count it refuses to invent.
 * The three shapes below are all real: none, some, and more than the strip can
 * show.
 */

/** Hero plus three thumbnails. Line 762's grid has four cells; one is the count. */
const SHOWN = 4;

export function PhotoStrip({
  photos,
  serviceTitle,
  categoryName,
  toneStart,
  toneEnd,
}: {
  photos: readonly Photo[];
  serviceTitle: string;
  categoryName: string;
  toneStart: string | null;
  toneEnd: string | null;
}) {
  const hero = photos[0];
  const thumbs = photos.slice(1, SHOWN);
  const beyond = photos.length - SHOWN;

  return (
    <div className="mb-[20px] grid gap-[10px] [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
      <div className="relative col-span-2 aspect-[16/10] overflow-hidden rounded-[22px]">
        {hero ? (
          <img
            src={hero.url}
            alt={hero.altText ?? `${serviceTitle}, main picture`}
            className="size-full object-cover"
          />
        ) : (
          <MediaPlaceholder
            toneStart={toneStart}
            toneEnd={toneEnd}
            caption={`${categoryName} photo`}
          />
        )}
      </div>

      {/* Two rows filling the hero's height, line 762 — not four squares,
          which leave the right column taller than the picture beside it. */}
      <div className="grid grid-cols-2 grid-rows-2 gap-[10px]">
        {/* Three picture cells, padded with gradients so the block keeps its
            shape while a business is still building up its photography. */}
        {Array.from({ length: SHOWN - 1 }, (_cell, at) => {
          const photo = thumbs[at];
          return (
            <div key={at} className="relative min-h-[110px] overflow-hidden rounded-tile">
              {photo ? (
                <img
                  src={photo.url}
                  alt={photo.altText ?? `${serviceTitle}, picture ${at + 2}`}
                  className="size-full object-cover"
                />
              ) : (
                <MediaPlaceholder toneStart={toneStart} toneEnd={toneEnd} />
              )}
            </div>
          );
        })}

        <div className="relative min-h-[110px] overflow-hidden rounded-tile">
          <MediaPlaceholder toneStart={toneStart} toneEnd={toneEnd} />
          {photos.length > 0 ? (
            <PhotoLightbox
              photos={photos}
              serviceTitle={serviceTitle}
              toneStart={toneStart}
              toneEnd={toneEnd}
              // The canvas's own label when there are more than the strip can
              // show; otherwise the honest one, since "+0 photos" is not a
              // thing to offer and the pictures are still worth seeing full
              // size.
              label={beyond > 0 ? `+${beyond} photos` : `View all ${photos.length}`}
              className="absolute inset-0 grid cursor-pointer place-items-center border-0 bg-transparent text-[12.5px] font-semibold text-body"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
