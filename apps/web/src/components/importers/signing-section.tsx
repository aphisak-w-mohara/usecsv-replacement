import { useState } from "react";
import { api } from "../../lib/api";
import { useCopy } from "../../lib/use-copy";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CheckIcon, CopyIcon } from "../ui/icons";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";

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
  const { copied, copy } = useCopy();

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
    if (revealed) copy(revealed);
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-6">
      <h2 className="text-sm font-medium text-foreground">Webhook signing</h2>
      <p className="text-xs text-muted-foreground">
        When enabled, the worker signs each webhook delivery with an HMAC of the request body so
        your receiver can verify authenticity.
      </p>

      {!ie.webhook_signing_enabled ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void enableSigning()} loading={busy}>
            Enable signing
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void rotateSecret()} disabled={busy}>
            Rotate secret
          </Button>
          <Button variant="outline" onClick={() => setConfirmingRotateKey(true)} disabled={busy}>
            Rotate public key
          </Button>
          <Button variant="danger" onClick={() => setConfirmingDisable(true)} disabled={busy}>
            Disable signing
          </Button>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <Modal
        open={revealed !== null}
        onClose={() => setRevealed(null)}
        title="Store this secret now"
        footer={<Button onClick={() => setRevealed(null)}>I've stored it</Button>}
      >
        <div className="flex flex-col gap-3">
          <Alert tone="warning">
            You won't be able to see this secret again. Store it somewhere safe before closing this
            dialog.
          </Alert>
          {revealed && (
            <div className="flex gap-2">
              <Input type="text" value={revealed} readOnly className="flex-1 font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={copySecret}
                aria-label={copied ? "Copied" : "Copy secret"}
                icon={copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              />
            </div>
          )}
        </div>
      </Modal>

      {confirmingDisable && (
        <ConfirmDialog
          title="Disable signing?"
          body="This will clear the stored secret. You'll need to enable signing again to generate a new one."
          confirmLabel="Disable signing"
          danger
          busy={busy}
          onCancel={() => setConfirmingDisable(false)}
          onConfirm={() => void disableSigning()}
        />
      )}
      {confirmingRotateKey && (
        <ConfirmDialog
          title="Rotate the public key?"
          body="Any clients still using the old key will start receiving 404s on upload. Make sure they have the new key before rotating."
          confirmLabel="Rotate key"
          busy={busy}
          onCancel={() => setConfirmingRotateKey(false)}
          onConfirm={() => void rotateKey()}
        />
      )}
    </section>
  );
}
