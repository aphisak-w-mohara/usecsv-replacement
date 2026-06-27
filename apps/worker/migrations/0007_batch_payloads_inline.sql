-- Move batch payloads off R2 and into D1 (gzipped), so the importer runs on the
-- Workers Free plan with no R2 -- and therefore no payment method / card on file.
-- D1 (single-primary, replication off) gives the strong read-after-write the
-- dispatcher needs: it reads each payload back milliseconds after ingest writes it.
--
-- Payloads are gzipped (CSV-derived JSON compresses ~5-10x) to stay well under
-- D1's hard 2 MB per-row limit. The (upload_id, batch_index) PK still provides the
-- idempotent skip-if-exists that the R2 key path used to.
ALTER TABLE upload_batches ADD COLUMN payload BLOB;
ALTER TABLE upload_batches ADD COLUMN payload_encoding TEXT NOT NULL DEFAULT 'gzip';

-- r2_key is obsolete now that the payload lives inline.
ALTER TABLE upload_batches DROP COLUMN r2_key;

-- uploads.r2_source_key pointed at a raw source-file object that was never
-- actually written to R2 (parsing is client-side; PII only arrives as batches).
-- With R2 dropped, remove the dead column too.
ALTER TABLE uploads DROP COLUMN r2_source_key;
