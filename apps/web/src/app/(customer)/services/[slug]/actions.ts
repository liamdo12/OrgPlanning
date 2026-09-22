"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addItemToPlan } from "@occasion/core";
import { requireCustomerActor } from "../../../../lib/auth-guard";
import { createRequestContext } from "../../../../lib/core";
import { readString } from "../../../../lib/form-values";

/**
 * Putting a service in its event's plan.
 *
 * `requireCustomerActor()` first: an action is reachable by a direct POST that
 * renders no layout, so the gate has to be in the function doing the work. The
 * domain then checks again — `addItemToPlan` runs the event's own policy, so
 * an id for somebody else's event is refused there whatever this screen did.
 *
 * Nothing about money is sent. The request names a service, a tier and a
 * quantity; the category comes from the service and every amount is read when
 * the checkout is made. A form that could name a price is a form that could
 * name a smaller one.
 *
 * Then to the hub, which is what the prototype does (line 2347): the thing
 * that just happened is that an event gained a vendor, and the event is where
 * that is visible.
 */
export async function addItemToPlanAction(form: FormData): Promise<void> {
  const actor = await requireCustomerActor();
  const ctx = createRequestContext();

  const quantity = Number(readString(form, "quantity"));
  const servicePackageId = readString(form, "servicePackageId").trim();
  const arrivalTime = readString(form, "arrivalTime").trim();

  await addItemToPlan(ctx, actor, {
    eventId: readString(form, "eventId").trim(),
    serviceId: readString(form, "serviceId").trim(),
    ...(servicePackageId ? { servicePackageId } : {}),
    // Not defaulted here: the domain refuses anything that is not a whole
    // number of at least one, and quietly turning a malformed quantity into 1
    // would book something nobody asked for.
    quantity,
    ...(arrivalTime ? { arrivalTime } : {}),
  });

  revalidatePath("/events");

  // Outside the try/catch shape the other actions use, and deliberately:
  // `redirect` works by throwing, so catching around it would swallow the
  // navigation. Nothing here needs catching — a refusal from the domain is a
  // typed error the group's boundary already shows by name.
  redirect("/events");
}
