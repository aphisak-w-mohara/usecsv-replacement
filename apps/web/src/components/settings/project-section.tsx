import { useEffect, useState } from "react";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { Input } from "../ui/input";

type Props = {
  /** The saved domain restriction, or null when unrestricted. */
  allowedEmailDomain: string | null;
  /** Count of existing members whose email domain doesn't match the saved value. */
  mismatchedMemberCount: number;
  loading?: boolean;
  /** True while a save/clear request is in flight. */
  saving: boolean;
  /** Inline error (e.g. the 400 "Enter a valid domain…") or a load/save error. */
  error?: string | null;
  /** Persist a new value; `null`/empty clears the restriction. */
  onSave: (domain: string | null) => void;
};

/**
 * Settings → Project section (PRD-004 Story 5). Owner-only. A single
 * "Restrict sign-in to Google Workspace domain" field with Save + Clear, plus a
 * warning when the restriction is set and existing members fall outside it.
 */
export function ProjectSection({
  allowedEmailDomain,
  mismatchedMemberCount,
  loading,
  saving,
  error,
  onSave,
}: Props) {
  const [value, setValue] = useState(allowedEmailDomain ?? "");

  // Re-sync the field when the saved value changes (after a save/clear reload).
  useEffect(() => {
    setValue(allowedEmailDomain ?? "");
  }, [allowedEmailDomain]);

  const trimmed = value.trim();
  const showWarning = allowedEmailDomain !== null && mismatchedMemberCount > 0;
  const isUnrestricted = allowedEmailDomain === null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    onSave(trimmed.length === 0 ? null : trimmed);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert tone="danger">{error}</Alert>}

      {isUnrestricted ? (
        <Alert tone="info" title="Sign-in is unrestricted">
          Anyone you invite can join, regardless of their email domain. Set a Google Workspace
          domain below to limit new sign-ins and invites.
        </Alert>
      ) : (
        <Alert tone="success" title={`Restricted to @${allowedEmailDomain}`}>
          Only people with this email domain can sign in or be invited.
        </Alert>
      )}

      {showWarning && (
        <Alert tone="warning" live title="Some members are outside this domain">
          {mismatchedMemberCount} existing member{mismatchedMemberCount === 1 ? "" : "s"} have a
          different email domain. They keep access — only new sign-ins and invites are restricted.
          To enforce the domain fully, remove or re-invite those members.
        </Alert>
      )}

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Field
          label="Restrict sign-in to Google Workspace domain"
          optional
          hint="Leave blank to allow any email domain."
        >
          {(p) => (
            <Input
              {...p}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="mohara.co"
              disabled={loading || saving}
              aria-label="Allowed email domain"
              className="max-w-sm"
            />
          )}
        </Field>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" loading={saving} disabled={loading}>
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading || saving || (isUnrestricted && trimmed.length === 0)}
            onClick={() => {
              setValue("");
              onSave(null);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
    </div>
  );
}
