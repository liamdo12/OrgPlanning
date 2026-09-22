import { Button } from "@occasion/ui";
import { selectHubEventAction } from "../actions";

/**
 * Which event the planner is showing.
 *
 * A **form**, not a render side effect. A server component cannot set a
 * cookie, so a screen that "remembered" the event it was rendering would have
 * to write one from the browser — which drops `httpOnly` and turns a selection
 * the server controls into a value anybody can edit.
 *
 * Its action checks ownership before writing, so a refused event id never
 * reaches the cookie and the previous selection survives a refusal intact.
 *
 * Not rendered at all for somebody with one event: a picker with a single
 * option is a control that cannot do anything.
 */
export function EventSwitcherForm({
  events,
  activeId,
}: {
  events: ReadonlyArray<{ id: string; name: string }>;
  activeId: string;
}) {
  if (events.length < 2) return null;

  return (
    <form action={selectHubEventAction} className="flex flex-wrap items-end gap-2">
      <label htmlFor="hub-event" className="sr-only">
        Event
      </label>
      <select
        id="hub-event"
        name="eventId"
        defaultValue={activeId}
        className="oc-input w-auto max-w-[240px]"
      >
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {event.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm">
        Switch
      </Button>
    </form>
  );
}
