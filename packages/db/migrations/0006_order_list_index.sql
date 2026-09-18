-- The admin order list reads newest first and pages with a keyset cursor on
-- `(created_at, id)`. Without an index in that exact order every page sorts the
-- whole table, and `id` is in the key because two orders from one checkout are
-- written in the same transaction and share a timestamp to the microsecond.
--
-- `NULLS FIRST` is what makes the planner use it. Neither column is nullable,
-- so the choice changes no result — but plain `order by x desc` means
-- `desc nulls first`, and an index built `desc nulls last` cannot satisfy that
-- ordering. Built the other way round it is simply never chosen, which is a
-- sequential scan per page that no test and no error would report.

CREATE INDEX "orders_created_idx" ON "app"."planning_org_orders" USING btree ("created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);
