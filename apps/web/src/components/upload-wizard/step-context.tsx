import { useMemo, useState } from "react";
import { validateJsonField } from "../../lib/json-validate";

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
        <h2 className="text-lg font-semibold text-slate-900">Upload context</h2>
        <p className="text-sm text-slate-600">
          Optional. Attach a ticket reference and a note so this import is easy to trace later. All
          fields are optional.
        </p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Ticket reference</span>
        <input
          type="text"
          value={ticketReference}
          onChange={(e) => setTicketReference(e.target.value)}
          placeholder="EVO-1234"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Onboarding Smith Property Group, batch 1 of 3"
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="text-sm font-medium text-slate-700 underline"
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? "Hide advanced" : "Show advanced (raw JSON payloads)"}
        </button>
      </div>

      {advancedOpen && (
        <div className="flex flex-col gap-5 rounded-md border border-slate-200 bg-slate-50 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">User payload (JSON)</span>
            <textarea
              value={userPayloadRaw}
              onChange={(e) => setUserPayloadRaw(e.target.value)}
              placeholder='{"userId": "custom"}'
              rows={4}
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            {!userPayloadResult.ok && (
              <span className="text-xs text-red-600">{userPayloadResult.message}</span>
            )}
            <span className="text-xs text-slate-500">
              Leave empty to auto-fill <code>userId</code> with your signed-in email.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Metadata payload (JSON)</span>
            <textarea
              value={metadataPayloadRaw}
              onChange={(e) => setMetadataPayloadRaw(e.target.value)}
              placeholder='{"custom": "value"}'
              rows={4}
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            {!metadataPayloadResult.ok && (
              <span className="text-xs text-red-600">{metadataPayloadResult.message}</span>
            )}
            <span className="text-xs text-slate-500">
              Overrides the ticket reference + note packing if set.
            </span>
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Next
      </button>
    </form>
  );
}
