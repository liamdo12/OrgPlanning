-- The cancellation policy a service is sold under.
--
-- `policy_templates` was referenced by exactly one table — `orders` — so an
-- order recorded which template it was booked under and nothing decided which
-- one that should be. The gap was filled by trusting a request field, and a
-- request that can name a template can name a foreign one: a C$5,000 booking
-- held for a 10% deposit the business selling the date never offered.
--
-- The deposit rate and the free-cancellation window belong to that business, so
-- the attachment belongs on the service. Checkout reads the template off the
-- priced line and snapshots it onto the order.
--
-- Nullable: a service with no policy prices at the platform's own deposit rate,
-- which is what `platform_settings.deposit_bps` is for. Backfilling would put
-- terms on catalogue rows nobody chose them for.
--
-- ON DELETE SET NULL to match `orders.policy_template_id`: retiring a policy
-- family must not take a catalogue down with it.
ALTER TABLE "app"."planning_org_services"
  ADD COLUMN "policy_template_id" uuid;--> statement-breakpoint

ALTER TABLE "app"."planning_org_services"
  ADD CONSTRAINT "planning_org_services_policy_template_id_fk"
  FOREIGN KEY ("policy_template_id")
  REFERENCES "app"."planning_org_policy_templates"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX "services_policy_template_idx"
  ON "app"."planning_org_services" USING btree ("policy_template_id");
