-- Environment grants (PRD-004 Story 4): owner grants a member access to a
-- specific environment. Presence-only: a row means "this member can use this
-- environment". Owners are NOT required to have rows; they implicitly access
-- every environment in the project. Only member rows matter here.
CREATE TABLE environment_grants (
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  environment_id TEXT NOT NULL REFERENCES environments(id),
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id, environment_id)
);
