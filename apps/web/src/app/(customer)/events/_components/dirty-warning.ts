/**
 * What changing an event costs, said before it is saved.
 *
 * A pure function over the loaded event and what is currently typed, rather
 * than a ternary inside the form: this is copy that makes a promise about
 * somebody's money, and the two promises it can make have to keep agreeing
 * with what the save actually does. The prototype draws the same band from two
 * hardcoded comparisons (line 2390) and promises a workflow that does not
 * exist — vendors accepting a new date within forty-eight hours or refunding —
 * so the wording here is what the platform will really do instead.
 */

export type EventFormValues = {
  /** `YYYY-MM-DD`, as the date input and the column both spell it. */
  eventDate: string;
  guestCount: number | null;
};

export type DirtyWarning = {
  kind: "date" | "guests";
  text: string;
};

/**
 * The warning that applies, or nothing.
 *
 * **The date takes precedence**, because it is the one the save refuses: a
 * screen leading with the guest note while the save is about to be rejected
 * would explain the wrong half of what is happening.
 *
 * A date change with nothing booked warns about nothing, and says nothing. The
 * band is danger-coloured, and a danger band over an event nobody has booked
 * anything for teaches people to dismiss it.
 */
export function dirtyWarning(input: {
  loaded: EventFormValues;
  current: EventFormValues;
  /**
   * The categories with a vendor booked into them.
   *
   * What the planner itself shows as Booked. The refusal names the booking's
   * own reference, which this cannot know before the save is attempted — so
   * this names what is at stake and leaves the identification to the refusal,
   * rather than guessing at one and naming the wrong booking.
   */
  bookedCategories: readonly string[];
}): DirtyWarning | undefined {
  const { loaded, current, bookedCategories } = input;

  if (current.eventDate !== loaded.eventDate && bookedCategories.length > 0) {
    return {
      kind: "date",
      text:
        `${list(bookedCategories)} booked into this event, and the booking holds ` +
        `this date. The date cannot be moved while a booking is live: cancel it first, ` +
        `and that vendor's own cancellation policy decides what comes back.`,
    };
  }

  if (current.guestCount !== loaded.guestCount) {
    const from = loaded.guestCount;
    const to = current.guestCount;

    return {
      kind: "guests",
      text:
        from === null
          ? `Guest count set to ${to ?? 0}. Anything already quoted or in your plan was ` +
            `priced without one, and nothing re-prices itself — check it before you book.`
          : `Guest count changed from ${from} to ${to ?? 0}. Anything already quoted or in ` +
            `your plan was priced for ${from}, and nothing re-prices itself — check it ` +
            `before you book.`,
    };
  }

  return undefined;
}

/** "Flowers is", "Flowers and Catering are", "Flowers, Catering and Cakes are". */
function list(names: readonly string[]): string {
  if (names.length === 1) return `${names[0] as string} is`;

  const last = names[names.length - 1] as string;
  return `${names.slice(0, -1).join(", ")} and ${last} are`;
}
