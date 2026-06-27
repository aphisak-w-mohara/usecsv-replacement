export type AccessibleEnv = { id: string; slug: string; name: string };

type Props = {
  environments: AccessibleEnv[];
  /** The currently-active environment id (from the session). */
  currentId: string;
  /** True while a switch request is in flight. */
  switching?: boolean;
  onSwitch: (environmentId: string) => void;
};

/**
 * Top-bar environment switcher. Renders only the environments the signed-in user
 * may access (owners: all; members: granted). Empty list => a disabled "no
 * access" hint; a single env => static label (nothing to switch to). Otherwise a
 * <select> that fires onSwitch when the user picks a different env.
 */
export function EnvSwitcher({ environments, currentId, switching, onSwitch }: Props) {
  if (environments.length === 0) {
    return (
      <span
        className="text-xs text-slate-400"
        title="Ask an owner to grant you access to an environment."
      >
        No environment access
      </span>
    );
  }

  if (environments.length === 1) {
    const only = environments[0]!;
    return <span className="text-xs text-slate-500">{only.name}</span>;
  }

  return (
    <label className="flex items-center gap-1">
      <span className="sr-only">Environment</span>
      <select
        aria-label="Environment"
        value={currentId}
        disabled={switching}
        onChange={(e) => {
          const next = e.target.value;
          if (next !== currentId) onSwitch(next);
        }}
        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
      >
        {environments.map((env) => (
          <option key={env.id} value={env.id}>
            {env.name}
          </option>
        ))}
      </select>
    </label>
  );
}
