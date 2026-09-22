-- `rating_average` was nullable, and the catalogue sorts on it.
--
-- A service nobody has reviewed had no rating. Postgres orders NULLs first
-- under DESC, so every unrated listing sat above a five-star business; and a
-- keyset page compares the cursor's value against the column, which against
-- NULL is NULL — neither true nor false, so that row matches no page and is
-- unreachable at any offset. The seeded catalogue rates every service, so both
-- faults are invisible here and appear on the first real listing.
--
-- Zero is the honest reading of "nobody has reviewed this yet", and it sorts
-- where that belongs. The backfill runs before the constraint so the alter
-- cannot fail on a live row, and touches nothing that already has a rating.
UPDATE "app"."planning_org_services"
  SET "rating_average" = 0
  WHERE "rating_average" IS NULL;--> statement-breakpoint

ALTER TABLE "app"."planning_org_services"
  ALTER COLUMN "rating_average" SET DEFAULT 0;--> statement-breakpoint

ALTER TABLE "app"."planning_org_services"
  ALTER COLUMN "rating_average" SET NOT NULL;--> statement-breakpoint

-- One index per offered sort, each partial on the condition every discovery
-- query carries. The predicate is inside the index rather than beside it
-- because an index on `published_at` alone has nothing to discriminate on —
-- almost every row is published — so the planner would never choose it, while
-- a partial index on the sort columns satisfies the filter and the ordering in
-- one scan and returns a page without sorting the table.
--
-- Both members descend together, because the keyset predicate is a row
-- comparison: `(rating, id) < (value, id)` is only the page after the cursor
-- when the ordering is `rating desc, id desc`. An index on the leading column
-- alone re-sorts the ties on every page after the first.
--
-- The NULLS direction is what makes them usable at all: plain `order by x desc`
-- means `desc nulls first`, and an index built the other way round cannot
-- satisfy that ordering, so it is simply never chosen — a sequential scan per
-- page that no test and no error would report. Same reasoning as
-- `orders_created_idx`.

CREATE INDEX "services_rating_idx"
  ON "app"."planning_org_services"
  USING btree ("rating_average" DESC NULLS FIRST, "id" DESC NULLS FIRST)
  WHERE "published_at" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "services_reviews_idx"
  ON "app"."planning_org_services"
  USING btree ("review_count" DESC NULLS FIRST, "id" DESC NULLS FIRST)
  WHERE "published_at" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "services_price_idx"
  ON "app"."planning_org_services"
  USING btree ("base_price" ASC NULLS LAST, "id" ASC NULLS LAST)
  WHERE "published_at" IS NOT NULL;--> statement-breakpoint

-- The results page shows up to three pictures per card and reads them in the
-- same query as the cards, by a lateral join ordered on `sort_order`. The
-- shipped index is on `service_id` alone, which finds the rows and then sorts
-- them once per service — a sort per card on the busiest screen in the
-- product. With the order in the key the lateral scan stops after three.
CREATE INDEX "service_media_service_sort_idx"
  ON "app"."planning_org_service_media"
  USING btree ("service_id", "sort_order");
