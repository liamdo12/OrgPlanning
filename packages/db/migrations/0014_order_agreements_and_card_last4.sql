-- What a customer agreed to when they pressed Pay, and the card it was taken on.

-- The figures the checkout screen displayed, recorded at the moment consent was
-- given. The order's own columns are what will be charged; these are what the
-- person said yes to, and the two are written in the same transaction so they
-- cannot disagree. Keeping only the order's columns would leave nothing to
-- answer "what were they shown" after a rate change, which is the whole
-- question a consent record exists for.
--
-- All nullable, and no backfill: every order written before this migration
-- consented to nothing that was recorded, and inventing figures for them would
-- make a fabricated consent record indistinguishable from a real one.
ALTER TABLE "app"."planning_org_orders"
  ADD COLUMN "agreed_at" timestamp with time zone,
  ADD COLUMN "agreed_total" bigint,
  ADD COLUMN "agreed_deposit_amount" bigint,
  ADD COLUMN "agreed_balance_amount" bigint,
  ADD COLUMN "agreed_balance_due_at" timestamp with time zone;--> statement-breakpoint

-- The last four digits of the card a charge settled on.
--
-- The one detail about a payment instrument this schema keeps, and it is kept
-- because a customer whose balance was declined has to be told which card to
-- fix, and because the planner says which card the balance will be taken on.
-- Nothing else about the card is stored: the provider holds the instrument, and
-- this is four digits that identify it to the person who owns it.
--
-- Null is an ordinary answer. A pending attempt has no card yet, and a declined
-- off-session charge does not always come back with one attached.
ALTER TABLE "app"."planning_org_payments"
  ADD COLUMN "card_last4" text;
