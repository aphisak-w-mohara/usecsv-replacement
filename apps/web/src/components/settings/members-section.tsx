import { useState } from "react";
import { useCopy } from "../../lib/use-copy";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { EmptyState } from "../ui/empty-state";
import { Field } from "../ui/field";
import { CheckIcon, CopyIcon, InboxIcon, UsersIcon } from "../ui/icons";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Spinner } from "../ui/spinner";

export type Member = {
  user_id: string;
  email: string;
  name: string;
  role: "owner" | "member";
};

export type PendingInvite = {
  id: string;
  email: string;
  role: "owner" | "member";
  expires_at: number;
};

/** The freshly-created invite to surface in a copy-to-clipboard field. */
export type CreatedInvite = {
  email: string;
  invite_url: string;
};

type Props = {
  members: Member[];
  invites: PendingInvite[];
  loading?: boolean;
  /** True while a create request is in flight. */
  creating: boolean;
  /** Inline error from the last create (e.g. 409 duplicate / already-member). */
  createError?: string | null;
  /** Generic load/list error. */
  error?: string | null;
  /** The invite created by the last successful submit, to copy + send manually. */
  createdInvite?: CreatedInvite | null;
  onCreate: (email: string, role: "owner" | "member") => void;
  onRevoke: (inviteId: string) => void;
  onDismissCreated: () => void;
};

/** Human-readable countdown from now to an `expires_at` epoch-seconds value. */
function formatExpiry(seconds: number): string {
  const diffMs = seconds * 1000 - Date.now();
  if (diffMs <= 0) return "expired";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function RoleBadge({ role }: { role: "owner" | "member" }) {
  return <Badge tone={role === "owner" ? "primary" : "neutral"}>{role}</Badge>;
}

export function MembersSection({
  members,
  invites,
  loading,
  creating,
  createError,
  error,
  createdInvite,
  onCreate,
  onRevoke,
  onDismissCreated,
}: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const { copied, copy } = useCopy();
  const [pendingRevoke, setPendingRevoke] = useState<PendingInvite | null>(null);

  const trimmed = email.trim();
  const canCreate = trimmed.length > 0 && !creating;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    onCreate(trimmed, role);
    setEmail("");
  }

  function copyUrl() {
    if (createdInvite) copy(createdInvite.invite_url);
  }

  return (
    <section className="flex flex-col gap-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {/* Current members (read-only) */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">Current members</h3>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Loading members…
          </p>
        ) : members.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="size-6" />}
            title="No members yet"
            description="Invite a teammate below to give them access to this project."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {m.name || m.email}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                </div>
                <RoleBadge role={m.role} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pending invites */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">Pending invites</h3>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" /> Loading invites…
          </p>
        ) : invites.length === 0 ? (
          <EmptyState
            icon={<InboxIcon className="size-6" />}
            title="No pending invites"
            description="Invites you create will appear here until they're accepted."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm font-medium text-foreground">{inv.email}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <RoleBadge role={inv.role} />
                    <span>expires {formatExpiry(inv.expires_at)}</span>
                  </span>
                </div>
                <Button variant="danger" size="sm" onClick={() => setPendingRevoke(inv)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invite form */}
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <h3 className="text-sm font-medium text-foreground">Invite member</h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Email" required className="flex-1">
            {(p) => (
              <Input
                {...p}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@mohara.co"
              />
            )}
          </Field>
          <Field label="Role" className="sm:w-40">
            {(p) => (
              <Select
                {...p}
                value={role}
                onChange={(e) => setRole(e.target.value as "owner" | "member")}
              >
                <option value="member">member</option>
                <option value="owner">owner</option>
              </Select>
            )}
          </Field>
          <Button type="submit" loading={creating} disabled={!canCreate}>
            Invite member
          </Button>
        </div>
        {createError && <Alert tone="danger">{createError}</Alert>}
      </form>

      {/* Created invite — copy + send manually */}
      {createdInvite && (
        <Alert tone="success" title="Invite created">
          <div className="flex flex-col gap-3">
            <p>
              Send this link to <span className="font-medium">{createdInvite.email}</span>.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="text"
                value={createdInvite.invite_url}
                readOnly
                aria-label="Invite link"
                className="flex-1 font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                onClick={copyUrl}
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={onDismissCreated}
            >
              Dismiss
            </Button>
          </div>
        </Alert>
      )}

      {pendingRevoke && (
        <ConfirmDialog
          title="Revoke this invite?"
          body={
            <>
              <span className="font-medium">{pendingRevoke.email}</span> will no longer be able to
              join with the existing link. You can always invite them again.
            </>
          }
          confirmLabel="Revoke invite"
          danger
          onCancel={() => setPendingRevoke(null)}
          onConfirm={() => {
            onRevoke(pendingRevoke.id);
            setPendingRevoke(null);
          }}
        />
      )}
    </section>
  );
}
