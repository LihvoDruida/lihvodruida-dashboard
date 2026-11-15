import DataTable from "@/components/ui/DataTable";
import { canViewAccessGroups } from "@/lib/permissions";
import { PERMISSION_META } from "@/lib/accessGroupSchema";
import ManagementPage from "@/components/management/ManagementPage";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import AccessGroupsManager from "@/components/AccessGroupsManager";
import { buildPageMetadata } from "@/lib/seo";
import { getSession, setSession } from "@/lib/auth";
import { logDashboardEvent } from "@/lib/security";
import { applyAccessGroupToSession, canManageGroups, deleteAccessGroup, getAccessGroup, listAccessGroupsForManagement, recordAdminAudit, upsertAccessGroup } from "@/lib/accessGroups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Групи та права",
  description:
    "Керування групами доступу, однією Discord-роллю на групу і правами Mistblossom Vanguard.",
  path: "/dashboard/groups",
  keywords: ["dashboard права", "групи доступу", "адміністрування"],
});

async function setActionToast(
  tone: "success" | "info" | "warning" | "error",
  title: string,
  message?: string,
) {
  const store = await cookies();
  store.set("dashboard_toast", JSON.stringify({ tone, title, message }), {
    path: "/",
    maxAge: 45,
    sameSite: "lax",
  });
}

async function saveGroupAction(formData: FormData) {
  "use server";
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageGroups(user)) {
    redirect("/access-denied?reason=groups&from=/dashboard/groups");
    throw new Error("Access denied");
  }

  const isUpdate = Boolean(formData.get("currentId"));
  let targetUrl = `/dashboard/groups?${isUpdate ? "updated" : "created"}=${encodeURIComponent("Групу доступу збережено у базі даних.")}`;
  try {
    const savedGroup = await upsertAccessGroup(
      {
        currentId: formData.get("currentId"),
        expectedRevision: formData.get("currentId")
          ? formData.get("expectedRevision")
          : null,
        mutationId: formData.get("mutationId") || randomUUID(),
        id: formData.get("id"),
        name: formData.get("name"),
        role: formData.get("role") || undefined,
        rank: formData.get("rank"),
        discordRoleId: formData.get("discordRoleId"),
        icon: formData.get("icon"),
        permissions: formData.getAll("permissions"),
      },
      user,
    );
    const groupId = savedGroup.id;
    await recordAdminAudit("access_group.upsert", user, {
      status: "success",
      summary: `${isUpdate ? "Оновлено" : "Створено"} групу доступу: ${savedGroup.name} (${savedGroup.id}).`,
      groupId,
      groupName: savedGroup.name,
      role: savedGroup.role,
      rank: savedGroup.rank,
      permissionCount: savedGroup.permissions.length,
      discordRoleIds: savedGroup.discordRoleIds,
      assignmentMigration: savedGroup.assignmentMigration || null,
    }).catch((error) => logDashboardEvent("warn", "access_groups.audit_failed", undefined, { message: error instanceof Error ? error.message : "audit unavailable" }));
    revalidatePath("/dashboard/groups");
    revalidatePath("/profiles");
    await setActionToast(
      "success",
      isUpdate ? "Групу оновлено" : "Групу створено",
      savedGroup.assignmentMigration ? `Групу збережено. Призначення профілів перенесено: ${savedGroup.assignmentMigration.profiles}. Старий ID зарезервовано.` : "Права, Discord role ID та іконку збережено у базі даних.",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Перевір ID, роль, ранг, Discord role ID і права групи.";
    await setActionToast(
      "error",
      isUpdate ? "Групу не оновлено" : "Групу не створено",
      message,
    );
    targetUrl = `/dashboard/groups?error=${encodeURIComponent(message)}`;
  }
  redirect(targetUrl);
}

