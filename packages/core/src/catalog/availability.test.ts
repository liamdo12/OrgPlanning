import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SERVICE_DAY_STATES } from "./availability.js";

/**
 * The two things about this read that are decisions rather than behaviour.
 *
 * What it answers for a given day is asserted against real rows in
 * `catalog-discovery.test.ts`. What cannot be asserted there is what it does
 * **not** do: a query that started reading `daily_capacity` would still return
 * a correct-looking answer for every case a behavioural test asks about, and a
 * fourth state would simply never be produced by the seeded data.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The module with its prose removed.
 *
 * The comments name `daily_capacity` on purpose — saying which table is
 * deliberately not read is half of why the decision survives — so a match
 * against the whole file would find the explanation and call it the defect.
 */
const code = readFileSync(`${here}/availability.ts`, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

describe("what a day can be", () => {
  it("offers no partly-full state", () => {
    // `daily_capacity.remaining` is decremented by no code path, and a checkout
    // takes an exclusive hold for every line whatever the booking mode — so
    // every service is one booking per day. A "3 of 5 left" answer would be a
    // screen state nothing in the system can produce, and a customer shown one
    // would be told a date is available that the next insert refuses.
    const partial = SERVICE_DAY_STATES.filter((state) => /full|partial|remaining|left/.test(state));

    expect(partial).toEqual([]);
  });

  it("answers free, booked or blacked out and nothing else", () => {
    expect([...SERVICE_DAY_STATES]).toEqual(["free", "booked", "blacked_out"]);
  });
});

describe("where the answer comes from", () => {
  it("reads no per-day capacity table", () => {
    // The source, not the output: a read added here would go unnoticed by every
    // assertion about what comes back, because the numbers in that table agree
    // with the blocks for as long as nothing decrements them.
    expect(code).not.toMatch(/dailyCapacity|daily_capacity/);
  });

  it("reads the two tables it says it reads", () => {
    // The inverse, so a refactor that quietly stopped consulting one of them
    // fails here rather than by answering "free" for every day for ever.
    expect(code).toMatch(/blackoutDates/);
    expect(code).toMatch(/capacityBlocks/);
  });
});
