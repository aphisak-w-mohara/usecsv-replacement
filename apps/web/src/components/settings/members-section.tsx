import { useState } from "react";

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

function formatExpiry(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString();
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
  const [copied, setCopied] = useState(false);

  const trimmed = email.trim();
  const canCreate = trimmed.length > 0 && !creating;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    onCreate(trimmed, role);
    setEmail("");
  }

  function copyUrl() {
    if (createdInvite) {
      void navigator.clipboard.writeText(createdInvite.invite_url);
      setCopied(true);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Members</h2>
        <p className="text-sm text-slate-500">
          Invite teammates and manage who has access to this project.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Current members (read-only) */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-slate-700">Current members</h3>
        {loading ? (
          <p className="text-sm text-slate-500">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-slate-500">No members yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-900">{m.name || m.email}</span>
                  <span className="text-xs text-slate-500">{m.email}</span>
                </div>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pending invites */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-slate-700">Pending invites</h3>
        {loading ? (
          <p className="text-sm text-slate-500">Loading invites…</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-slate-500">No pending invites.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-slate-900">{inv.email}</span>
                  <span className="text-xs text-slate-500">
                    {inv.role} · expires {formatExpiry(inv.expires_at)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(inv.id)}
                  className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invite form */}
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <h3 className="text-sm font-medium text-slate-700">Invite member</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@mohara.co"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "owner" | "member")}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="member">member</option>
              <option value="owner">owner</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={!canCreate}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? "Inviting…" : "Invite member"}
          </button>
        </div>
        {createError && (
          <p role="alert" className="text-sm text-red-700">
            {createError}
          </p>
        )}
      </form>

      {/* Created invite — copy + send manually */}
      {createdInvite && (
        <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-700">
            Send this link to <span className="font-medium">{createdInvite.email}</span>.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={createdInvite.invite_url}
              readOnly
              aria-label="Invite link"
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={copyUrl}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setCopied(false);
              onDismissCreated();
            }}
            className="self-start text-xs text-slate-500 underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
