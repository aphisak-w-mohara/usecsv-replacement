export type GrantEnv = { id: string; slug: string; name: string };

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
};

/**
 * Settings -> Environments grants matrix. Rows = members, columns = envs, cell =
 * checkbox (checked = grant exists). Owner rows are read-only (all checked,
 * faded, tooltipped) since owners always have access. Owner-only section.
 */
export function EnvironmentsSection({ environments, rows, loading, error, onToggle }: Props) {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Environments</h2>
        <p className="text-sm text-slate-500">
          Control which environments each member can see and upload to. Owners always have access to
          every environment.
        </p>
      </header>

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
