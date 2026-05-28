import { useEffect, useState } from "react";
import { api } from "../../lib/api";

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
    return <p className="text-sm text-red-700">{loadError}</p>;
  }
  if (envs === null) {
    return <p className="text-sm text-slate-500">Loading environments…</p>;
  }
  if (envs.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No environments configured yet for this project.
      </p>
    );
  }

  const active = envs.find((e) => e.env_id === activeEnvId) ?? envs[0]!;

  function onSaved(env_id: string, updated: ImporterEnvironment) {
    setEnvs((prev) =>
      (prev ?? []).map((e) =>
        e.env_id === env_id
          ? { ...e, configured: true, importer_environment: updated }
          : e,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-1 border-b border-slate-200">
        {envs.map((e) => {
          const selected = e.env_id === active.env_id;
          return (
            <button
              key={e.env_id}
              type="button"
              onClick={() => setActiveEnvId(e.env_id)}
              className={
                selected
                  ? "border-b-2 border-slate-900 px-3 py-2 text-sm font-medium text-slate-900"
                  : "border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-900"
              }
            >
              {e.env_name} {e.configured ? null : <span className="text-xs text-slate-400">·  not configured</span>}
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
  const [includeUnmatched, setIncludeUnmatched] = useState(
    ie?.include_unmatched_columns ?? false,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    if (!k) return;
    void navigator.clipboard.writeText(k).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!envRow.configured && (
        <p className="text-sm text-slate-500">
          This environment isn't configured yet. Fill in the form below and save to enable
          uploads.
        </p>
      )}

      {envRow.importer_environment && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-700">
            Public key (used by clients)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={envRow.importer_environment.key}
              readOnly
              className="flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={handleCopyKey}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Webhook URL *</span>
        <input
          type="url"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://example.com/hooks/csv"
          className="rounded-md border border-slate-300 px-3 py-2"
        />
        {!urlValid && webhookUrl.length > 0 && (
          <span className="text-xs text-red-700">Must be an http(s) URL.</span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Batch size</span>
        <input
          type="number"
          value={batchSize}
          min={BATCH_MIN}
          max={BATCH_MAX}
          onChange={(e) => setBatchSize(Number(e.target.value))}
          className="rounded-md border border-slate-300 px-3 py-2 sm:max-w-xs"
        />
        {!batchValid && (
          <span className="text-xs text-red-700">
            Must be between {BATCH_MIN} and {BATCH_MAX}.
          </span>
        )}
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
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

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {envRow.configured ? "Save" : "Save and enable"}
        </button>
      </div>
    </div>
  );
}
