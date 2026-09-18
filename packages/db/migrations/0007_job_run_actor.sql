-- Who asked for a run, as distinct from whose clock it used.
--
-- `clock_override_actor_id` answers "whose shifted clock was this run made
-- against", and is null whenever nobody had moved it — which is most runs,
-- including every one an administrator triggers without first jumping the
-- clock. So the record could say a person did it and not say which person.
-- The two facts are separate and both have to survive in this row alone.

ALTER TABLE "app"."planning_org_job_runs" ADD COLUMN "triggered_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."planning_org_job_runs" ADD CONSTRAINT "planning_org_job_runs_triggered_by_user_id_planning_org_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "app"."planning_org_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_triggered_by_idx" ON "app"."planning_org_job_runs" USING btree ("triggered_by_user_id");
