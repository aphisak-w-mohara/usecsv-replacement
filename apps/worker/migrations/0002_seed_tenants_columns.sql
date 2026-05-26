-- Story #4: seed the minimum column schema for the Tenants importer.
-- Three required columns drawn from the Laravel TenantsImport row keys
-- (first_name, last_name, email). The remaining Laravel-side columns
-- (mobile_number, home_number, property_id, organisation,
-- property_start_date, property_end_date, customer_resident_reference)
-- are tracked as a follow-up before real production Tenants imports.

-- Create the importer_columns table (needed since 0001 was already applied)
CREATE TABLE IF NOT EXISTS importer_columns (
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

INSERT INTO importer_columns (
  id, importer_id, position, name, display_name, description, example,
  must_be_matched, value_cannot_be_blank, validation_type, validation_format,
  custom_error_message
) VALUES
  (
    'col_tenants_first_name',
    'imp_tenants',
    1,
    'first_name',
    'First name',
    NULL,
    'Alice',
    1, 1,
    'string', NULL, NULL
  ),
  (
    'col_tenants_last_name',
    'imp_tenants',
    2,
    'last_name',
    'Last name',
    NULL,
    'Smith',
    1, 1,
    'string', NULL, NULL
  ),
  (
    'col_tenants_email',
    'imp_tenants',
    3,
    'email',
    'Customer Email',
    NULL,
    'alice@example.com',
    1, 1,
    'email', NULL, NULL
  );
