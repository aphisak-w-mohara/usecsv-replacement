import { useMemo, useState } from "react";
import { validateJsonField } from "../../lib/json-validate";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

export type StepContextSubmit = {
  ticketReference: string;
  note: string;
  userPayload: Record<string, unknown> | null;
  metadataPayload: Record<string, unknown> | null;
};

type Props = {
  onSubmit: (value: StepContextSubmit) => void;
};

export function StepContext({ onSubmit }: Props) {
  const [ticketReference, setTicketReference] = useState("");
  const [note, setNote] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [userPayloadRaw, setUserPayloadRaw] = useState("");
  const [metadataPayloadRaw, setMetadataPayloadRaw] = useState("");

  const userPayloadResult = useMemo(() => validateJsonField(userPayloadRaw), [userPayloadRaw]);
  const metadataPayloadResult = useMemo(
    () => validateJsonField(metadataPayloadRaw),
    [metadataPayloadRaw],
  );

  const canSubmit = userPayloadResult.ok && metadataPayloadResult.ok;

  function handleNext() {
    if (!canSubmit) return;

    // ticket_reference + note auto-pack into metadata_payload (unless the
    // advanced metadata field is already populated, in which case the user's
    // raw JSON wins).
    let metadataFromForm = metadataPayloadResult.ok ? metadataPayloadResult.value : null;
    if (metadataFromForm === null && (ticketReference || note)) {
      metadataFromForm = {
        ticket_reference: ticketReference,
        note,
      };
    }

    onSubmit({
      ticketReference,
      note,
      userPayload: userPayloadResult.ok ? userPayloadResult.value : null,
      metadataPayload: metadataFromForm,
    });
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        handleNext();
      }}
    >
      <header>
        <h2 className="text-lg font-semibold text-foreground">Upload context</h2>
        <p className="text-sm text-muted-foreground">
          Optional. Attach a ticket reference and a note so this import is easy to trace later. All
          fields are optional.
        </p>
      </header>

      <Field label="Ticket reference" optional>
        {(p) => (
          <Input
            {...p}
            type="text"
            value={ticketReference}
            onChange={(e) => setTicketReference(e.target.value)}
            placeholder="EVO-1234"
          />
        )}
      </Field>

      <Field label="Note" optional>
        {(p) => (
          <Textarea
            {...p}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Onboarding Smith Property Group, batch 1 of 3"
            rows={3}
          />
        )}
      </Field>

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdvancedOpen((open) => !open)}
          aria-expanded={advancedOpen}
          aria-controls="advanced-json-payloads"
        >
          {advancedOpen ? "Hide advanced" : "Show advanced (raw JSON payloads)"}
        </Button>
      </div>

      {advancedOpen && (
        <div
          id="advanced-json-payloads"
          className="flex flex-col gap-5 rounded-md border border-border bg-muted p-4"
        >
          <Field
            label="User payload (JSON)"
            error={!userPayloadResult.ok ? userPayloadResult.message : undefined}
            hint={
              <>
                Leave empty to auto-fill <code>userId</code> with your signed-in email.
              </>
            }
          >
            {(p) => (
              <Textarea
                {...p}
                value={userPayloadRaw}
                onChange={(e) => setUserPayloadRaw(e.target.value)}
                placeholder='{"userId": "custom"}'
                rows={4}
                className="font-mono text-xs"
                invalid={!userPayloadResult.ok}
              />
            )}
          </Field>

          <Field
            label="Metadata payload (JSON)"
            error={!metadataPayloadResult.ok ? metadataPayloadResult.message : undefined}
            hint="Overrides the ticket reference + note packing if set."
          >
            {(p) => (
              <Textarea
                {...p}
                value={metadataPayloadRaw}
                onChange={(e) => setMetadataPayloadRaw(e.target.value)}
                placeholder='{"custom": "value"}'
                rows={4}
                className="font-mono text-xs"
                invalid={!metadataPayloadResult.ok}
              />
            )}
          </Field>
        </div>
      )}

      {!canSubmit && (
        <Alert tone="danger" title="Fix JSON before continuing">
          One or more payloads contain invalid JSON.
        </Alert>
      )}

      <Button type="submit" disabled={!canSubmit} className="self-end">
        Next
      </Button>
    </form>
  );
}
