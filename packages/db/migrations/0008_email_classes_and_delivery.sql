-- What a template is for, as a column rather than an inference.
--
-- The class decides whether consent is required before a send and whether the
-- per-recipient secrets — a payment link, a verification link, the last four
-- digits of a card or a bank account — may appear in the body at all. Deriving
-- it from `audience` and `automatic_since` was the alternative, and it fails in
-- the direction that matters: a marketing message addressed to vendors would
-- read as operational, skip the consent join, and go out to people who never
-- agreed to receive it.
CREATE TYPE "app"."email_template_class" AS ENUM('automatic', 'vendors', 'broadcast');--> statement-breakpoint

ALTER TABLE "app"."planning_org_email_templates" ADD COLUMN "class" "app"."email_template_class";--> statement-breakpoint

-- The derivation the column replaces, applied once to what is already stored.
UPDATE "app"."planning_org_email_templates"
   SET "class" = CASE
     WHEN "automatic_since" IS NOT NULL THEN 'automatic'::"app"."email_template_class"
     WHEN "audience" = 'vendors' THEN 'vendors'::"app"."email_template_class"
     ELSE 'broadcast'::"app"."email_template_class"
   END
 WHERE "class" IS NULL;--> statement-breakpoint

ALTER TABLE "app"."planning_org_email_templates" ALTER COLUMN "class" SET NOT NULL;--> statement-breakpoint

-- One broadcast is many rows. Without a shared id the send log can only offer
-- "1,204 messages" where the screen says "All accounts · 1,204", and there is
-- no way to ask how one broadcast did as opposed to how a day's email did.
ALTER TABLE "app"."planning_org_email_sends" ADD COLUMN "broadcast_id" uuid;--> statement-breakpoint

-- CASL requires a working unsubscribe in every commercial message, and it has
-- to work without the recipient signing in. So it is a secret per send, not a
-- link that names the account.
ALTER TABLE "app"."planning_org_email_sends" ADD COLUMN "unsubscribe_token" text;--> statement-breakpoint
ALTER TABLE "app"."planning_org_email_sends" ADD CONSTRAINT "planning_org_email_sends_unsubscribe_token_unique" UNIQUE("unsubscribe_token");--> statement-breakpoint

-- The provider's later verdicts. `state` says where a send got to; these say
-- when, which is what a delivery rate is computed from.
ALTER TABLE "app"."planning_org_email_sends" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."planning_org_email_sends" ADD COLUMN "complained_at" timestamp with time zone;--> statement-breakpoint

CREATE INDEX "email_sends_broadcast_idx" ON "app"."planning_org_email_sends" USING btree ("broadcast_id");--> statement-breakpoint
CREATE INDEX "email_sends_created_idx" ON "app"."planning_org_email_sends" USING btree ("created_at" DESC);
