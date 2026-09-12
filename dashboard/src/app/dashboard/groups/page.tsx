import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminPageHeader from "@/components/AdminPageHeader";
import AccessGroupsManager from "@/components/AccessGroupsManager";
import AdminTabs from "@/components/AdminTabs";
import { buildPageMetadata } from "@/lib/seo";
import { getSession, setSession } from "@/lib/auth";
import { applyAccessGroupToSession, canManageGroups, deleteAccessGroup, getAccessGroup, listAccessGroups, recordAdminAudit, upsertAccessGroup } from "@/lib/accessGroups";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Групи та права",
  description: "Керування групами доступу, однією Discord-роллю на групу і правами Mistblossom Vanguard.",
  path: "/dashboard/groups",
  keywords: ["dashboard права", "групи доступу", "адміністрування"],
});

async function setActionToast(tone: "success" | "info" | "warning" | "error", title: string, message?: string) {
  const store = await cookies();
  store.set("dashboard_toast", JSON.stringify({ tone, title, message }), { path: "/", maxAge: 45, sameSite: "lax" });
}

async function saveGroupAction(formData: FormData) {
  "use server";
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canManageGroups(user)) { redirect("/access-denied?reason=groups&from=/dashboard/groups"); throw new Error("Access denied"); }

  const isUpdate = Boolean(formData.get("currentId"));
  let targetUrl = `/dashboard/groups?${isUpdate ? "updated" : "created"}=${encodeURIComponent("Групу доступу збережено у базі даних.")}`;
  try {
    const savedGroup = await upsertAccessGroup({
      currentId: formData.get("currentId"),
      id: formData.get("id"),
      name: formData.get("name"),
      role: formData.get("role"),
      rank: formData.get("rank"),
      discordRoleId: formData.get("discordRoleId"),
      icon: formData.get("icon"),
      permissions: formData.getAll("permissions"),
    }, user);
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
    });
    revalidatePath("/dashboard/groups");
    await setActionToast("success", isUpdate ? "Групу оновлено" : "Групу створено", "Права, Discord role ID та іконку збережено у базі даних.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Перевір ID, роль, ранг, Discord role ID і права групи.";
    await setActionToast("error", isUpdate ? "Групу не оновлено" : "Групу не створено", message);
    targetUrl = `/dashboard/groups?error=${encodeURIComponent(message)}`;
  }
  redirect(targetUrl);
}

async function deleteGroupAction(formData: FormData) {
  "use server";
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canManageGroups(user)) { redirect("/access-denied?reason=groups&from=/dashboard/groups"); throw new Error("Access denied"); }
  const groupId = String(formData.get("groupId") || "");
  let targetUrl = `/dashboard/groups?deleted=${encodeURIComponent("Групу доступу видалено.")}`;
  try {
    await deleteAccessGroup(groupId, user);
    await recordAdminAudit("access_group.delete", user, {
      status: "success",
      summary: `Групу доступу видалено: ${groupId}.`,
      groupId,
      changed: 1,
    });
    revalidatePath("/dashboard/groups");
    await setActionToast("success", "Групу видалено", "Список груп доступу оновлено.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Групу не вдалося видалити.";
    await setActionToast("error", "Групу не видалено", message);
    targetUrl = `/dashboard/groups?error=${encodeURIComponent(message)}`;
  }
  redirect(targetUrl);
}

async function impersonateAction(formData: FormData) {
  "use server";
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!user.isServerOwner) { redirect("/access-denied?reason=groups&from=/dashboard/groups"); throw new Error("Access denied"); }
  let targetUrl = user.profileId ? `/profile/${user.profileId}` : "/";
  try {
    const group = await getAccessGroup(String(formData.get("groupId") || ""));
    if (!group) throw new Error("Групу для перегляду не знайдено.");
    await setSession(applyAccessGroupToSession({ ...user, impersonatedBy: user.id }, group, false));
    await recordAdminAudit("access_group.impersonate", user, {
      status: "info",
      summary: `Увімкнено перегляд як група: ${group.name}.`,
      groupId: group.id,
      groupName: group.name,
      role: group.role,
      rank: group.rank,
    });
    await setActionToast("info", `Перегляд як: ${group.name}`, "Реальні права акаунта не змінені. Завершити режим можна через постійне повідомлення внизу.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Режим перегляду не вдалося увімкнути.";
    await setActionToast("error", "Перегляд не увімкнено", message);
    targetUrl = `/dashboard/groups?error=${encodeURIComponent(message)}`;
  }
  redirect(targetUrl);
}

export default async function AdminGroupsPage() {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canManageGroups(user)) { redirect("/access-denied?reason=groups&from=/dashboard/groups"); throw new Error("Access denied"); }

  const groups = await listAccessGroups();

  return (
    <main className="container app-page admin-container access-groups-container">
      <section className="dashboard-shell content-shell admin-page access-groups-page app-page-stack" aria-label="Керування групами та правами доступу Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="admin" />
        <AdminPageHeader
          eyebrow="Mistblossom Vanguard • Права"
          title="Групи та права доступу"
          description="Єдина модель доступу: Discord-роль, ранг і набір дозволів для кожної групи."
          metrics={[
            { label: "Поточна група", value: user.groupName || user.role, note: user.isServerOwner ? "Власник сервера" : "Активна сесія", tone: "good" },
            { label: "Груп", value: groups.length.toLocaleString("uk-UA") },
            { label: "Сховище", value: "PostgreSQL", note: "Права з бази даних" },
            { label: "Діапазон рангів", value: "1–99", note: "1 = найвищий" },
          ]}
        />
        <AdminTabs active="groups" user={user} />
        <AccessGroupsManager
          groups={groups}
          isServerOwner={Boolean(user.isServerOwner)}
          currentGroupId={user.groupId}
          saveGroupAction={saveGroupAction}
          deleteGroupAction={deleteGroupAction}
          impersonateAction={impersonateAction}
        />
      </section>
    </main>
  );
}