async function deleteGroupAction(formData: FormData) {
  "use server";
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageGroups(user)) {
    redirect("/access-denied?reason=groups&from=/dashboard/groups");
    throw new Error("Access denied");
  }
  const groupId = String(formData.get("groupId") || "");
  let targetUrl = `/dashboard/groups?deleted=${encodeURIComponent("Групу доступу видалено.")}`;
  try {
    await deleteAccessGroup(groupId, user, formData.get("expectedRevision"));
    await recordAdminAudit("access_group.delete", user, {
      status: "success",
      summary: `Групу доступу видалено: ${groupId}.`,
      groupId,
      changed: 1,
    }).catch((error) => logDashboardEvent("warn", "access_groups.audit_failed", undefined, { message: error instanceof Error ? error.message : "audit unavailable" }));
    revalidatePath("/dashboard/groups");
    await setActionToast(
      "success",
      "Групу видалено",
      "Список груп доступу оновлено.",
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Групу не вдалося видалити.";
    await setActionToast("error", "Групу не видалено", message);
    targetUrl = `/dashboard/groups?error=${encodeURIComponent(message)}`;
  }
  redirect(targetUrl);
}

async function impersonateAction(formData: FormData) {
  "use server";
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!user.isServerOwner) {
    redirect("/access-denied?reason=groups&from=/dashboard/groups");
    throw new Error("Access denied");
  }
  let targetUrl = user.profileId ? `/profile/${user.profileId}` : "/";
  try {
    const group = await getAccessGroup(String(formData.get("groupId") || ""));
    if (!group) throw new Error("Групу для перегляду не знайдено.");
    await setSession(
      applyAccessGroupToSession(
        { ...user, impersonatedBy: user.id },
        group,
        false,
      ),
    );
    await recordAdminAudit("access_group.impersonate", user, {
      status: "info",
      summary: `Увімкнено перегляд як група: ${group.name}.`,
      groupId: group.id,
      groupName: group.name,
      role: group.role,
      rank: group.rank,
    });
    await setActionToast(
      "info",
      `Перегляд як: ${group.name}`,
      "Реальні права акаунта не змінені. Завершити режим можна через постійне повідомлення внизу.",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Режим перегляду не вдалося увімкнути.";
    await setActionToast("error", "Перегляд не увімкнено", message);
    targetUrl = `/dashboard/groups?error=${encodeURIComponent(message)}`;
  }
  redirect(targetUrl);
}

export default async function AdminGroupsPage() {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canViewAccessGroups(user)) {
    redirect("/access-denied?reason=groups&from=/dashboard/groups");
    throw new Error("Access denied");
  }

  let groups;
  try {
    groups = await listAccessGroupsForManagement();
  } catch {
    return <ManagementPage user={user} active="groups" header={{ title: "Групи та права доступу", description: "Актуальний стан груп." }}>
      <ErrorState title="Групи тимчасово недоступні" description="Не вдалося прочитати актуальні права. Чернетки залишаються у браузері." actions={<PageRefreshButton />} />
    </ManagementPage>;
  }

  if (!user.isServerOwner) {
    const ownGroup = groups.find((group) => group.id === user.groupId);
    if (
      !ownGroup ||
      !canViewAccessGroups(applyAccessGroupToSession(user, ownGroup))
    )
      redirect("/access-denied?reason=groups&from=/dashboard/groups");
  }
  const draftScope = createHash("sha256")
    .update(
      `${process.env.DISCORD_GUILD_ID || "default"}:${user.provider}:${user.id}`,
    )
    .digest("hex");

  return (
    <ManagementPage user={user} active="groups" header={{ title: "Групи та права доступу",
      description: "Знайди групу, зміни її параметри й збережи після перевірки. Чернетки не змінюють серверні права.",
      metrics: [{ label: "Поточна група", value: user.groupName || user.role }, { label: "Групи", value: groups.length }, { label: "Режим", value: canManageGroups(user) ? "Редагування" : "Лише перегляд" }] }}>
        {canManageGroups(user) ? (
        <AccessGroupsManager
          groups={groups}
          draftScope={draftScope}
          isServerOwner={Boolean(user.isServerOwner)}
          currentGroupId={user.groupId}
          saveGroupAction={saveGroupAction}
          deleteGroupAction={deleteGroupAction}
          impersonateAction={impersonateAction}
        />
        ) : <DataTable caption="Групи та дозволи — лише перегляд" headings={["Група", "Ранг", "Дозволи"]}>
          {groups.map(group => <tr key={group.id}><th scope="row">{group.name}</th><td>{group.rank}</td>
            <td>{group.permissions.map(permission => PERMISSION_META[permission].title).join(", ") || "Немає дозволів"}</td></tr>)}
        </DataTable>}

      </ManagementPage>
  );
}
