-- Idempotency for POST /api/uploads. Partial unique index so multiple NULLs are allowed
-- (uploads created before idempotency keys, or without one, don't collide).
ALTER TABLE uploads ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_uploads_idempotency
  ON uploads (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- One row per persisted batch payload. PK gives (upload_id, batch_index) idempotency.
CREATE TABLE upload_batches (
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  batch_index INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (upload_id, batch_index)
);

-- One row per delivery attempt. Written by the dispatch consumer, read by the status endpoint.
CREATE TABLE webhook_attempts (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(id),
  batch_index INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  status_code INTEGER,
  response_body TEXT,          -- truncated to ~16 KB by the consumer
  errors_json TEXT,            -- parsed { errors: [{row,msg}] } from Laravel, as a JSON string
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE (upload_id, batch_index, attempt_number)
);
CREATE INDEX idx_webhook_attempts_upload ON webhook_attempts (upload_id);
