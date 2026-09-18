-- The payment provider's record of a person, so a card saved at the deposit can
-- be charged again fourteen days before the event with nobody present.
ALTER TABLE "app"."planning_org_users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "app"."planning_org_users" ADD CONSTRAINT "planning_org_users_stripe_customer_id_unique" UNIQUE("stripe_customer_id");