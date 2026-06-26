import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  type CreatedInvite,
  type Member,
  MembersSection,
  type PendingInvite,
} from "../../../components/settings/members-section";
import { api } from "../../../lib/api";

export const Route = createFileRoute("/_authed/admin/settings")({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { me } = Route.useRouteContext();
  const projectId = me.project_id;
  const isOwner = me.role === "owner";

  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);

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

  useEffect(() => {
    if (!isOwner) return;
    void reload();
  }, [isOwner, reload]);

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
      <div className="flex flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">
          Only project owners can manage members and invites.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
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
    </div>
  );
}
