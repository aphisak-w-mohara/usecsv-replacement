import type { ReactNode } from "react";
import { Alert } from "./alert";
import { Button } from "./button";
import { Modal } from "./modal";

type Props = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
  /** Disable both buttons while an async action is in flight. */
  busy?: boolean;
  /** Inline error to surface inside the dialog (e.g. a failed delete). */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Shared confirmation modal. Used for every destructive/irreversible action
 * (archive, delete column, disable signing, revoke invite). Built on Modal, so
 * it inherits focus trap, focus restore, Escape-to-cancel, and scroll lock. The
 * in-flight `busy` state blocks dismissal so a slow confirm can't be double-fired.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      size="sm"
      dismissable={!busy}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {body && <div className="text-sm text-muted-foreground">{body}</div>}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}
