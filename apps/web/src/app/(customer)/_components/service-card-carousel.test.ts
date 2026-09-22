import { describe, expect, it } from "vitest";
import { carouselFrames, pageIndex, showsDots } from "./service-card-media.js";

/**
 * What the pager draws, for each of the three things it can be given.
 *
 * The rules are read off the input's length, never off a count somebody
 * seeded: `service_media` is empty today, so a case asserting "three dots"
 * would pass against nothing at all and go on passing once pictures exist.
 *
 * The no-picture row is the one that matters right now, because it is the
 * state every card in the catalogue is in.
 */

const picture = (name: string) => ({ url: `https://example.test/${name}.jpg`, altText: null });

describe("what the card's media block shows", () => {
  it("draws one gradient and no dots when there are no pictures", () => {
    const frames = carouselFrames([]);

    expect(frames).toEqual([{ kind: "placeholder" }]);
    expect(showsDots(frames.length)).toBe(false);
  });

  it("draws one picture and no dots when there is one", () => {
    const frames = carouselFrames([picture("only")]);

    expect(frames).toEqual([
      { kind: "image", url: "https://example.test/only.jpg", altText: null },
    ]);
    expect(showsDots(frames.length)).toBe(false);
  });

  it("draws a frame per picture, and dots, from two up", () => {
    const frames = carouselFrames([picture("one"), picture("two"), picture("three")]);

    expect(frames.map((frame) => frame.kind)).toEqual(["image", "image", "image"]);
    expect(showsDots(frames.length)).toBe(true);
  });

  it("keeps the vendor's order and the alt text they wrote", () => {
    const frames = carouselFrames([
      { url: "https://example.test/a.jpg", altText: "The arch, from the aisle" },
      { url: "https://example.test/b.jpg", altText: null },
    ]);

    expect(frames).toEqual([
      { kind: "image", url: "https://example.test/a.jpg", altText: "The arch, from the aisle" },
      { kind: "image", url: "https://example.test/b.jpg", altText: null },
    ]);
  });
});

describe("moving between frames", () => {
  it("advances and goes back", () => {
    expect(pageIndex(0, 1, 3)).toBe(1);
    expect(pageIndex(2, -1, 3)).toBe(1);
  });

  it("wraps at both ends", () => {
    // An arrow key that stops at the end leaves the last dot looking broken.
    expect(pageIndex(2, 1, 3)).toBe(0);
    expect(pageIndex(0, -1, 3)).toBe(2);
  });

  it("stays put when there is one frame or none", () => {
    expect(pageIndex(0, 1, 1)).toBe(0);
    expect(pageIndex(0, -1, 0)).toBe(0);
  });

  it("brings an index past the end back inside", () => {
    // The selection survives a re-render with fewer pictures than before.
    expect(pageIndex(7, 0, 3)).toBe(1);
  });
});
