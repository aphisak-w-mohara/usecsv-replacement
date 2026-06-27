import { useState } from "react";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Field } from "../ui/field";
import { BoxIcon } from "../ui/icons";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

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
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onCreate(name.trim(), slug.trim());
        setName("");
        setSlug("");
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Name" required className="flex-1">
          {(p) => (
            <Input
              {...p}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production"
            />
          )}
        </Field>
        <Field label="Slug" optional className="flex-1">
          {(p) => (
            <Input
              {...p}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={derived || "production"}
            />
          )}
        </Field>
        <Button type="submit" loading={creating} disabled={!canSubmit}>
          Add environment
        </Button>
      </div>
      {name.trim() && (
        <p className="text-xs text-muted-foreground">
          Will be created with slug <code className="text-foreground">{effectiveSlug}</code>.
        </p>
      )}
      {createError && <Alert tone="danger">{createError}</Alert>}
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
      {onCreate && (
        <AddEnvironmentForm onCreate={onCreate} creating={creating} createError={createError} />
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Loading grants…
        </p>
      ) : environments.length === 0 ? (
        <EmptyState
          icon={<BoxIcon className="size-6" />}
          title="No environments yet"
          description="Environments let you scope which members can see and upload to each target. Add your first one above."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<BoxIcon className="size-6" />}
          title="No members to grant"
          description="Invite members in the Members tab — they'll appear here so you can grant environment access."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-foreground">
                  Member
                </th>
                {/* striped rows below inherit their bg via bg-inherit on the sticky cell */}
                {environments.map((env) => (
                  <th key={env.id} className="px-3 py-2 text-center font-medium text-foreground">
                    {env.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOwner = row.role === "owner";
                return (
                  <tr
                    key={row.user_id}
                    className="border-b border-border bg-card last:border-0 even:bg-muted/40"
                  >
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2">
                      <span className="text-foreground">{row.email}</span>
                      {isOwner && (
                        <Badge tone="primary" className="ml-2">
                          owner
                        </Badge>
                      )}
                    </td>
                    {environments.map((env) => {
                      const checked = isOwner || row.granted_env_ids.includes(env.id);
                      const label = `${row.email} - ${env.name}`;
                      return (
                        <td key={env.id} className="px-3 py-2 text-center">
                          <label className="inline-flex items-center justify-center">
                            <span className="sr-only">{label}</span>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isOwner}
                              title={isOwner ? "Owner — always has access." : undefined}
                              onChange={(e) => {
                                if (isOwner) return;
                                onToggle(row.user_id, env.id, e.target.checked);
                              }}
                              className="size-4 accent-primary disabled:opacity-50"
                            />
                          </label>
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
