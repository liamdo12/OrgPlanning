CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TYPE "app"."booking_mode" AS ENUM('book_now', 'quote');--> statement-breakpoint
CREATE TYPE "app"."consent_basis" AS ENUM('express', 'implied', 'withdrawn');--> statement-breakpoint
CREATE TYPE "app"."consent_channel" AS ENUM('marketing_email', 'product_email');--> statement-breakpoint
CREATE TYPE "app"."dispute_state" AS ENUM('open', 'under_review', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "app"."email_audience" AS ENUM('customers', 'vendors', 'admins', 'all');--> statement-breakpoint
CREATE TYPE "app"."email_send_state" AS ENUM('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed');--> statement-breakpoint
CREATE TYPE "app"."event_visibility" AS ENUM('private', 'shared');--> statement-breakpoint
CREATE TYPE "app"."job_status" AS ENUM('queued', 'running', 'done', 'failed', 'held');--> statement-breakpoint
CREATE TYPE "app"."job_trigger" AS ENUM('cron', 'admin_button', 'system');--> statement-breakpoint
CREATE TYPE "app"."job_type" AS ENUM('cooling_window_transfer', 'charge_balance', 'expire_quote_request', 'auto_complete_order', 'balance_grace_expiry', 'send_email');--> statement-breakpoint
CREATE TYPE "app"."moderation_state" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "app"."order_state" AS ENUM('pending_payment', 'confirmed', 'balance_due', 'action_required', 'issue', 'fulfilled', 'completed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "app"."payment_kind" AS ENUM('deposit', 'balance', 'full');--> statement-breakpoint
CREATE TYPE "app"."payment_state" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "app"."place_kind" AS ENUM('neighbourhood', 'district', 'venue', 'city');--> statement-breakpoint
CREATE TYPE "app"."policy_tier" AS ENUM('flexible', 'moderate', 'strict');--> statement-breakpoint
CREATE TYPE "app"."price_unit" AS ENUM('event', 'guest', 'bouquet', 'cake', 'install', 'arch', 'table', 'package', 'hour');--> statement-breakpoint
CREATE TYPE "app"."quote_offer_state" AS ENUM('sent', 'accepted', 'declined', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TYPE "app"."quote_request_state" AS ENUM('open', 'closed', 'expired', 'booked');--> statement-breakpoint
CREATE TYPE "app"."refund_state" AS ENUM('requested', 'settled', 'needs_attention');--> statement-breakpoint
CREATE TYPE "app"."transfer_kind" AS ENUM('deposit_share', 'balance_share');--> statement-breakpoint
CREATE TYPE "app"."transfer_state" AS ENUM('pending', 'paid', 'held', 'failed', 'reversed');--> statement-breakpoint
CREATE TYPE "app"."user_role_name" AS ENUM('customer', 'vendor', 'admin');--> statement-breakpoint
CREATE TYPE "app"."user_status" AS ENUM('active', 'pending', 'unverified', 'suspended');--> statement-breakpoint
CREATE TYPE "app"."vendor_status" AS ENUM('pending', 'approved', 'suspended', 'blocked');--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"acting_role" "app"."user_role_name",
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."communication_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "app"."consent_channel" NOT NULL,
	"basis" "app"."consent_basis" NOT NULL,
	"expires_at" timestamp with time zone,
	"source" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communication_consents_user_channel_key" UNIQUE("user_id","channel")
);
--> statement-breakpoint
CREATE TABLE "app"."user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."user_role_name" NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_role_key" UNIQUE("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "app"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider_sub" text,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"status" "app"."user_status" DEFAULT 'unverified' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"sessions_valid_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_provider_sub_unique" UNIQUE("auth_provider_sub"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app"."vendor_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_members_vendor_user_key" UNIQUE("vendor_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"status" "app"."vendor_status" DEFAULT 'pending' NOT NULL,
	"base_area" text,
	"stripe_account_id" text,
	"stripe_status" text,
	"stripe_charges_enabled_at" timestamp with time zone,
	"stripe_payouts_enabled_at" timestamp with time zone,
	"hst_number" text,
	"hst_registered_at" timestamp with time zone,
	"onboarding_percent" text,
	"approved_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "vendors_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "app"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"display_count" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."neighbourhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "app"."place_kind" NOT NULL,
	"subtitle" text,
	"postal_prefix" text,
	"search_tags" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "neighbourhoods_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."policy_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier" "app"."policy_tier" NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"free_cancellation_hours" integer NOT NULL,
	"late_refund_bps" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_templates_tier_unique" UNIQUE("tier")
);
--> statement-breakpoint
CREATE TABLE "app"."seed_meta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anchor_at" timestamp with time zone NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" text NOT NULL,
	"notes" text,
	CONSTRAINT "seed_meta_revision_unique" UNIQUE("revision")
);
--> statement-breakpoint
CREATE TABLE "app"."blackout_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blackout_dates_vendor_day_key" UNIQUE("vendor_id","day")
);
--> statement-breakpoint
CREATE TABLE "app"."capacity_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"order_id" uuid,
	"during" "tstzrange" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."daily_capacity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"day" date NOT NULL,
	"total" integer NOT NULL,
	"remaining" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_capacity_service_day_key" UNIQUE("service_id","day"),
	CONSTRAINT "daily_capacity_remaining_non_negative" CHECK ("app"."daily_capacity"."remaining" >= 0),
	CONSTRAINT "daily_capacity_remaining_within_total" CHECK ("app"."daily_capacity"."remaining" <= "app"."daily_capacity"."total")
);
--> statement-breakpoint
CREATE TABLE "app"."saved_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_services_user_service_key" UNIQUE("user_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "app"."service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"neighbourhood_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_areas_service_neighbourhood_key" UNIQUE("service_id","neighbourhood_id")
);
--> statement-breakpoint
CREATE TABLE "app"."service_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."service_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_price" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_packages_service_name_key" UNIQUE("service_id","name")
);
--> statement-breakpoint
CREATE TABLE "app"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"base_price" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"price_unit" "app"."price_unit" NOT NULL,
	"booking_mode" "app"."booking_mode" NOT NULL,
	"badge" text,
	"area_label" text,
	"rating_average" numeric(2, 1),
	"review_count" integer DEFAULT 0 NOT NULL,
	"tone_start" text,
	"tone_end" text,
	"published_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "app"."event_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"service_id" uuid,
	"order_id" uuid,
	"quote_request_id" uuid,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_date" date NOT NULL,
	"start_time" time,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"venue_name" text,
	"neighbourhood_id" uuid,
	"guest_count" integer,
	"budget" bigint,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"visibility" "app"."event_visibility" DEFAULT 'private' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"draft" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"service_id" uuid,
	"service_package_id" uuid,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" bigint NOT NULL,
	"line_total" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"event_id" uuid,
	"state" "app"."order_state" DEFAULT 'pending_payment' NOT NULL,
	"subtotal" bigint NOT NULL,
	"tax" bigint NOT NULL,
	"total" bigint NOT NULL,
	"commission" bigint NOT NULL,
	"commission_tax" bigint NOT NULL,
	"deposit_amount" bigint NOT NULL,
	"balance_amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"policy_template_id" uuid,
	"cooling_window_ends_at" timestamp with time zone,
	"balance_due_at" timestamp with time zone,
	"grace_expires_at" timestamp with time zone,
	"auto_complete_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"issue_note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "app"."quote_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_request_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"state" "app"."quote_offer_state" DEFAULT 'sent' NOT NULL,
	"subtotal" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"message" text,
	"line_items" jsonb,
	"valid_until" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_offers_request_vendor_key" UNIQUE("quote_request_id","vendor_id")
);
--> statement-breakpoint
CREATE TABLE "app"."quote_request_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_request_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_request_invites_request_vendor_key" UNIQUE("quote_request_id","vendor_id")
);
--> statement-breakpoint
CREATE TABLE "app"."quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid,
	"category_id" uuid NOT NULL,
	"state" "app"."quote_request_state" DEFAULT 'open' NOT NULL,
	"brief" text,
	"answers" jsonb,
	"guest_count" integer,
	"budget" bigint,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"token" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "app"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "app"."payment_kind" NOT NULL,
	"state" "app"."payment_state" DEFAULT 'pending' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"provider_payment_intent_id" text,
	"provider_charge_id" text,
	"off_session_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"succeeded_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_payment_intent_id_unique" UNIQUE("provider_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "app"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"state" "app"."refund_state" DEFAULT 'requested' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"reason" text,
	"recorded_externally_at" timestamp with time zone,
	"requested_by_user_id" uuid,
	"provider_refund_id" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id")
);
--> statement-breakpoint
CREATE TABLE "app"."stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"account" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "stripe_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "app"."transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"kind" "app"."transfer_kind" NOT NULL,
	"state" "app"."transfer_state" DEFAULT 'pending' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"provider_transfer_id" text,
	"held_reason" text,
	"paid_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_provider_transfer_id_unique" UNIQUE("provider_transfer_id"),
	CONSTRAINT "transfers_order_kind_key" UNIQUE("order_id","kind")
);
--> statement-breakpoint
CREATE TABLE "app"."job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"result" text,
	"error" text,
	"effective_now" timestamp with time zone NOT NULL,
	"real_now" timestamp with time zone NOT NULL,
	"clock_override_actor_id" uuid,
	"triggered_by" "app"."job_trigger" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "app"."job_type" NOT NULL,
	"status" "app"."job_status" DEFAULT 'queued' NOT NULL,
	"dedupe_key" text NOT NULL,
	"run_after" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"held_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_type_dedupe_key" UNIQUE("type","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "app"."email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"recipient_user_id" uuid,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"state" "app"."email_send_state" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_message_id" text,
	"merge_values" jsonb,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_sends_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "app"."email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"audience" "app"."email_audience" NOT NULL,
	"trigger" text,
	"automatic_since" timestamp with time zone,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"allowed_merge_fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link_path" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."thread_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_participants_thread_user_key" UNIQUE("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text,
	"order_id" uuid,
	"quote_request_id" uuid,
	"vendor_id" uuid,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"raised_by_user_id" uuid,
	"state" "app"."dispute_state" DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"provider_dispute_id" text,
	"amount" bigint,
	"currency" char(3) DEFAULT 'CAD' NOT NULL,
	"assigned_to_user_id" uuid,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disputes_provider_dispute_id_unique" UNIQUE("provider_dispute_id")
);
--> statement-breakpoint
CREATE TABLE "app"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"service_id" uuid,
	"rating" integer NOT NULL,
	"body" text,
	"moderation" "app"."moderation_state" DEFAULT 'approved' NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_order_key" UNIQUE("order_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("app"."reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."communication_consents" ADD CONSTRAINT "communication_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."vendor_members" ADD CONSTRAINT "vendor_members_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."vendor_members" ADD CONSTRAINT "vendor_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."blackout_dates" ADD CONSTRAINT "blackout_dates_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."capacity_blocks" ADD CONSTRAINT "capacity_blocks_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."daily_capacity" ADD CONSTRAINT "daily_capacity_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."saved_services" ADD CONSTRAINT "saved_services_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."saved_services" ADD CONSTRAINT "saved_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_areas" ADD CONSTRAINT "service_areas_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_areas" ADD CONSTRAINT "service_areas_neighbourhood_id_neighbourhoods_id_fk" FOREIGN KEY ("neighbourhood_id") REFERENCES "app"."neighbourhoods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_media" ADD CONSTRAINT "service_media_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."service_packages" ADD CONSTRAINT "service_packages_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."services" ADD CONSTRAINT "services_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."services" ADD CONSTRAINT "services_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."event_items" ADD CONSTRAINT "event_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."event_items" ADD CONSTRAINT "event_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."events" ADD CONSTRAINT "events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."events" ADD CONSTRAINT "events_neighbourhood_id_neighbourhoods_id_fk" FOREIGN KEY ("neighbourhood_id") REFERENCES "app"."neighbourhoods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkouts" ADD CONSTRAINT "checkouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."checkouts" ADD CONSTRAINT "checkouts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."order_items" ADD CONSTRAINT "order_items_service_package_id_service_packages_id_fk" FOREIGN KEY ("service_package_id") REFERENCES "app"."service_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_policy_template_id_policy_templates_id_fk" FOREIGN KEY ("policy_template_id") REFERENCES "app"."policy_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_offers" ADD CONSTRAINT "quote_offers_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "app"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_offers" ADD CONSTRAINT "quote_offers_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_request_invites" ADD CONSTRAINT "quote_request_invites_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "app"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_request_invites" ADD CONSTRAINT "quote_request_invites_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_requests" ADD CONSTRAINT "quote_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_requests" ADD CONSTRAINT "quote_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "app"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."quote_requests" ADD CONSTRAINT "quote_requests_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_links" ADD CONSTRAINT "payment_links_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."refunds" ADD CONSTRAINT "refunds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."transfers" ADD CONSTRAINT "transfers_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."job_runs" ADD CONSTRAINT "job_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "app"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."job_runs" ADD CONSTRAINT "job_runs_clock_override_actor_id_users_id_fk" FOREIGN KEY ("clock_override_actor_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_sends" ADD CONSTRAINT "email_sends_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."email_sends" ADD CONSTRAINT "email_sends_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "app"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."thread_participants" ADD CONSTRAINT "thread_participants_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "app"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."thread_participants" ADD CONSTRAINT "thread_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."threads" ADD CONSTRAINT "threads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."threads" ADD CONSTRAINT "threads_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "app"."quote_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."threads" ADD CONSTRAINT "threads_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."disputes" ADD CONSTRAINT "disputes_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "app"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "app"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "app"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reviews" ADD CONSTRAINT "reviews_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "app"."audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "app"."audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "app"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "communication_consents_user_idx" ON "app"."communication_consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_user_idx" ON "app"."user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_granted_by_idx" ON "app"."user_roles" USING btree ("granted_by");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "app"."users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vendor_members_user_idx" ON "app"."vendor_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vendors_status_idx" ON "app"."vendors" USING btree ("status");--> statement-breakpoint
CREATE INDEX "blackout_dates_vendor_idx" ON "app"."blackout_dates" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "capacity_blocks_service_idx" ON "app"."capacity_blocks" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "capacity_blocks_order_idx" ON "app"."capacity_blocks" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "saved_services_user_idx" ON "app"."saved_services" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_services_service_idx" ON "app"."saved_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_areas_service_idx" ON "app"."service_areas" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_areas_neighbourhood_idx" ON "app"."service_areas" USING btree ("neighbourhood_id");--> statement-breakpoint
CREATE INDEX "service_media_service_idx" ON "app"."service_media" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_packages_service_idx" ON "app"."service_packages" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "services_vendor_idx" ON "app"."services" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "services_category_idx" ON "app"."services" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "event_items_event_idx" ON "app"."event_items" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_items_service_idx" ON "app"."event_items" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "app"."events" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "app"."events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "events_neighbourhood_idx" ON "app"."events" USING btree ("neighbourhood_id");--> statement-breakpoint
CREATE INDEX "checkouts_user_idx" ON "app"."checkouts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "checkouts_event_idx" ON "app"."checkouts" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "app"."order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_service_idx" ON "app"."order_items" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "order_items_service_package_idx" ON "app"."order_items" USING btree ("service_package_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "app"."orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_vendor_idx" ON "app"."orders" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "orders_event_idx" ON "app"."orders" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "orders_state_idx" ON "app"."orders" USING btree ("state");--> statement-breakpoint
CREATE INDEX "orders_balance_due_idx" ON "app"."orders" USING btree ("balance_due_at");--> statement-breakpoint
CREATE INDEX "orders_policy_template_idx" ON "app"."orders" USING btree ("policy_template_id");--> statement-breakpoint
CREATE INDEX "quote_offers_request_idx" ON "app"."quote_offers" USING btree ("quote_request_id");--> statement-breakpoint
CREATE INDEX "quote_offers_vendor_idx" ON "app"."quote_offers" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "quote_request_invites_vendor_idx" ON "app"."quote_request_invites" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "quote_requests_user_idx" ON "app"."quote_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quote_requests_state_idx" ON "app"."quote_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "quote_requests_expires_idx" ON "app"."quote_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "quote_requests_category_idx" ON "app"."quote_requests" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "quote_requests_event_idx" ON "app"."quote_requests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "payment_links_order_idx" ON "app"."payment_links" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "app"."payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_state_idx" ON "app"."payments" USING btree ("state");--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "app"."refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_state_idx" ON "app"."refunds" USING btree ("state");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "app"."refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_requested_by_idx" ON "app"."refunds" USING btree ("requested_by_user_id");--> statement-breakpoint
CREATE INDEX "stripe_events_processed_idx" ON "app"."stripe_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "stripe_events_type_idx" ON "app"."stripe_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "transfers_vendor_idx" ON "app"."transfers" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "transfers_state_idx" ON "app"."transfers" USING btree ("state");--> statement-breakpoint
CREATE INDEX "job_runs_job_idx" ON "app"."job_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_runs_started_idx" ON "app"."job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "job_runs_clock_actor_idx" ON "app"."job_runs" USING btree ("clock_override_actor_id");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "app"."jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "email_sends_template_idx" ON "app"."email_sends" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "email_sends_state_idx" ON "app"."email_sends" USING btree ("state");--> statement-breakpoint
CREATE INDEX "email_sends_recipient_idx" ON "app"."email_sends" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "app"."messages" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "app"."messages" USING btree ("sender_user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "app"."notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "thread_participants_user_idx" ON "app"."thread_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "threads_order_idx" ON "app"."threads" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "threads_vendor_idx" ON "app"."threads" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "threads_quote_request_idx" ON "app"."threads" USING btree ("quote_request_id");--> statement-breakpoint
CREATE INDEX "disputes_order_idx" ON "app"."disputes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "disputes_state_idx" ON "app"."disputes" USING btree ("state");--> statement-breakpoint
CREATE INDEX "disputes_raised_by_idx" ON "app"."disputes" USING btree ("raised_by_user_id");--> statement-breakpoint
CREATE INDEX "disputes_assigned_to_idx" ON "app"."disputes" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX "reviews_vendor_idx" ON "app"."reviews" USING btree ("vendor_id");--> statement-breakpoint
CREATE INDEX "reviews_author_idx" ON "app"."reviews" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "reviews_service_idx" ON "app"."reviews" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "reviews_moderated_by_idx" ON "app"."reviews" USING btree ("moderated_by_user_id");