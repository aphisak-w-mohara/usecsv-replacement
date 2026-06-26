-- Invites (PRD-004 Story 3): owner invites a teammate by email.
-- A pending invite is materialized into a users row + membership when the
-- invitee completes Google SSO with the matching email (auth callback branch 3).
CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  email TEXT NOT NULL,            -- stored lowercased
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  token TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,    -- created_at + 7 days
  accepted_at INTEGER
);

-- At most one pending (un-accepted) invite per (project, email). Accepted
-- invites are kept for audit and are excluded from this partial index, so an
-- email can be re-invited after a prior invite is accepted or revoked.
CREATE UNIQUE INDEX invites_pending_unique ON invites(project_id, email) WHERE accepted_at IS NULL;
