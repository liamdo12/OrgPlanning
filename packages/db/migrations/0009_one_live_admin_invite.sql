-- One live invitation per address, enforced by the database.
--
-- `inviteAdmin` revokes any outstanding invitation for the address before it
-- writes the new one, which reads as though it closes the hole. It does not, on
-- its own: the default isolation is `read committed`, so two requests arriving
-- together each revoke against a snapshot that does not contain the other's
-- row, and both then insert. Two working tokens, which is the outcome the
-- revoke exists to prevent — and revoking the one an administrator can see
-- leaves the other granting the admin role.
--
-- A double-submitted form is the ordinary way to produce two concurrent
-- requests, so this is not a theoretical race.
--
-- Partial, because the uniqueness only applies to invitations still in play. An
-- address can be invited again after the first was revoked, and the history of
-- both stays in the table.

CREATE UNIQUE INDEX "admin_invites_one_live_per_email"
  ON "app"."planning_org_admin_invites" USING btree ("email")
  WHERE "revoked_at" IS NULL AND "accepted_at" IS NULL;
