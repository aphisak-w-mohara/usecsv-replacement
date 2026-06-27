import { useState } from "react";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardBody, CardHeader } from "../ui/card";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Field } from "../ui/field";
import { Input } from "../ui/input";

export type GeneralTabImporter = {
  id: string;
  name: string;
  archived: boolean;
};

type Props = {
  importer: GeneralTabImporter;
  saving: boolean;
  saveError: string | null;
  onSave: (newName: string) => void;
  onArchive: () => void;
  onUnarchive: () => void;
};

export function ImporterGeneralTab({
  importer,
  saving,
  saveError,
  onSave,
  onArchive,
  onUnarchive,
}: Props) {
  const [name, setName] = useState(importer.name);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const trimmed = name.trim();
  const canSave = !saving && trimmed.length > 0 && trimmed !== importer.name;

  function handleSave() {
    if (!canSave) return;
    onSave(trimmed);
  }

  function handleArchiveConfirm() {
    setConfirmingArchive(false);
    onArchive();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="Importer name" />
        <CardBody className="flex flex-col gap-4">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
            <Field label="Importer name" className="flex-1">
              {(p) => (
                <Input
                  {...p}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                />
              )}
            </Field>
            <Button type="button" onClick={handleSave} disabled={!canSave} loading={saving}>
              Save
            </Button>
          </div>
          {saveError && <Alert tone="danger">{saveError}</Alert>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Archive"
          description="Archiving hides this importer from the list and prevents new uploads against it. Historical uploads remain viewable. You can unarchive later from the Show-archived view."
        />
        <CardBody>
          {importer.archived ? (
            <Button variant="outline" type="button" onClick={onUnarchive} disabled={saving}>
              Unarchive
            </Button>
          ) : (
            <Button
              variant="danger"
              type="button"
              onClick={() => setConfirmingArchive(true)}
              disabled={saving}
            >
              Archive
            </Button>
          )}
        </CardBody>
      </Card>

      {confirmingArchive && (
        <ConfirmDialog
          title={`Archive ${importer.name}?`}
          body="Archiving hides this importer from the list and prevents new uploads against it. Historical uploads remain viewable."
          confirmLabel="Archive importer"
          danger
          onCancel={() => setConfirmingArchive(false)}
          onConfirm={handleArchiveConfirm}
        />
      )}
    </div>
  );
}
