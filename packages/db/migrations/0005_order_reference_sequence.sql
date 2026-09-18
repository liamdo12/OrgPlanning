-- Order references came from `max(reference) + 1`, which two concurrent
-- checkouts compute identically. `reference` is unique, so the second booking
-- died on the constraint — an ordinary pair of customers booking at the same
-- moment, and one of them gets a 500.
--
-- A sequence answers once per caller whatever else is happening. It starts
-- above the seeded series (TO-4165 … TO-4207) so demo data and new bookings
-- read as one set, and `setval` is computed from the rows actually present
-- rather than hard-coded, so a seed that grows does not collide.

CREATE SEQUENCE IF NOT EXISTS "app"."planning_org_order_reference_seq" AS bigint START WITH 4208;--> statement-breakpoint

SELECT setval(
  'app.planning_org_order_reference_seq',
  GREATEST(
    4207,
    COALESCE(
      (SELECT max((substring("reference" FROM 'TO-([0-9]+)'))::bigint)
       FROM "app"."planning_org_orders"),
      4207
    )
  )
);--> statement-breakpoint

-- `app_rw` is the application's role; without this it cannot draw from the
-- sequence and every checkout fails on a permission error.
GRANT USAGE, SELECT ON SEQUENCE "app"."planning_org_order_reference_seq" TO "app_rw";
