import { describe, expect, it } from "vitest";
import { dayOfSchedule, type ScheduleItem } from "./schedule.js";

const FLOWERS: ScheduleItem = {
  arrivalTime: "16:30:00",
  categoryName: "Flowers",
  vendorName: "Bloom & Co",
};

const PHOTOGRAPHY: ScheduleItem = {
  arrivalTime: "17:00:00",
  categoryName: "Photography",
  vendorName: "Lens Studio",
};

const CAKES: ScheduleItem = { arrivalTime: null, categoryName: "Cakes", vendorName: null };

describe("the day-of schedule", () => {
  it("leads with venue access", () => {
    const schedule = dayOfSchedule({
      startTime: "17:00:00",
      venueName: "Liberty Village loft",
      items: [FLOWERS, PHOTOGRAPHY],
    });

    expect(schedule[0]).toEqual({
      kind: "venue",
      time: "17:00:00",
      venueName: "Liberty Village loft",
    });
  });

  it("leads with the venue even when something arrives earlier", () => {
    // Being let in precedes everything that turns up, including a delivery
    // timed before the event begins. Sorting the venue in with the arrivals
    // would put the flowers outside a locked door.
    const schedule = dayOfSchedule({
      startTime: "17:00:00",
      venueName: "Liberty Village loft",
      items: [FLOWERS],
    });

    expect(schedule.map((entry) => entry.kind)).toEqual(["venue", "arrival"]);
  });

  it("orders arrivals ascending", () => {
    const schedule = dayOfSchedule({
      startTime: null,
      venueName: null,
      items: [PHOTOGRAPHY, FLOWERS],
    });

    expect(schedule.map((entry) => entry.time)).toEqual(["16:30:00", "17:00:00"]);
  });

  it("carries the category and the vendor rather than a sentence", () => {
    // The wording belongs to the screen. A domain returning "Flowers arrive ·
    // Bloom & Co" would have to be edited to change a separator.
    const [arrival] = dayOfSchedule({ startTime: null, venueName: null, items: [FLOWERS] });

    expect(arrival).toEqual({
      kind: "arrival",
      time: "16:30:00",
      categoryName: "Flowers",
      vendorName: "Bloom & Co",
    });
  });

  it("leaves out anything with no arrival time", () => {
    // There is nothing to place it by, and guessing one would put a vendor on
    // a customer's running order at a time nobody agreed to.
    const schedule = dayOfSchedule({
      startTime: null,
      venueName: null,
      items: [CAKES, FLOWERS],
    });

    expect(schedule).toEqual([
      { kind: "arrival", time: "16:30:00", categoryName: "Flowers", vendorName: "Bloom & Co" },
    ]);
  });

  it("keeps two arrivals at the same time in the order they came", () => {
    const decor: ScheduleItem = {
      arrivalTime: "16:30:00",
      categoryName: "Decorations",
      vendorName: "Terrace Rentals",
    };

    const schedule = dayOfSchedule({
      startTime: null,
      venueName: null,
      items: [FLOWERS, decor],
    });

    expect(
      schedule.map((entry) => (entry.kind === "arrival" ? entry.categoryName : "venue")),
    ).toEqual(["Flowers", "Decorations"]);
  });

  it("omits venue access when the event has no venue", () => {
    const schedule = dayOfSchedule({ startTime: "17:00:00", venueName: null, items: [FLOWERS] });

    expect(schedule.map((entry) => entry.kind)).toEqual(["arrival"]);
  });

  it("omits venue access when the event has no start time", () => {
    // A venue line with no time has nowhere to sit on a running order.
    const schedule = dayOfSchedule({ startTime: null, venueName: "Casa Loma", items: [] });

    expect(schedule).toEqual([]);
  });

  it("is empty for an event with nothing planned", () => {
    expect(dayOfSchedule({ startTime: null, venueName: null, items: [] })).toEqual([]);
  });
});
