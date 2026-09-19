-- The tables and columns the four remaining admin capabilities need:
-- complaints with a case file, a moderation queue over user-written text, and
-- categories an administrator can actually edit.
--
-- Hand-written rather than generated, because the generator emits neither of
-- the two things a new table in this schema must have: ownership by `app_owner`
-- and row-level security. The default privileges set in
-- `0000_zz_manual_roles_rls.sql` carry the application role's DML to future
-- tables and nothing else — RLS stays OFF, which fails open. Every migration
-- that creates a table ends by enabling it, and the block at the bottom is how.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

-- `settled_with_order` is the outcome of a case the orders screen closed by
-- taking the booking out of `issue`: something was done about it, and it was
-- not a refund. Without it that path had to borrow `refund_recorded`, which
-- writes "the platform refunded this customer" into the case file and the audit
-- log for a booking that was simply delivered.
CREATE TYPE "app"."dispute_resolution" AS ENUM(
  'refund_recorded', 'vendor_warned', 'dismissed', 'settled_with_order'
);--> statement-breakpoint
CREATE TYPE "app"."content_target" AS ENUM('review', 'message', 'vendor_profile');--> statement-breakpoint
CREATE TYPE "app"."content_decision" AS ENUM('keep', 'hide', 'remove');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

ALTER TABLE "app"."planning_org_disputes" ADD COLUMN "resolution" "app"."dispute_resolution";--> statement-breakpoint

-- Closing a case and saying what was done about it are different facts, and
-- only the second answers a vendor asking why their payout was reversed. The
-- pairing is a constraint rather than a convention so a case cannot be
-- dismissed and refunded at the same time, and an open one cannot claim an
-- outcome.
ALTER TABLE "app"."planning_org_disputes"
  ADD CONSTRAINT "disputes_resolution_matches_state" CHECK (
    ("state" IN ('resolved', 'rejected')) = ("resolution" IS NOT NULL)
    -- `IS NOT DISTINCT FROM` rather than `=`: an open case has no resolution at
    -- all, and `NULL = 'dismissed'` is NULL, which a CHECK reads as a pass on
    -- its own and as a failure the moment it is compared with anything.
    AND ("resolution" IS NOT DISTINCT FROM 'dismissed') = ("state" = 'rejected')
  );--> statement-breakpoint

CREATE TABLE "app"."planning_org_dispute_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL,
  "author_user_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "app"."planning_org_dispute_messages"
  ADD CONSTRAINT "planning_org_dispute_messages_dispute_id_fk"
  FOREIGN KEY ("dispute_id") REFERENCES "app"."planning_org_disputes"("id") ON DELETE CASCADE;--> statement-breakpoint
-- SET NULL, not CASCADE: a case file that loses its content when the person who
-- wrote it leaves the company is not a record.
ALTER TABLE "app"."planning_org_dispute_messages"
  ADD CONSTRAINT "planning_org_dispute_messages_author_user_id_fk"
  FOREIGN KEY ("author_user_id") REFERENCES "app"."planning_org_users"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX "dispute_messages_dispute_idx"
  ON "app"."planning_org_dispute_messages" USING btree ("dispute_id", "created_at");--> statement-breakpoint
CREATE INDEX "dispute_messages_author_idx"
  ON "app"."planning_org_dispute_messages" USING btree ("author_user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Content reports
-- ---------------------------------------------------------------------------

-- The target is polymorphic, so there is no foreign key to follow. That is the
-- trade for one queue over three kinds of text; the service reads the target
-- through a union and says when it has gone.
CREATE TABLE "app"."planning_org_content_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "target_type" "app"."content_target" NOT NULL,
  "target_id" uuid NOT NULL,
  "reporter_user_id" uuid,
  "reason" text NOT NULL,
  "detail" text,
  "decision" "app"."content_decision",
  "decided_by_user_id" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Half a decision is a queue entry that has left the queue and cannot say
  -- when it did.
  CONSTRAINT "content_reports_decided_together" CHECK (("decision" IS NULL) = ("decided_at" IS NULL))
);--> statement-breakpoint

ALTER TABLE "app"."planning_org_content_reports"
  ADD CONSTRAINT "planning_org_content_reports_reporter_user_id_fk"
  FOREIGN KEY ("reporter_user_id") REFERENCES "app"."planning_org_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "app"."planning_org_content_reports"
  ADD CONSTRAINT "planning_org_content_reports_decided_by_user_id_fk"
  FOREIGN KEY ("decided_by_user_id") REFERENCES "app"."planning_org_users"("id") ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX "content_reports_target_idx"
  ON "app"."planning_org_content_reports" USING btree ("target_type", "target_id");--> statement-breakpoint
-- Partial, because the queue it serves is the undecided one. A plain index on
-- `created_at` cannot answer "oldest thing still waiting" without reading the
-- decided rows too, and those are the ones that accumulate.
CREATE INDEX "content_reports_open_idx"
  ON "app"."planning_org_content_reports" USING btree ("created_at")
  WHERE "decided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "content_reports_reporter_idx"
  ON "app"."planning_org_content_reports" USING btree ("reporter_user_id");--> statement-breakpoint
CREATE INDEX "content_reports_decided_by_idx"
  ON "app"."planning_org_content_reports" USING btree ("decided_by_user_id");--> statement-breakpoint

-- One open report per person per item, enforced by the database rather than by
-- the service reading first and inserting second — which under `read committed`
-- lets two concurrent submissions of the same form both find nothing and both
-- insert. Partial, so the same content can be reported again after a decision:
-- that is the case where a second look really is warranted.
CREATE UNIQUE INDEX "content_reports_one_open_per_reporter"
  ON "app"."planning_org_content_reports" USING btree ("target_type", "target_id", "reporter_user_id")
  WHERE "decided_at" IS NULL;--> statement-breakpoint

-- The same three columns a review already carries, on the other kind of text a
-- moderator can be asked about. Hiding is reversible and removal is not, and a
-- message that was taken down has to be distinguishable from one nobody has
-- ever looked at — which a redacted body alone cannot say.
ALTER TABLE "app"."planning_org_messages"
  ADD COLUMN "moderation" "app"."moderation_state" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."planning_org_messages" ADD COLUMN "moderated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."planning_org_messages"
  ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."planning_org_messages"
  ADD CONSTRAINT "planning_org_messages_moderated_by_user_id_fk"
  FOREIGN KEY ("moderated_by_user_id") REFERENCES "app"."planning_org_users"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "messages_moderated_by_idx"
  ON "app"."planning_org_messages" USING btree ("moderated_by_user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

-- The prototype draws a category as a gradient tile and gives it no icon at all
-- (`cats()`, lines 1967–1973), so the editable visual is a CSS background. A
-- glyph field would have had nothing to render.
ALTER TABLE "app"."planning_org_categories" ADD COLUMN "tone" text;--> statement-breakpoint

-- Deactivating is the answer to "delete a category that has services": the
-- listings keep the category they were filed under and nothing new can be filed
-- under it.
ALTER TABLE "app"."planning_org_categories"
  ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Ownership, grants and row-level security for the two new tables
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['planning_org_dispute_messages', 'planning_org_content_reports']
  LOOP
    EXECUTE format('ALTER TABLE app.%I OWNER TO app_owner', target);
    EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC, anon, authenticated', target);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO app_rw', target);
    -- Enabled with no policies: deny-all for anything that is not exempt.
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END
$$;
