-- Projects (tenants)
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  allowed_email_domain TEXT,
  created_at INTEGER NOT NULL
);

-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  google_sub TEXT UNIQUE,
  name TEXT NOT NULL,
  picture_url TEXT,
  last_active_project_id TEXT,
  last_active_environment_id TEXT,
  created_at INTEGER NOT NULL
);

-- Memberships
CREATE TABLE memberships (
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (project_id, user_id)
);

-- Environments
CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, slug)
);

-- Importers (logical, schema-bearing)
CREATE TABLE importers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Importer environments (per-(importer x env) delivery config)
CREATE TABLE importer_environments (
  id TEXT PRIMARY KEY,
  importer_id TEXT NOT NULL REFERENCES importers(id),
  environment_id TEXT NOT NULL REFERENCES environments(id),
  key TEXT UNIQUE NOT NULL,
  webhook_url TEXT NOT NULL,
  webhook_signing_enabled INTEGER NOT NULL DEFAULT 0,
  webhook_secret TEXT,
  batch_size INTEGER NOT NULL DEFAULT 1000,
  filter_invalid_rows INTEGER NOT NULL DEFAULT 0,
  include_unmatched_columns INTEGER NOT NULL DEFAULT 0,
  UNIQUE(importer_id, environment_id)
);

-- Importer columns (schema-bearing metadata for file headers)
CREATE TABLE importer_columns (
  id TEXT PRIMARY KEY,
  importer_id TEXT NOT NULL REFERENCES importers(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  example TEXT,
  must_be_matched INTEGER NOT NULL DEFAULT 1,
  value_cannot_be_blank INTEGER NOT NULL DEFAULT 1,
  validation_type TEXT NOT NULL DEFAULT 'string',
  validation_format TEXT,
  custom_error_message TEXT,
  UNIQUE(importer_id, position),
  UNIQUE(importer_id, name)
);

-- Uploads
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  numeric_id INTEGER UNIQUE NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  importer_environment_id TEXT NOT NULL REFERENCES importer_environments(id),
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  r2_source_key TEXT NOT NULL,
  matched_columns_map TEXT NOT NULL,
  uploaded_file_headers TEXT NOT NULL,
  user_payload TEXT,
  metadata_payload TEXT,
  total_rows INTEGER NOT NULL,
  batch_size INTEGER NOT NULL,
  batch_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatching', 'completed', 'halted', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sequence counter for numeric_id
CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sequences (name, value) VALUES ('upload_numeric', 0);

-- Seed: one project, one env, one user (the dev owner), one importer, one importer_environment
-- These IDs are stable across dev so tests can reference them.
INSERT INTO projects (id, slug, name, created_at)
VALUES ('proj_evo', 'evo', 'EVO', unixepoch());

INSERT INTO environments (id, project_id, slug, name, is_default, created_at)
VALUES ('env_evo_staging', 'proj_evo', 'staging', 'Staging', 1, unixepoch());

INSERT INTO users (id, email, name, created_at)
VALUES ('usr_dev', 'aphisak@mohara.co', 'Aphisak Naksomboon', unixepoch());

INSERT INTO memberships (project_id, user_id, role)
VALUES ('proj_evo', 'usr_dev', 'owner');

INSERT INTO importers (id, project_id, name, created_at, updated_at)
VALUES ('imp_tenants', 'proj_evo', 'Tenants', unixepoch(), unixepoch());

INSERT INTO importer_environments (id, importer_id, environment_id, key, webhook_url)
VALUES (
  'impenv_tenants_staging',
  'imp_tenants',
  'env_evo_staging',
  '82b18e5e-6412-4102-901a-ce3c05d71460',
  'https://webhook.site/6d8413f2-d7ea-4ac5-97c9-dfa1fdb5b9fc'
);
