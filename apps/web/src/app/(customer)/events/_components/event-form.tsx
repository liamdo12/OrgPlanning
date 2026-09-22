"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { Button, Input, Stepper } from "@occasion/ui";
import { createEventAction, updateEventAction, type EventFormState } from "../actions";
import { dirtyWarning } from "./dirty-warning";

/**
 * The event form, lines 935–1012.
 *
 * A client component because two things on it are live against values nobody
 * has saved: the guest stepper, and the warning that says what saving would
 * cost. Both would be wrong if they described the loaded event instead.
 *
 * Its field errors come back from the action keyed by field name and render
 * under the input they belong to, through the shared field shell's
 * `aria-describedby` — a form whose only failure message is a line at the top
 * tells somebody using a screen reader that something is wrong and not what.
 */

const INITIAL: EventFormState = {};

/** The prototype's own labels, line 990, against the column's three values. */
const VISIBILITIES = [
  { value: "private", label: "Private" },
  { value: "shared", label: "Guests with the link" },
  { value: "public", label: "Public in Toronto" },
] as const;

export type EventFormFields = {
  id?: string;
  name: string;
  eventDate: string;
  startTime: string;
  venueName: string;
  guestCount: number | null;
  /** Whole dollars, which is what the slider moves in. */
  budgetDollars: number;
  visibility: string;
};

export function EventForm({
  mode,
  values,
  bookedCategories = [],
  committed,
}: {
  mode: "create" | "edit";
  values: EventFormFields;
  /** Categories with a vendor booked in, for the date warning. */
  bookedCategories?: readonly string[];
  /** What is already committed, formatted. Absent while creating. */
  committed?: string;
}) {
  const editing = mode === "edit";
  const [state, submit, pending] = useActionState(
    editing ? updateEventAction : createEventAction,
    INITIAL,
  );

  const [eventDate, setEventDate] = useState(values.eventDate);
  const [guestCount, setGuestCount] = useState(values.guestCount);
  const [budget, setBudget] = useState(values.budgetDollars);
  const [visibility, setVisibility] = useState(values.visibility);

  const warning = dirtyWarning({
    loaded: { eventDate: values.eventDate, guestCount: values.guestCount },
    current: { eventDate, guestCount },
    bookedCategories,
  });

  const ids = useId();
  const field = (name: string) => `${ids}-${name}`;
  const errorFor = (name: string) => state.fieldErrors?.[name];

  // Every field this form draws a message under. A refusal keyed to anything
  // else still has to be said out loud, which is what the line below the
  // fieldsets is for — a message that matched no input and was therefore never
  // rendered would be a save that failed in silence.
  const underAField = ["name", "eventDate", "time", "guestCount", "budget", "visibility"].some(
    (name) => errorFor(name),
  );

  // The slider must be able to express the figure the event already carries.
  // A fixed ceiling would silently clamp a larger budget down to it the first
  // time somebody touched anything else on this form.
  const maxBudget = Math.max(10_000, Math.ceil(budget / 250) * 250);

  return (
    <form action={submit} className="max-w-[760px]">
      {editing ? <input type="hidden" name="eventId" value={values.id ?? ""} /> : null}
      {/*
        Zero means "not set", the same rule the budget slider follows: the
        stepper starts at its floor for an event that has never carried a
        number, and nobody plans a party for nobody.
      */}
      <input type="hidden" name="guestCount" value={guestCount ? guestCount : ""} />
      <input type="hidden" name="budget" value={budget} />
      <input type="hidden" name="visibility" value={visibility} />

      <div className="oc-glass grid gap-[18px] rounded-overlay p-[clamp(18px,3vw,26px)]">
        <Input
          id={field("name")}
          name="name"
          label="Event name"
          defaultValue={values.name}
          required
          {...(errorFor("name") ? { error: "An event needs a name." } : {})}
        />

        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[14px]">
          <Input
            id={field("eventDate")}
            name="eventDate"
            type="date"
            label="Date"
            value={eventDate}
            onChange={(event) => setEventDate(event.target.value)}
            required
            {...(errorFor("eventDate") ? { error: state.error } : {})}
          />
          <Input
            id={field("startTime")}
            name="startTime"
            type="time"
            label="Start time"
            defaultValue={values.startTime}
            hint="When the day begins. It leads the day-of schedule."
            {...(errorFor("time") ? { error: "A time reads as HH:MM." } : {})}
          />
        </div>

        <Input
          id={field("venueName")}
          name="venueName"
          label="Venue or neighbourhood"
          defaultValue={values.venueName}
        />

        <fieldset className="m-0 border-0 p-0">
          <legend className="oc-label">Guests</legend>
          <div className="flex flex-wrap items-center gap-[14px]">
            <Stepper
              value={guestCount ?? 0}
              min={0}
              max={500}
              step={5}
              label="Guests"
              decrementLabel="Fewer guests"
              incrementLabel="More guests"
              onChange={setGuestCount}
            />
            <p className="m-0 text-row text-body">
              Quotes and packages are priced against this number.
            </p>
          </div>
          {errorFor("guestCount") ? (
            <p role="alert" className="oc-error">
              A guest count is a whole number.
            </p>
          ) : null}
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="oc-label">Budget</legend>
          <input
            type="range"
            min={0}
            max={maxBudget}
            step={250}
            value={budget}
            aria-label="Budget in dollars"
            aria-valuetext={budget === 0 ? "No budget set" : `C$${budget.toLocaleString("en-CA")}`}
            onChange={(event) => setBudget(Number(event.target.value))}
            className="w-full accent-role"
          />
          <p className="mt-[6px] mb-0 text-[14px] text-body">
            {budget === 0 ? "No budget set" : `C$${budget.toLocaleString("en-CA")}`}
            {committed ? ` · ${committed} already committed` : null}
          </p>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="oc-label">Who can see this event</legend>
          <div className="flex flex-wrap gap-2">
            {VISIBILITIES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={visibility === option.value}
                onClick={() => setVisibility(option.value)}
                className={
                  visibility === option.value
                    ? "cursor-pointer rounded-pill border-[1.5px] border-role bg-role px-4 py-[10px] text-row font-semibold text-surface"
                    : "cursor-pointer rounded-pill border-[1.5px] border-glass-edge bg-chip px-4 py-[10px] text-row font-semibold text-ink"
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        {warning ? (
          <p
            role="status"
            className="m-0 rounded-[18px] border border-status-danger-fg/30 bg-status-danger-bg px-4 py-[14px] text-row text-pretty text-status-danger-fg"
          >
            {warning.text}
          </p>
        ) : null}

        {state.error && !underAField ? (
          <p role="alert" className="oc-error m-0">
            {state.error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-[10px] border-t border-hairline pt-[18px]">
          <Button
            type="submit"
            intent="primary"
            size="lg"
            disabled={pending}
            className="flex-[1_1_200px] justify-center"
          >
            {pending ? "Saving…" : editing ? "Save changes" : "Create event"}
          </Button>
          <Link
            href={editing && values.id ? `/events/${values.id}` : "/events"}
            className="oc-button oc-button--secondary oc-button--lg"
          >
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
