import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useCopy } from "../../lib/use-copy";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { CheckIcon, CopyIcon } from "../ui/icons";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { SigningSection } from "./signing-section";

type ImporterEnvironment = {
  id: string;
  key: string;
  webhook_url: string;
  batch_size: number;
  filter_invalid_rows: boolean;
  include_unmatched_columns: boolean;
  webhook_signing_enabled: boolean;
  secret_set: boolean;
};

type EnvRow = {
  env_id: string;
  env_slug: string;
  env_name: string;
  is_default: boolean;
  configured: boolean;
  importer_environment: ImporterEnvironment | null;
};

type Props = {
  importerId: string;
};

const BATCH_MIN = 1;
const BATCH_MAX = 50000;

export function EnvironmentsTab({ importerId }: Props) {
  const [envs, setEnvs] = useState<EnvRow[] | null>(null);
  const [activeEnvId, setActiveEnvId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setEnvs(null);
    // Reset selection so a previous importer's env id never bleeds into this load.
    // The `active` fallback below also handles a stale id, but resetting keeps state honest.
    setActiveEnvId(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].environments.$get({
          param: { importer_id: importerId },
        });
        if (!res.ok) throw new Error(`Failed to load environments: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setEnvs(data.environments as EnvRow[]);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [importerId]);

  if (loadError) {
    return <Alert tone="danger">{loadError}</Alert>;
  }
  if (envs === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading environments…
      </div>
    );
  }
  if (envs.length === 0) {
    return <Alert tone="info">No environments configured yet for this project.</Alert>;
  }

  const active = envs.find((e) => e.env_id === activeEnvId) ?? envs[0]!;

  function onSaved(env_id: string, updated: ImporterEnvironment) {
    setEnvs((prev) =>
      (prev ?? []).map((e) =>
        e.env_id === env_id ? { ...e, configured: true, importer_environment: updated } : e,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {envs.map((e) => {
          const selected = e.env_id === active.env_id;
          return (
            <button
              key={e.env_id}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => setActiveEnvId(e.env_id)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
                selected
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{e.env_name}</span>
              {e.is_default && (
                <Badge tone="primary" className="px-1.5 py-0">
                  Default
                </Badge>
              )}
              {!e.configured && (
                <span className="text-xs text-muted-foreground">· not configured</span>
              )}
            </button>
          );
        })}
      </nav>
      <EnvironmentConfigForm
        key={active.env_id}
        importerId={importerId}
        envRow={active}
        onSaved={onSaved}
      />
      {active.importer_environment && (
        <SigningSection
          importerId={importerId}
          envId={active.env_id}
          importerEnvironment={active.importer_environment}
          onUpdated={(next) => onSaved(active.env_id, { ...active.importer_environment!, ...next })}
        />
      )}
    </div>
  );
}

type FormProps = {
  importerId: string;
  envRow: EnvRow;
  onSaved: (env_id: string, updated: ImporterEnvironment) => void;
};

function EnvironmentConfigForm({ importerId, envRow, onSaved }: FormProps) {
  const ie = envRow.importer_environment;
  const [webhookUrl, setWebhookUrl] = useState(ie?.webhook_url ?? "");
  const [batchSize, setBatchSize] = useState<number>(ie?.batch_size ?? 1000);
  const [filterInvalid, setFilterInvalid] = useState(ie?.filter_invalid_rows ?? false);
  const [includeUnmatched, setIncludeUnmatched] = useState(ie?.include_unmatched_columns ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  const urlValid = /^https?:\/\//i.test(webhookUrl);
  const batchValid = batchSize >= BATCH_MIN && batchSize <= BATCH_MAX;
  const canSave = !saving && urlValid && batchValid;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.api.importers[":importer_id"].environments[":env_id"].$put({
        param: { importer_id: importerId, env_id: envRow.env_id },
        json: {
          webhook_url: webhookUrl,
          batch_size: batchSize,
          filter_invalid_rows: filterInvalid,
          include_unmatched_columns: includeUnmatched,
        },
      });
      if (!res.ok) throw new Error(`Failed to save: ${res.status}`);
      const data = await res.json();
      onSaved(envRow.env_id, data.importer_environment as ImporterEnvironment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  function handleCopyKey() {
    const k = envRow.importer_environment?.key;
    if (k) copy(k);
  }

  return (
    <div className="flex flex-col gap-4">
      {!envRow.configured && (
        <Alert tone="info">
          This environment isn't configured yet. Fill in the form below and save to enable uploads.
        </Alert>
      )}

      {envRow.importer_environment && (
        <Field label="Public key (used by clients)">
          {(p) => (
            <div className="flex gap-2">
              <Input
                {...p}
                type="text"
                value={envRow.importer_environment?.key ?? ""}
                readOnly
                className="flex-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyKey}
                aria-label={copied ? "Copied" : "Copy public key"}
                icon={copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              />
            </div>
          )}
        </Field>
      )}

      <Field
        label="Webhook URL"
        required
        error={!urlValid && webhookUrl.length > 0 ? "Must be an http(s) URL." : undefined}
      >
        {(p) => (
          <Input
            {...p}
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://example.com/hooks/csv"
          />
        )}
      </Field>

      <Field
        label="Batch size"
        error={!batchValid ? `Must be between ${BATCH_MIN} and ${BATCH_MAX}.` : undefined}
      >
        {(p) => (
          <Input
            {...p}
            type="number"
            value={batchSize}
            min={BATCH_MIN}
            max={BATCH_MAX}
            onChange={(e) => setBatchSize(Number(e.target.value))}
            className="sm:max-w-xs"
          />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filterInvalid}
            onChange={(e) => setFilterInvalid(e.target.checked)}
          />
          Filter invalid rows (skip rows that fail validation instead of failing the upload)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeUnmatched}
            onChange={(e) => setIncludeUnmatched(e.target.checked)}
          />
          Include unmatched columns in the webhook payload
        </label>
      </fieldset>

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!canSave} loading={saving}>
          {envRow.configured ? "Save" : "Save and enable"}
        </Button>
      </div>
    </div>
  );
}
