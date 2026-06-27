import { useState } from "react";
import { api } from "../../lib/api";

type ImporterEnvironmentLite = {
  id: string;
  key: string;
  webhook_signing_enabled: boolean;
  secret_set: boolean;
};

type Props = {
  importerId: string;
  envId: string;
  importerEnvironment: ImporterEnvironmentLite;
  onUpdated: (next: ImporterEnvironmentLite) => void;
};

export function SigningSection({ importerId, envId, importerEnvironment: ie, onUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [confirmingRotateKey, setConfirmingRotateKey] = useState(false);

  async function enableSigning() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.api.importers[":importer_id"].environments[":env_id"].signing.$post({
        param: { importer_id: importerId, env_id: envId },
      });
      if (!res.ok) throw new Error(`Failed to enable signing: ${res.status}`);
      const data = await res.json();
      setRevealed(data.secret);
      onUpdated(data.importer_environment as ImporterEnvironmentLite);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function rotateSecret() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.api.importers[":importer_id"].environments[":env_id"][
        "rotate-secret"
      ].$post({
        param: { importer_id: importerId, env_id: envId },
      });
      if (!res.ok) throw new Error(`Failed to rotate secret: ${res.status}`);
      const data = await res.json();
      setRevealed(data.secret);
      onUpdated(data.importer_environment as ImporterEnvironmentLite);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey() {
    setBusy(true);
    setError(null);
    setConfirmingRotateKey(false);
    try {
      const res = await api.api.importers[":importer_id"].environments[":env_id"][
        "rotate-key"
      ].$post({
        param: { importer_id: importerId, env_id: envId },
      });
      if (!res.ok) throw new Error(`Failed to rotate key: ${res.status}`);
      const data = await res.json();
      onUpdated(data.importer_environment as ImporterEnvironmentLite);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function disableSigning() {
    setBusy(true);
    setError(null);
    setConfirmingDisable(false);
    try {
      const res = await api.api.importers[":importer_id"].environments[":env_id"].signing.$delete({
        param: { importer_id: importerId, env_id: envId },
      });
      if (!res.ok) throw new Error(`Failed to disable signing: ${res.status}`);
      onUpdated({ ...ie, webhook_signing_enabled: false, secret_set: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  function copySecret() {
    if (revealed) void navigator.clipboard.writeText(revealed);
  }

  return (
    <section className="flex flex-col gap-3 border-t border-slate-200 pt-6">
      <h2 className="text-sm font-medium text-slate-700">Webhook signing</h2>
      <p className="text-xs text-slate-500">
        When enabled, the worker signs each webhook delivery with an HMAC of the request body so
        your receiver can verify authenticity.
      </p>

      {!ie.webhook_signing_enabled ? (
        <button
          type="button"
          onClick={() => void enableSigning()}
          disabled={busy}
          className="self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Enable signing
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void rotateSecret()}
            disabled={busy}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            Rotate secret
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRotateKey(true)}
            disabled={busy}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            Rotate public key
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDisable(true)}
            disabled={busy}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50"
          >
            Disable signing
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {revealed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="secret-reveal-title"
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="flex w-full max-w-lg flex-col gap-3 rounded-md bg-white p-6 shadow-lg">
            <h3 id="secret-reveal-title" className="text-base font-semibold text-slate-900">
              Store this secret now
            </h3>
            <p className="text-sm text-amber-700">
              You won't be able to see this secret again. Store it somewhere safe before closing
              this dialog.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={revealed}
                readOnly
                className="flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                onClick={copySecret}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setRevealed(null)}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                I've stored it
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingDisable && (
        <ConfirmDialog
          title="Disable signing?"
          body="This will clear the stored secret. You'll need to enable signing again to generate a new one."
          confirmLabel="Disable signing"
          danger
          onCancel={() => setConfirmingDisable(false)}
          onConfirm={() => void disableSigning()}
        />
      )}
      {confirmingRotateKey && (
        <ConfirmDialog
          title="Rotate the public key?"
          body="Any clients still using the old key will start receiving 404s on upload. Make sure they have the new key before rotating."
          confirmLabel="Rotate key"
          onCancel={() => setConfirmingRotateKey(false)}
          onConfirm={() => void rotateKey()}
        />
      )}
    </section>
  );
}

type ConfirmProps = {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function ConfirmDialog({ title, body, confirmLabel, danger, onCancel, onConfirm }: ConfirmProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-md bg-white p-6 shadow-lg">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? "rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"
                : "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
