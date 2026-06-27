import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  type GrantEnv,
  type GrantRow,
  EnvironmentsSection,
  toggleGrant,
} from "../../../components/settings/environments-section";
import {
  type CreatedInvite,
  type Member,
  MembersSection,
  type PendingInvite,
} from "../../../components/settings/members-section";
import { ProjectSection } from "../../../components/settings/project-section";
import { Card, CardBody, CardHeader } from "../../../components/ui/card";
import { BoxIcon, SettingsIcon, UsersIcon } from "../../../components/ui/icons";
import { cn } from "../../../lib/cn";
import { api } from "../../../lib/api";

export const Route = createFileRoute("/_authed/admin/settings")({
  component: SettingsRoute,
});

type SettingsTab = "project" | "members" | "environments";

const TABS: { id: SettingsTab; label: string; icon: typeof SettingsIcon }[] = [
  { id: "project", label: "Project", icon: SettingsIcon },
  { id: "members", label: "Members", icon: UsersIcon },
  { id: "environments", label: "Environments", icon: BoxIcon },
];

function SettingsRoute() {
  const { me } = Route.useRouteContext();
  const projectId = me.project_id;
  const isOwner = me.role === "owner";

  const [activeTab, setActiveTab] = useState<SettingsTab>("project");

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);

  const [grantEnvs, setGrantEnvs] = useState<GrantEnv[]>([]);
  const [grantRows, setGrantRows] = useState<GrantRow[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [grantsError, setGrantsError] = useState<string | null>(null);
  const [envCreating, setEnvCreating] = useState(false);
  const [envCreateError, setEnvCreateError] = useState<string | null>(null);

  const [allowedDomain, setAllowedDomain] = useState<string | null>(null);
  const [mismatchedCount, setMismatchedCount] = useState(0);
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        api.api.projects[":id"].members.$get({ param: { id: projectId } }),
        api.api.projects[":id"].invites.$get({ param: { id: projectId } }),
      ]);
      if (!membersRes.ok) throw new Error(`Failed to load members: ${membersRes.status}`);
      if (!invitesRes.ok) throw new Error(`Failed to load invites: ${invitesRes.status}`);
      const membersData = await membersRes.json();
      const invitesData = await invitesRes.json();
      setMembers(membersData.members as Member[]);
      setInvites(invitesData.invites as PendingInvite[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const reloadGrants = useCallback(async () => {
    setGrantsLoading(true);
    setGrantsError(null);
    try {
      const res = await api.api.projects[":id"].grants.$get({ param: { id: projectId } });
      if (!res.ok) throw new Error(`Failed to load grants: ${res.status}`);
      const data = await res.json();
      setGrantEnvs(data.environments as GrantEnv[]);
      setGrantRows(data.rows as GrantRow[]);
    } catch (err) {
      setGrantsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setGrantsLoading(false);
    }
  }, [projectId]);

  const reloadProject = useCallback(async () => {
    setProjectLoading(true);
    setProjectError(null);
    try {
      const res = await api.api.projects[":id"].$get({ param: { id: projectId } });
      if (!res.ok) throw new Error(`Failed to load project: ${res.status}`);
      const data = await res.json();
      setAllowedDomain(data.allowed_email_domain);
      setMismatchedCount(data.mismatched_member_count);
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProjectLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!isOwner) return;
    void reload();
    void reloadGrants();
    void reloadProject();
  }, [isOwner, reload, reloadGrants, reloadProject]);

  async function handleSaveDomain(domain: string | null) {
    setProjectSaving(true);
    setProjectError(null);
    try {
      const res = await api.api.projects[":id"].$patch({
        param: { id: projectId },
        json: { allowed_email_domain: domain },
      });
      if (res.status === 400) {
        const body = (await res.json()) as { error?: string };
        setProjectError(body.error ?? "Enter a valid domain like `mohara.co`.");
        return;
      }
      if (!res.ok) throw new Error(`Failed to save domain: ${res.status}`);
      // Re-read to pick up the normalized value + refreshed mismatch count.
      await reloadProject();
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setProjectSaving(false);
    }
  }

  async function handleToggleGrant(userId: string, envId: string, granted: boolean) {
    // Optimistic flip; revert the cell on error.
    const previous = grantRows;
    setGrantRows((rows) => toggleGrant(rows, userId, envId, granted));
    setGrantsError(null);
    try {
      const res = granted
        ? await api.api.projects[":id"].environments[":env_id"].grants[":user_id"].$put({
            param: { id: projectId, env_id: envId, user_id: userId },
          })
        : await api.api.projects[":id"].environments[":env_id"].grants[":user_id"].$delete({
            param: { id: projectId, env_id: envId, user_id: userId },
          });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to update grant: ${res.status}`);
      }
    } catch (err) {
      setGrantRows(previous);
      setGrantsError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleCreateEnvironment(name: string, slug: string) {
    setEnvCreating(true);
    setEnvCreateError(null);
    try {
      const res = await api.api.projects[":id"].environments.$post({
        param: { id: projectId },
        json: slug ? { name, slug } : { name },
      });
      if (res.status === 409 || res.status === 400) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setEnvCreateError(body.error ?? "Could not create the environment.");
        return;
      }
      if (!res.ok) throw new Error(`Failed to create environment: ${res.status}`);
      // New env becomes a column in the grants matrix — refresh it.
      await reloadGrants();
    } catch (err) {
      setEnvCreateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setEnvCreating(false);
    }
  }

  async function handleCreate(email: string, role: "owner" | "member") {
    setCreating(true);
    setCreateError(null);
    setCreatedInvite(null);
    try {
      const res = await api.api.projects[":id"].invites.$post({
        param: { id: projectId },
        json: { email, role },
      });
      if (res.status === 409) {
        const body = (await res.json()) as { error?: string };
        setCreateError(body.error ?? "An invite for that email is already pending.");
        return;
      }
      if (!res.ok) throw new Error(`Failed to create invite: ${res.status}`);
      const data = (await res.json()) as { invite_url: string };
      setCreatedInvite({ email, invite_url: data.invite_url });
      await reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    setError(null);
    try {
      const res = await api.api.projects[":id"].invites[":invite_id"].$delete({
        param: { id: projectId, invite_id: inviteId },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Failed to revoke invite: ${res.status}`);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  if (!isOwner) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Only project owners can manage members and invites.
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your project's sign-in domain, members, and environment access.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`settings-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "project" && (
        <div role="tabpanel" id="settings-panel-project" aria-labelledby="settings-tab-project">
          <Card>
            <CardHeader
              title="Project"
              description="Restrict who can sign in and be invited to this project."
            />
            <CardBody>
              <ProjectSection
                allowedEmailDomain={allowedDomain}
                mismatchedMemberCount={mismatchedCount}
                loading={projectLoading}
                saving={projectSaving}
                error={projectError}
                onSave={handleSaveDomain}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {activeTab === "members" && (
        <div role="tabpanel" id="settings-panel-members" aria-labelledby="settings-tab-members">
          <Card>
            <CardHeader
              title="Members"
              description="Invite teammates and manage who has access to this project."
            />
            <CardBody>
              <MembersSection
                members={members}
                invites={invites}
                loading={loading}
                creating={creating}
                createError={createError}
                error={error}
                createdInvite={createdInvite}
                onCreate={handleCreate}
                onRevoke={handleRevoke}
                onDismissCreated={() => setCreatedInvite(null)}
              />
            </CardBody>
          </Card>
        </div>
      )}

      {activeTab === "environments" && (
        <div
          role="tabpanel"
          id="settings-panel-environments"
          aria-labelledby="settings-tab-environments"
        >
          <Card>
            <CardHeader
              title="Environments"
              description="Control which environments each member can see and upload to. Owners always have access to every environment."
            />
            <CardBody>
              <EnvironmentsSection
                environments={grantEnvs}
                rows={grantRows}
                loading={grantsLoading}
                error={grantsError}
                onToggle={handleToggleGrant}
                onCreate={handleCreateEnvironment}
                creating={envCreating}
                createError={envCreateError}
              />
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
