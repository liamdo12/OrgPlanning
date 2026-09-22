-- Public events, what an item in plan actually holds, one slot per category,
-- and a way for an event to end.

-- The visibility selector offers three: Private, Guests with the link, Public
-- in Toronto. Additive, and no UPDATE: the value is inert until something
-- writes it, and a migration that also reclassified existing rows would make a
-- customer's private party discoverable with nobody having asked for it.
--
-- Nothing below uses the new value. Postgres refuses a new enum value used in
-- the transaction that added it, and this runner wraps each file in one.
ALTER TYPE "app"."event_visibility" ADD VALUE IF NOT EXISTS 'public';--> statement-breakpoint

-- `quantity` and `service_package_id` existed only on `order_items`, and an
-- arrival time existed nowhere -- while the booking card asks for one, the
-- confirmation repeats it and the day-of schedule is ordered by it. Without
-- the package and the quantity a slot that has not been bought yet cannot be
-- priced, so the budget bar cannot count it.
--
-- A time, not an instant, for the same reason `events.start_time` is one: it is
-- read in the event's timezone on the event's date, and storing a single
-- instant would move the arrival if the timezone rules ever changed.
ALTER TABLE "app"."planning_org_event_items"
  ADD COLUMN "service_package_id" uuid,
  ADD COLUMN "quantity" integer NOT NULL DEFAULT 1,
  ADD COLUMN "arrival_time" time;--> statement-breakpoint

ALTER TABLE "app"."planning_org_event_items"
  ADD CONSTRAINT "planning_org_event_items_service_package_id_fk"
  FOREIGN KEY ("service_package_id")
  REFERENCES "app"."planning_org_service_packages"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Quantity multiplies a price. A zero or a negative one silently subtracts from
-- a figure the customer is reading as what they have committed.
ALTER TABLE "app"."planning_org_event_items"
  ADD CONSTRAINT "event_items_quantity_positive" CHECK ("quantity" >= 1);--> statement-breakpoint

CREATE INDEX "event_items_service_package_idx"
  ON "app"."planning_org_event_items" USING btree ("service_package_id");--> statement-breakpoint

-- `order_id` named an order and the database did not know it. SET NULL rather
-- than CASCADE: deleting an order must not take the customer's slot with it,
-- and the demo reset deletes orders before event items, which a plain key would
-- refuse.
--
-- Nothing clears this column, and nothing needs to. It records which order was
-- placed from this slot; whether that order still holds the date is the order's
-- own state, read at the point the slot is drawn. A clearing write would be a
-- second source of truth that can disagree with the order.
--
-- No row in any seeded database has ever named an order here, so this UPDATE
-- touches nothing; it is here so the constraint cannot fail on a hand-made row
-- naming an order somebody has since deleted.
UPDATE "app"."planning_org_event_items" SET "order_id" = NULL
  WHERE "order_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "app"."planning_org_orders" o
      WHERE o."id" = "app"."planning_org_event_items"."order_id"
    );--> statement-breakpoint

ALTER TABLE "app"."planning_org_event_items"
  ADD CONSTRAINT "planning_org_event_items_order_id_fk"
  FOREIGN KEY ("order_id")
  REFERENCES "app"."planning_org_orders"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX "event_items_order_idx"
  ON "app"."planning_org_event_items" USING btree ("order_id");--> statement-breakpoint

-- `category_id` is what a slot *is*, and it had no key either. RESTRICT, the
-- same answer `quote_requests.category_id` gives: a category an event still
-- holds a slot for cannot be deleted out from under it, leaving every event
-- pointing at nothing.
ALTER TABLE "app"."planning_org_event_items"
  ADD CONSTRAINT "planning_org_event_items_category_id_fk"
  FOREIGN KEY ("category_id")
  REFERENCES "app"."planning_org_categories"("id") ON DELETE RESTRICT;--> statement-breakpoint

CREATE INDEX "event_items_category_idx"
  ON "app"."planning_org_event_items" USING btree ("category_id");--> statement-breakpoint

-- One slot per category, by constraint rather than by convention. Two rows for
-- one category is how the planner grows a stray slot, and it is also what makes
-- "update the existing row" an invariant instead of a rule each caller has to
-- remember.
CREATE UNIQUE INDEX "event_items_event_category_key"
  ON "app"."planning_org_event_items" USING btree ("event_id", "category_id");--> statement-breakpoint

-- An event ends by being closed, not by being deleted: its orders, its payments
-- and its audit trail all still have to be explainable afterwards.
ALTER TABLE "app"."planning_org_events"
  ADD COLUMN "cancelled_at" timestamp with time zone;
