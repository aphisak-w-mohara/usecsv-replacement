import { useState } from "react";

export type GrantEnv = { id: string; slug: string; name: string };

/** Client-side preview of the slug the server will derive from a name. Mirrors
 *  the worker's `slugify` so owners see what they'll get before submitting. */
export function previewSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type GrantRow = {
  user_id: string;
  email: string;
  role: "owner" | "member";
  granted_env_ids: string[];
};

/**
 * Pure optimistic-toggle helper. Given the current matrix rows, flip whether
 * `userId` has a grant for `envId`, returning a NEW rows array. Owner rows are
 * never mutated (they always have every env). Exported so the toggle logic is
 * unit-testable without a router/DOM, and reused for optimistic + revert.
 */
export function toggleGrant(
  rows: GrantRow[],
  userId: string,
  envId: string,
  granted: boolean,
): GrantRow[] {
  return rows.map((row) => {
    if (row.user_id !== userId || row.role === "owner") return row;
    const has = row.granted_env_ids.includes(envId);
    if (granted === has) return row;
    return {
      ...row,
      granted_env_ids: granted
        ? [...row.granted_env_ids, envId]
        : row.granted_env_ids.filter((id) => id !== envId),
    };
  });
}

type Props = {
  environments: GrantEnv[];
  rows: GrantRow[];
  loading?: boolean;
  error?: string | null;
  /** Toggle a member's grant for an env. `granted` is the desired next state. */
  onToggle: (userId: string, envId: string, granted: boolean) => void;
  /** Owner-only: create a new environment. `slug` is "" to let the server derive it. */
  onCreate?: (name: string, slug: string) => void;
  creating?: boolean;
  createError?: string | null;
};

/** Owner-only inline form to add an environment to the project. */
function AddEnvironmentForm({
  onCreate,
  creating,
  createError,
}: {
  onCreate: (name: string, slug: string) => void;
  creating?: boolean;
  createError?: string | null;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const derived = previewSlug(name);
  const effectiveSlug = slug.trim() || derived;
  const canSubmit = !creating && name.trim().length > 0 && effectiveSlug.length > 0;

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onCreate(name.trim(), slug.trim());
        setName("");
        setSlug("");
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Slug (optional)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={derived || "production"}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? "Adding…" : "Add environment"}
        </button>
      </div>
      {name.trim() && (
        <p className="text-xs text-slate-500">
          Will be created with slug <code className="text-slate-700">{effectiveSlug}</code>.
        </p>
      )}
      {createError && <p className="text-xs text-red-700">{createError}</p>}
    </form>
  );
}

/**
 * Settings -> Environments grants matrix. Rows = members, columns = envs, cell =
 * checkbox (checked = grant exists). Owner rows are read-only (all checked,
 * faded, tooltipped) since owners always have access. Owner-only section.
 */
export function EnvironmentsSection({
  environments,
  rows,
  loading,
  error,
  onToggle,
  onCreate,
  creating,
  createError,
}: Props) {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Environments</h2>
        <p className="text-sm text-slate-500">
          Control which environments each member can see and upload to. Owners always have access to
          every environment.
        </p>
      </header>

      {onCreate && (
        <AddEnvironmentForm onCreate={onCreate} creating={creating} createError={createError} />
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading grants…</p>
      ) : environments.length === 0 ? (
        <p className="text-sm text-slate-500">No environments in this project yet.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No members yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 text-left font-medium text-slate-700">Member</th>
                {environments.map((env) => (
                  <th key={env.id} className="px-3 py-2 text-center font-medium text-slate-700">
                    {env.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOwner = row.role === "owner";
                return (
                  <tr key={row.user_id} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <span className="text-slate-900">{row.email}</span>
                      {isOwner && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                          owner
                        </span>
                      )}
                    </td>
                    {environments.map((env) => {
                      const checked = isOwner || row.granted_env_ids.includes(env.id);
                      return (
                        <td key={env.id} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isOwner}
                            aria-label={`${row.email} - ${env.name}`}
                            title={isOwner ? "Owner - always has access." : undefined}
                            onChange={(e) => {
                              if (isOwner) return;
                              onToggle(row.user_id, env.id, e.target.checked);
                            }}
                            className="h-4 w-4 disabled:opacity-50"
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
