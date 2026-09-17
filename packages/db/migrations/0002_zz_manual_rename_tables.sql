-- Every table gains a `planning_org_` prefix.
--
-- The `app` schema already keeps these apart from the auth provider's own
-- tables, so this is not what isolates them. It is so a table is recognisably
-- ours in a client that lists every schema flat, and in a log line or a query
-- plan where the schema is not shown.
--
-- Hand-written rather than generated: drizzle-kit cannot tell a rename from a
-- drop-and-create without an interactive prompt, and its answer to that
-- question would have been to destroy every row. RENAME keeps the data, the
-- indexes, the constraints and the foreign keys exactly as they are — only the
-- name changes.
--
-- Index and constraint names are deliberately untouched. They already carry the
-- old table name (`users_status_idx`), and renaming them would be churn in
-- every error message for no gain in recognisability.

ALTER TABLE "app"."admin_invites" RENAME TO "planning_org_admin_invites";--> statement-breakpoint
ALTER TABLE "app"."audit_log" RENAME TO "planning_org_audit_log";--> statement-breakpoint
ALTER TABLE "app"."auth_attempts" RENAME TO "planning_org_auth_attempts";--> statement-breakpoint
ALTER TABLE "app"."blackout_dates" RENAME TO "planning_org_blackout_dates";--> statement-breakpoint
ALTER TABLE "app"."capacity_blocks" RENAME TO "planning_org_capacity_blocks";--> statement-breakpoint
ALTER TABLE "app"."categories" RENAME TO "planning_org_categories";--> statement-breakpoint
ALTER TABLE "app"."checkouts" RENAME TO "planning_org_checkouts";--> statement-breakpoint
ALTER TABLE "app"."communication_consents" RENAME TO "planning_org_communication_consents";--> statement-breakpoint
ALTER TABLE "app"."daily_capacity" RENAME TO "planning_org_daily_capacity";--> statement-breakpoint
ALTER TABLE "app"."disputes" RENAME TO "planning_org_disputes";--> statement-breakpoint
ALTER TABLE "app"."email_sends" RENAME TO "planning_org_email_sends";--> statement-breakpoint
ALTER TABLE "app"."email_templates" RENAME TO "planning_org_email_templates";--> statement-breakpoint
ALTER TABLE "app"."event_items" RENAME TO "planning_org_event_items";--> statement-breakpoint
ALTER TABLE "app"."events" RENAME TO "planning_org_events";--> statement-breakpoint
ALTER TABLE "app"."job_runs" RENAME TO "planning_org_job_runs";--> statement-breakpoint
ALTER TABLE "app"."jobs" RENAME TO "planning_org_jobs";--> statement-breakpoint
ALTER TABLE "app"."messages" RENAME TO "planning_org_messages";--> statement-breakpoint
ALTER TABLE "app"."neighbourhoods" RENAME TO "planning_org_neighbourhoods";--> statement-breakpoint
ALTER TABLE "app"."notifications" RENAME TO "planning_org_notifications";--> statement-breakpoint
ALTER TABLE "app"."order_items" RENAME TO "planning_org_order_items";--> statement-breakpoint
ALTER TABLE "app"."orders" RENAME TO "planning_org_orders";--> statement-breakpoint
ALTER TABLE "app"."payment_links" RENAME TO "planning_org_payment_links";--> statement-breakpoint
ALTER TABLE "app"."payments" RENAME TO "planning_org_payments";--> statement-breakpoint
ALTER TABLE "app"."platform_settings" RENAME TO "planning_org_platform_settings";--> statement-breakpoint
ALTER TABLE "app"."policy_templates" RENAME TO "planning_org_policy_templates";--> statement-breakpoint
ALTER TABLE "app"."quote_offers" RENAME TO "planning_org_quote_offers";--> statement-breakpoint
ALTER TABLE "app"."quote_request_invites" RENAME TO "planning_org_quote_request_invites";--> statement-breakpoint
ALTER TABLE "app"."quote_requests" RENAME TO "planning_org_quote_requests";--> statement-breakpoint
ALTER TABLE "app"."refunds" RENAME TO "planning_org_refunds";--> statement-breakpoint
ALTER TABLE "app"."reviews" RENAME TO "planning_org_reviews";--> statement-breakpoint
ALTER TABLE "app"."saved_services" RENAME TO "planning_org_saved_services";--> statement-breakpoint
ALTER TABLE "app"."seed_meta" RENAME TO "planning_org_seed_meta";--> statement-breakpoint
ALTER TABLE "app"."service_areas" RENAME TO "planning_org_service_areas";--> statement-breakpoint
ALTER TABLE "app"."service_media" RENAME TO "planning_org_service_media";--> statement-breakpoint
ALTER TABLE "app"."service_packages" RENAME TO "planning_org_service_packages";--> statement-breakpoint
ALTER TABLE "app"."services" RENAME TO "planning_org_services";--> statement-breakpoint
ALTER TABLE "app"."stripe_events" RENAME TO "planning_org_stripe_events";--> statement-breakpoint
ALTER TABLE "app"."thread_participants" RENAME TO "planning_org_thread_participants";--> statement-breakpoint
ALTER TABLE "app"."threads" RENAME TO "planning_org_threads";--> statement-breakpoint
ALTER TABLE "app"."transfers" RENAME TO "planning_org_transfers";--> statement-breakpoint
ALTER TABLE "app"."user_roles" RENAME TO "planning_org_user_roles";--> statement-breakpoint
ALTER TABLE "app"."users" RENAME TO "planning_org_users";--> statement-breakpoint
ALTER TABLE "app"."vendor_members" RENAME TO "planning_org_vendor_members";--> statement-breakpoint
ALTER TABLE "app"."vendors" RENAME TO "planning_org_vendors";--> statement-breakpoint
