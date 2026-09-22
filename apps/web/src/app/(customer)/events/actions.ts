"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AppError,
  ValidationError,
  cancelEvent,
  createEvent,
  getEvent,
  removeItemFromPlan,
  updateEvent,
  type CreateEventInput,
  type EventVisibility,
} from "@occasion/core";
import { requireCustomerActor } from "../../../lib/auth-guard";
import { setActiveEvent } from "../../../lib/active-event";
import { createRequestContext } from "../../../lib/core";
import { readString } from "../../../lib/form-values";

/**
 * Everything the planner does.
 *
 * `requireCustomerActor()` opens every one of them, because a server action is
 * reachable by a direct POST that renders no layout at all — and the domain
 * then checks the actor against the event's owner, because this file will not
 * be the only caller for ever.
 *
 * Refusals come back as form state rather than as exceptions. The one that
 * matters is the date change refused while a booking is live: its message
 * names the booking, and a screen that turned it into a generic error page
 * would drop the one fact the customer needs to act on.
 */

export type EventFormState = {
  error?: string;
  /** Keyed by field name, so each message can render under its own input. */
  fieldErrors?: Record<string, string>;
};

/** A refusal the form can render, or a fault that belongs to the boundary. */
function asFormState(error: unknown): EventFormState {
  if (error instanceof ValidationError) {
    return { error: error.message, fieldErrors: { ...error.issues } };
  }
  if (error instanceof AppError) return { error: error.message };
  throw error;
}

export async function createEventAction(
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();

  let created;
  try {
    created = await createEvent(ctx, actor, readEventInput(form));
  } catch (error) {
    return asFormState(error);
  }

  // The new event becomes the one being planned. Without this the header's
  // chip goes on naming the previous one, and "Add to event" would add to it.
  await setActiveEvent(created.id);
  revalidatePath("/", "layout");
  redirect(`/events/${created.id}`);
}

export async function updateEventAction(
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();
  const eventId = readString(form, "eventId").trim();

  try {
    await updateEvent(ctx, actor, eventId, readEventInput(form));
  } catch (error) {
    return asFormState(error);
  }

  revalidatePath("/", "layout");
  redirect(`/events/${eventId}`);
}

export async function cancelEventAction(
  _previous: EventFormState,
  form: FormData,
): Promise<EventFormState> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();

  try {
    await cancelEvent(ctx, actor, readString(form, "eventId").trim());
  } catch (error) {
    return asFormState(error);
  }

  revalidatePath("/", "layout");
  redirect("/events");
}

/** Empties a category's slot. The slot stays; it is the row the planner draws. */
export async function removeFromPlanAction(form: FormData): Promise<void> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();

  await removeItemFromPlan(ctx, actor, {
    eventId: readString(form, "eventId").trim(),
    categoryId: readString(form, "categoryId").trim(),
  });

  revalidatePath("/events");
}

/**
 * Changes which event the planner is showing.
 *
 * **Ownership first, cookie second.** `getEvent` runs the event's own policy
 * and refuses with `NotFoundError`, so an id that is not this customer's never
 * reaches the cookie and the previous selection survives intact. The shell's
 * own switcher leaves the check to every reader instead; this one is the
 * screen where a person types nothing and picks from their own list, so
 * refusing before writing costs one query and keeps a refused id out of a
 * value that then travels with every request.
 */
export async function selectHubEventAction(form: FormData): Promise<void> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();
  const eventId = readString(form, "eventId").trim();

  const event = await getEvent(ctx, actor, eventId);
  await setActiveEvent(event.id);

  // The chip is drawn by the layout, which does not re-render on its own after
  // a POST.
  revalidatePath("/", "layout");
}

/**
 * The form, as the domain takes it.
 *
 * Nothing is coerced into a plausible value: a guest count that is not a whole
 * number and a budget that is not a figure are refused by the domain with a
 * message against the field, rather than saved as zero.
 */
function readEventInput(form: FormData): CreateEventInput {
  return {
    name: readString(form, "name"),
    eventDate: readString(form, "eventDate").trim(),
    startTime: emptyToNull(readString(form, "startTime")),
    venueName: emptyToNull(readString(form, "venueName")),
    guestCount: readCount(form, "guestCount"),
    budget: readBudget(form),
    visibility: readVisibility(form),
  };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readCount(form: FormData, key: string): number | null {
  const raw = readString(form, key).trim();
  if (raw.length === 0) return null;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ValidationError("A guest count is a whole number.", { guestCount: "invalid" });
  }
  return value;
}

/**
 * Dollars on the slider, cents in the column.
 *
 * **Zero is no budget**, not a budget of nothing. The slider's left end is
 * where an event with no figure starts, and a customer who leaves it there has
 * not set one — so the planner draws the committed total with no track, rather
 * than reporting every booking as overspending against zero.
 */
function readBudget(form: FormData): bigint | null {
  const raw = readString(form, "budget").trim();
  if (raw.length === 0) return null;

  const dollars = Number(raw);
  if (!Number.isInteger(dollars) || dollars < 0) {
    throw new ValidationError("A budget is a whole number of dollars.", { budget: "invalid" });
  }

  return dollars === 0 ? null : BigInt(dollars) * 100n;
}

const VISIBILITIES: readonly EventVisibility[] = ["private", "shared", "public"];

function readVisibility(form: FormData): EventVisibility {
  const raw = readString(form, "visibility").trim();
  const found = VISIBILITIES.find((value) => value === raw);

  if (!found) {
    throw new ValidationError("Choose who can see this event.", { visibility: "invalid" });
  }
  return found;
}
