# Master PRD Index

**Project:** evo-csv (self-hosted usecsv clone for Mohara)
**Last updated:** 2026-05-28
**Version:** 1.2

## PRD Registry

| ID | Type | Name | File | Version | Status | Date |
|---|---|---|---|---|---|---|
| PRD-001 | High-Level | evo-csv | [prd-high-evo-csv.md](prd-high-evo-csv.md) | 1.0 | Draft — Pending Review | 2026-05-26 |
| PRD-002 | Feature | Upload Wizard | [prd-feature-upload-wizard.md](prd-feature-upload-wizard.md) | 1.0 | Draft — Pending Review | 2026-05-26 |
| PRD-003 | Feature | Importer CRUD + Per-Environment Config | [prd-feature-importer-crud-config.md](prd-feature-importer-crud-config.md) | 1.0 | Draft — Pending Review | 2026-05-28 |

## PRD Hierarchy

```
PRD-001 evo-csv (High-Level)
├── PRD-002 Upload Wizard (Feature)  ← 5 stories: context · file pick · column match · review/edit · submit
└── PRD-003 Importer CRUD + Per-Environment Config (Feature)  ← 6 stories: list+create · general · column CRUD · column reorder · env config · signing
```

**Forthcoming sibling feature PRDs under PRD-001:**
- Auth & bootstrap (Google SSO + CLI seed)
- Webhook dispatch pipeline (Queue consumer + retry/halt)

## Related artefacts

- **Design spec:** [`docs/superpowers/specs/2026-05-26-usecsv-clone-design.md`](../docs/superpowers/specs/2026-05-26-usecsv-clone-design.md) — technical implementation reference; the PRD describes *what* and *why*, the spec describes *how*.
- **Captured webhook payload (reference fixture):** [`captured-payloads/2026-05-26-usecsv-live-webhook.json`](../captured-payloads/2026-05-26-usecsv-live-webhook.json)
- **usecsv admin screenshots:** [`usecsv-screenshots/`](../usecsv-screenshots/)
