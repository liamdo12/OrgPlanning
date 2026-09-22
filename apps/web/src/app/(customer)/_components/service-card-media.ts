/**
 * What a card's media block draws, and whether it draws dots.
 *
 * Separate from the carousel itself so it can be tested: this app's tsconfig
 * sets `jsx: "preserve"` for Next, which leaves a `.tsx` module unparseable by
 * the test runner. Plain functions in a plain file, imported by both.
 *
 * Every rule below is read off the input's length. `service_media` holds no
 * rows today, so a rule expressed as "three dots" would be asserted against
 * nothing and would keep passing once pictures arrive.
 */

export type CarouselImage = {
  url: string;
  altText: string | null;
};

export type CarouselFrame =
  { kind: "placeholder" } | { kind: "image"; url: string; altText: string | null };

/** No pictures is one gradient frame; otherwise one frame per picture. */
export function carouselFrames(media: readonly CarouselImage[]): CarouselFrame[] {
  if (media.length === 0) return [{ kind: "placeholder" }];
  return media.map((image) => ({ kind: "image", url: image.url, altText: image.altText }));
}

/** One frame is not a gallery, and no frames is not two. */
export function showsDots(frameCount: number): boolean {
  return frameCount > 1;
}

/** Moves the selection, wrapping at both ends. */
export function pageIndex(current: number, delta: number, count: number): number {
  if (count < 1) return 0;
  return (((current + delta) % count) + count) % count;
}
