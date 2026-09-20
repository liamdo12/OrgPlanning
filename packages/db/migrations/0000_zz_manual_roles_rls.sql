-- Roles, row-level security, and the constraints Drizzle cannot express.
--
-- NAMING: generated migrations keep drizzle-kit's `NNNN_name.sql`; hand-written
-- ones use `NNNN_zz_manual_name.sql`, where NNNN is the generated migration they
-- must run after. `zz` sorts them last within that number without ever
-- colliding with a name the generator would choose.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- btree_gist lets an exclusion constraint mix equality (service_id) with range
-- overlap (during) in one index.
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- pg_trgm backs fuzzy search over names and titles.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Overlap protection
-- ---------------------------------------------------------------------------

-- Two ACTIVE blocks for the same service may not overlap in time. This is the
-- only double-booking guarantee that holds under concurrency: two requests
-- that both pass an application-level "is it free?" check still cannot both
-- commit past this.
ALTER TABLE "app"."capacity_blocks"
  ADD CONSTRAINT "capacity_blocks_no_overlap"
  EXCLUDE USING gist (
    "service_id" WITH =,
    "during" WITH &&
  ) WHERE ("active");

-- A capacity block belongs to the order that holds it. The reference lives
-- here rather than in the Drizzle schema because `ordering` already imports
-- `catalog`, and declaring it there would make the two modules circular.
ALTER TABLE "app"."capacity_blocks"
  ADD CONSTRAINT "capacity_blocks_order_id_orders_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "app"."orders"("id") ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Search indexes
-- ---------------------------------------------------------------------------

CREATE INDEX "services_title_trgm_idx"
  ON "app"."services" USING gin ("title" gin_trgm_ops);
CREATE INDEX "vendors_name_trgm_idx"
  ON "app"."vendors" USING gin ("name" gin_trgm_ops);
CREATE INDEX "users_email_trgm_idx"
  ON "app"."users" USING gin ("email" gin_trgm_ops);
CREATE INDEX "users_full_name_trgm_idx"
  ON "app"."users" USING gin ("full_name" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
--
-- app_owner  owns the schema; migrations run as this role. NOLOGIN.
-- app_rw     the role the application connects as. NOLOGIN here — the deploy
--            pipeline sets the credential, so no password is ever committed.
--
-- Row-level security below is enabled with ZERO policies, which denies
-- everything by default. Authorization lives in the service layer, not in the
-- database, so app_rw is granted BYPASSRLS. The combination is deliberate: a
-- connection that somehow reaches the database from the browser sees nothing at
-- all, while the server-side service layer remains the single place where
-- access decisions are made.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    CREATE ROLE "app_owner" NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE "app_rw" NOLOGIN;
  END IF;

  -- Supabase creates these; a plain Postgres does not. Both must end up with
  -- no grants, so the test asserting that means the same thing everywhere.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE "anon" NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE "authenticated" NOLOGIN;
  END IF;
END
$$;

-- Must come BEFORE the ownership change below: reassigning ownership requires
-- the current role to already be able to SET ROLE to the target, so doing this
-- second fails with "must be able to SET ROLE app_owner" on every non-superuser
-- host — after 0000 has already created the tables without RLS.
GRANT "app_owner" TO CURRENT_USER;

-- app_rw must be exempt from the deny-all policy set, or the application reads
-- nothing. The exemption is BYPASSRLS; the alternative is to make app_rw a
-- member of app_owner, which also hands the application role DDL over the
-- schema. That is a real trade-off and not one a migration should make
-- silently, so a host that can do neither fails and says so instead.
--
-- Granting BYPASSRLS does not require superuser. From PostgreSQL 16 a role with
-- CREATEROLE may grant any attribute it holds itself, so a non-superuser
-- administrator that has BYPASSRLS can pass it on — which is what managed hosts
-- provide instead of a superuser. Asking `rolsuper` therefore refuses a host
-- that is perfectly capable, so ask the only question that settles it: try it.
-- Before 16, and on any host that withholds the attribute, the ALTER raises
-- insufficient_privilege and the membership branch below is the answer.
DO $$
BEGIN
  BEGIN
    ALTER ROLE "app_rw" BYPASSRLS;
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
    -- Not fatal here. The branches below decide whether an exemption exists by
    -- some other route, and only then give up.
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw' AND rolbypassrls) THEN
    RAISE NOTICE 'app_rw holds BYPASSRLS and is exempt from RLS';
  ELSIF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles owner ON owner.oid = m.roleid AND owner.rolname = 'app_owner'
    JOIN pg_roles member ON member.oid = m.member AND member.rolname = 'app_rw'
  ) THEN
    RAISE NOTICE 'app_rw is a member of app_owner and is exempt from RLS by ownership';
  ELSE
    RAISE EXCEPTION USING
      MESSAGE = 'cannot grant BYPASSRLS to app_rw and app_rw is not a member of app_owner',
      DETAIL  = 'Row-level security is deny-all. Without an exemption the application reads zero rows from every table.',
      HINT    = 'Migrate as a role that holds BYPASSRLS on PostgreSQL 16 or later, or GRANT app_owner TO app_rw before migrating and accept that the application role gains DDL over the app schema.';
  END IF;
END
$$;

ALTER SCHEMA "app" OWNER TO "app_owner";

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON SCHEMA "app" FROM PUBLIC, "anon", "authenticated";
GRANT USAGE ON SCHEMA "app" TO "app_rw";

DO $$
DECLARE
  target text;
BEGIN
  FOR target IN
    -- `__migrations` is the migrator's ledger, not application data. Leaving it
    -- in would give app_rw DELETE on the migration history and put RLS on the
    -- one table a future migrator must be able to read before it is privileged.
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'app' AND tablename <> '__migrations'
  LOOP
    EXECUTE format('ALTER TABLE app.%I OWNER TO app_owner', target);
    EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC, anon, authenticated', target);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON app.%I TO app_rw', target);
    -- Enabled with no policies: deny-all for anything that is not exempt.
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END
$$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA "app" FROM PUBLIC, "anon", "authenticated";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "app" TO "app_rw";

-- Default privileges carry GRANTS to future tables, and nothing else. They do
-- NOT enable row-level security, and they only apply to objects created by the
-- role that ran this statement. A later migration that adds a table therefore
-- gets app_rw's DML automatically and leaves RLS OFF — which fails open.
--
-- Every migration that creates a table must end by enabling RLS on it.
ALTER DEFAULT PRIVILEGES IN SCHEMA "app"
  REVOKE ALL ON TABLES FROM PUBLIC, "anon", "authenticated";
ALTER DEFAULT PRIVILEGES IN SCHEMA "app"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw";
