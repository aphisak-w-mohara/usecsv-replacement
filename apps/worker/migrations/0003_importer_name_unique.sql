-- Backstop for the application-level dedupe in POST /api/importers.
-- The handler does a case-insensitive SELECT-then-INSERT, which has a race
-- window with no DB guarantee. This index makes the (project, name) dedupe
-- self-enforcing. COLLATE NOCASE matches the handler's lower(name) check
-- (both fold ASCII only), so "Tenants"/"tenants" collide as intended.
-- Seed data (proj_evo / "Tenants") is the only importer at this point and
-- does not violate the constraint.
CREATE UNIQUE INDEX importers_project_name_unique
  ON importers (project_id, name COLLATE NOCASE);
