-- The order lifecycle needs a job type the enum shipped without, the deposit
-- belongs to the cancellation policy rather than to a single platform rate, and
-- a column that will hold an instant should not be text.
--
-- The generator also proposed renaming every auto-named unique constraint from
-- `users_email_unique` to `planning_org_users_email_unique`, because the table
-- rename in 0002 moved the names its convention derives from. That is 220
-- statements of cosmetics with no behaviour attached, and it is not this
-- phase's change; the constraints keep the names 0000 gave them.

ALTER TYPE "app"."job_type" ADD VALUE 'expire_unpaid' BEFORE 'cooling_window_transfer';--> statement-breakpoint

-- Nothing writes this column yet, so every row is null and the cast has nothing
-- to fail on. Doing it now means the vendor catalogue screen that starts
-- writing it inherits a timestamp rather than a string that sorts like one.
ALTER TABLE "app"."planning_org_services"
  ALTER COLUMN "published_at" TYPE timestamp with time zone
  USING "published_at"::timestamp with time zone;--> statement-breakpoint

-- Added nullable, backfilled from the tier, then made required: the three rows
-- already exist, and a NOT NULL column with no default cannot be added to a
-- populated table. The values are the report's templates — 10% flexible, 20%
-- moderate, 30% strict.
ALTER TABLE "app"."planning_org_policy_templates" ADD COLUMN "deposit_bps" integer;--> statement-breakpoint

UPDATE "app"."planning_org_policy_templates" SET "deposit_bps" = CASE "tier"
  WHEN 'flexible' THEN 1000
  WHEN 'moderate' THEN 2000
  WHEN 'strict' THEN 3000
END;--> statement-breakpoint

ALTER TABLE "app"."planning_org_policy_templates"
  ALTER COLUMN "deposit_bps" SET NOT NULL;
