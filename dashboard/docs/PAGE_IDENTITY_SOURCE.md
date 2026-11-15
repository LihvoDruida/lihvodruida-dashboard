# Повний runtime-код етапу 2 — Dashboard 3.24.0

Усі нові й оновлені файли src/, включно з CSS; без пропусків.
Вихідне дерево та скрипти перевірок містяться в архіві.

## src/app/dashboard/access/error.tsx

```tsx
"use client";
export { default } from "@/components/page/PageRouteError";
```

## src/app/dashboard/access/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";

export default function Loading() {
  return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>;
}
```

## src/app/dashboard/access/page.tsx

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import ManagementPage from "@/components/management/ManagementPage";
import PageSection from "@/components/page/PageSection";
import ManagementSections from "@/components/ManagementSections";
import { AuthAccessForm, GeoAccessForm } from "@/components/management/access/AccessPolicyForms";
import { getSession } from "@/lib/auth";
import { canManageGroups } from "@/lib/permissions";
import { getGeoAccessPolicy } from "@/lib/geoAccessPolicy";
import { getAuthAccessPolicy } from "@/lib/authAccessPolicy";
import { fetchDiscordRoles } from "@/lib/discordAdmin";
import { ensureDefaultAccessGroups, listAccessGroupsForManagement } from "@/lib/accessGroups";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Авторизація та доступ", description: "Відповідності Discord-ролей, групи й геообмеження.", path: "/dashboard/access" });
export default async function AdminAccessPage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard%2Faccess");
  if (!canManageGroups(user)) redirect("/access-denied?reason=groups&from=/dashboard/access");
  const [authPolicy, geoPolicy, rolesResult, loadedGroups] = await Promise.all([
    getAuthAccessPolicy(), getGeoAccessPolicy(),
    fetchDiscordRoles().then(roles => ({ roles, error: false })).catch(() => ({ roles: [], error: true })),
    listAccessGroupsForManagement().catch(() => []),
  ]);
  const siteGroups = loadedGroups.length ? loadedGroups : await ensureDefaultAccessGroups().then(() => listAccessGroupsForManagement()).catch(() => []);
  const mappings = new Map(authPolicy.roleGroupMappings.map(mapping => [mapping.roleId, mapping.groupId]));
  const known = new Set(rolesResult.roles.map(role => role.id));
  const rows = [
    ...rolesResult.roles.map(role => ({ roleId: role.id, name: role.name, groupId: mappings.get(role.id) || "" })),
    ...authPolicy.roleGroupMappings.filter(mapping => !known.has(mapping.roleId)).map(mapping => ({ roleId: mapping.roleId, name: `Discord ID ${mapping.roleId}`, groupId: mapping.groupId, missing: true })),
  ];
  const eligibleGroups = siteGroups.filter(group => group.permissions.includes("dashboard.view") && (user.isServerOwner || (group.role !== "admin" && !group.permissions.includes("groups.manage"))));
  const protectedMappings = !user.isServerOwner && authPolicy.roleGroupMappings.some(mapping => siteGroups.some(group => group.id === mapping.groupId && (group.role === "admin" || group.permissions.includes("groups.manage"))));
  const canEditAuthPolicy = !rolesResult.error && eligibleGroups.length > 0 && !protectedMappings;
  return <ManagementPage user={user} active="access" header={{ title: "Авторизація та доступ", description: "Правила входу для команди та додаткові географічні обмеження.",
    actions: <Link href="/dashboard/groups" className="btn subtle">Групи доступу</Link>,
    metrics: [{ label: "Відповідності", value: authPolicy.roleGroupMappings.length }, { label: "Групи доступу", value: siteGroups.length }, { label: "Геообмеження", value: geoPolicy.enabled ? "Увімкнено" : "Вимкнено" }] }}>
    <ManagementSections variant="universal" sections={[{ id: "overview-auth", label: "Discord → групи", description: "Явні відповідності ролей і дозволів." }, { id: "overview-geo", label: "Географія", description: "Правила авторизації та публічних заявок за країною." }]}>
      <PageSection id="auth-policy-title" title="Вхід за Discord-ролями"><AuthAccessForm policy={authPolicy} rows={rows} groups={eligibleGroups} canEdit={canEditAuthPolicy}
        rolesError={rolesResult.error} protectedMappings={protectedMappings} isServerOwner={Boolean(user.isServerOwner)} /></PageSection>
      <PageSection id="geo-policy-title" title="Геообмеження"><GeoAccessForm policy={geoPolicy} /></PageSection>
    </ManagementSections>
  </ManagementPage>;
}
```

## src/app/dashboard/groups/error.tsx

```tsx
"use client";
export { default } from "@/components/page/PageRouteError";
```

## src/app/dashboard/groups/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";

export default function Loading() {
  return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>;
}
```

## src/app/dashboard/groups/page.tsx

```tsx
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
```

## src/app/dashboard/profiles/error.tsx

```tsx
"use client";
export { default } from "@/components/page/PageRouteError";
```

## src/app/dashboard/profiles/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";

export default function Loading() {
  return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>;
}
```

## src/app/dashboard/profiles/page.tsx

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import ManagementPage from "@/components/management/ManagementPage";
import ProfileCleanupForms from "@/components/management/cleanup/ProfileCleanupForms";
import { getSession } from "@/lib/auth";
import { getAccountCleanupAutomationSettings } from "@/lib/accountCleanupAutomation";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Очищення профілів", description: "Перевірка, підтверджене видалення та історія обслуговування профілів.", path: "/dashboard/profiles" });
export default async function ProfileMaintenancePage() {
  const user = await getSession({ live: true });
  if (!user) redirect("/login?next=%2Fdashboard%2Fprofiles");
  if (!user.isServerOwner) redirect("/access-denied?reason=owner-only&from=/dashboard/profiles");
  const cleanupAutomation = await getAccountCleanupAutomationSettings();
  return <ManagementPage user={user} active="profiles" header={{ title: "Очищення профілів", description: "Обслуговування профілів доступне лише власнику Discord-сервера.",
    actions: <Link className="btn subtle" href="/profiles">Каталог профілів</Link> }}>
    <ProfileCleanupForms settings={cleanupAutomation} />
  </ManagementPage>;
}
```

## src/app/profile/[profileId]/error.tsx

```tsx
"use client";
export { default } from "@/components/page/PageRouteError";
```

## src/app/profile/[profileId]/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";

export default function Loading() {
  return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>;
}
```

## src/app/profile/[profileId]/page.tsx

```tsx
import { buildPageMetadata } from "@/lib/seo";
import { loadProfileOverview } from "@/services/profileOverview";
import ProfileOverviewView from "@/components/profile/ProfileOverviewView";

export const metadata = buildPageMetadata({ title: "Профіль учасника", description: "Персонажі, Battle.net та рейдові записи учасника.", path: "/profile" });
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfilePage(props: Parameters<typeof loadProfileOverview>[0]) {
  return <ProfileOverviewView {...await loadProfileOverview(props)} />;
}
```

## src/app/profile/[profileId]/settings/error.tsx

```tsx
"use client";
export { default } from "@/components/page/PageRouteError";
```

## src/app/profile/[profileId]/settings/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";

export default function Loading() {
  return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>;
}
```

## src/app/profile/[profileId]/settings/page.tsx

```tsx
import { buildPageMetadata } from "@/lib/seo";
import { loadProfileSettings } from "@/services/profileSettings";
import ProfileSettingsView from "@/components/profile/settings/ProfileSettingsView";

export const metadata = buildPageMetadata({ title: "Налаштування профілю", description: "Особисті дані, звертання, Discord і рейдова роль.", path: "/profile" });
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProfileSettingsPage(props: Parameters<typeof loadProfileSettings>[0]) {
  return <ProfileSettingsView {...await loadProfileSettings(props)} />;
}
```

## src/app/profiles/error.tsx

```tsx
"use client";
export { default } from "@/components/page/PageRouteError";
```

## src/app/profiles/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";

export default function Loading() {
  return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>;
}
```

## src/app/profiles/page.tsx

```tsx
import { buildPageMetadata } from "@/lib/seo";
import { loadProfileDirectory } from "@/services/profileDirectory";
import ProfileDirectoryView from "@/components/profile/directory/ProfileDirectoryView";

export const metadata = buildPageMetadata({ title: "Профілі учасників", description: "Каталог учасників, персонажів і Battle.net-підключень.", path: "/profiles" });
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function ProfilesPage(props: Parameters<typeof loadProfileDirectory>[0]) {
  return <ProfileDirectoryView {...await loadProfileDirectory(props)} />;
}
```

## src/app/styles/admin.css

```css
/* =========================================================
   ADMIN — панель керування, Discord-адмінка та журнали

   64 класи адмінки не мали правил, тому картки дій, журнал
   і політики доступу трималися на суфіксних патернах.

   Мова та сама, що в решті панелі. Ключове рішення структури:
   картки дій ідуть у ДВІ колонки на широкому екрані й в одну
   нижче 1100px — адмінські форми довгі, три колонки різали б
   підписи, а одна колонка на 1920px лишала б пів екрана порожнім.

   Жодного !important.
   ========================================================= */

.discord-management-page,
.admin-logs-page {
  min-width: 0;
}

/* =========================================================
   1. ОБОЛОНКА Й РОЗКЛАДКА
   ========================================================= */
.discord-management-section {
  display: grid;
  gap: var(--gap-stack);
  min-width: 0;
}

.discord-management-section-head {
  display: grid;
  gap: var(--space-2xs);
  min-width: 0;
}

.discord-management-section-head--inline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.discord-management-section-head h2 {
  margin: 0;
}

/* Картки дій парами: адмінська форма надто довга для трьох колонок */
/* Overview is a vertical workspace. Internal sections decide their own columns. */
/* =========================================================
   2. КАРТКИ ДІЙ
   ========================================================= */
.discord-management-card {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
  border-left: 3px solid var(--c-ink-500);
  min-width: 0;
}

/* Тон грані = ступінь ризику дії */
.discord-management-card--primary {
  border-left-color: var(--c-accent-400);
}

.discord-management-card--action {
  border-left-color: var(--c-warning);
}

.discord-management-card--settings {
  border-left-color: var(--c-info);
}


.discord-management-card--compact {
  border-left-color: var(--border-strong);
}

.discord-management-card__body {
  display: grid;
  gap: var(--space-md);
  min-width: 0;
}

.discord-management-details {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}


/* =========================================================
   3. СТАТУС І ЧІПИ
   ========================================================= */
.discord-management-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr));
  gap: var(--space-sm);
}

.discord-management-status__item {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.discord-management-status__item strong {
  font-size: 0.95rem;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.discord-management-status__item small {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* Ряд чіпів «що саме перевіряється» */
.discord-officer-sync-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.discord-info-chip {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-3xs);
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  font-size: 0.74rem;
  white-space: nowrap;
}

.discord-info-chip strong {
  font-weight: var(--font-weight-bold);
  color: var(--c-accent-300);
}

.discord-info-chip span {
  color: var(--text-muted);
}

/* =========================================================
   4. РОЛІ
   ========================================================= */
/* Порожній список ролей — підказка, а не пуста рамка */
.discord-role-checkboxes--empty {
  display: grid;
  place-items: center;
  min-height: 80px;
  padding: var(--space-md);
  border-style: dashed;
  color: var(--text-faint);
  font-size: var(--font-size-ui-lg);
  text-align: center;
}

/* =========================================================
   5. ПОЛІТИКИ ДОСТУПУ
   ========================================================= */

/* Небезпечний перемикач видно з першого погляду */


/* =========================================================
   6. ЖУРНАЛ ПОДІЙ
   ========================================================= */
/* =========================================================
   7. АДАПТИВ
   ========================================================= */

@media (max-width: 860px) {

  /* Пігулка статусу переїжджає під заголовок, а не тисне текст */

  /* Форми адмінки: дії на всю ширину — вони довгі й важливі */
  .discord-management-card .form-actions .btn {
    width: 100%;
  }
}

/* ---------- Останні дрібні класи адмінки ---------- */

.discord-management-section--status,
.discord-management-section--roles {
  gap: var(--gap-stack);
}

/* =========================================================
   8. OWNER SERVER MONITORING
   ========================================================= */
.server-status-page,
.server-status-dashboard {
  min-width: 0;
}

.server-status-dashboard {
  display: grid;
  gap: var(--gap-section);
}

.server-status-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
}

.server-status-toolbar > div:first-child {
  display: grid;
  gap: var(--space-3xs);
}

.server-status-toolbar strong {
  color: var(--text-strong);
  font-size: 0.95rem;
}

.server-status-toolbar small {
  color: var(--text-muted);
}

.server-status-toolbar__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
}

.server-status-error {
  grid-column: 1 / -1;
  margin: 0;
}

.server-summary-grid,
.server-graphs-grid,
.server-detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-md);
}

.server-summary-card,
.server-graph-card,
.server-core-card {
  --server-tone: var(--c-info);
}

.server-summary-card.is-good,
.server-graph-card.is-good,
.server-core-card.is-good {
  --server-tone: var(--c-success);
}

.server-summary-card.is-warning,
.server-graph-card.is-warning,
.server-core-card.is-warning {
  --server-tone: var(--c-warning);
}

.server-summary-card.is-critical,
.server-graph-card.is-critical,
.server-core-card.is-critical {
  --server-tone: var(--c-danger);
}

.server-summary-card.is-neutral,
.server-graph-card.is-neutral,
.server-core-card.is-neutral {
  --server-tone: var(--c-info);
}

.server-summary-card {
  display: grid;
  gap: var(--space-xs);
  padding: var(--space-md);
  border-top: 2px solid var(--server-tone);
}

.server-summary-card > span {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-heavy);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.server-summary-card > strong {
  color: var(--text-strong);
  font-size: clamp(1.45rem, 3vw, 2.2rem);
  line-height: 1;
}

.server-summary-card > small {
  color: var(--text-muted);
  line-height: var(--line-height-compact);
}

.server-usage {
  position: relative;
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  box-shadow: inset 0 0 0 1px var(--border-subtle);
}

.server-usage > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--server-tone, var(--c-info));
  transition: width 260ms ease;
}

.server-graphs-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.server-graph-card {
  min-width: 0;
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
}

.server-graph-card__head,
.server-core-card__head,
.server-detail-card__head,
.server-section__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
  min-width: 0;
}

.server-graph-card__head > span,
.server-core-card__head > span,
.server-detail-card__head > span {
  color: var(--text-muted);
  font-size: var(--font-size-ui);
  font-weight: var(--font-weight-bold);
}

.server-graph-card__head > strong,
.server-core-card__head > strong,
.server-detail-card__head > strong {
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.server-graph,
.server-core-spark {
  display: block;
  width: 100%;
  overflow: visible;
  color: var(--server-tone);
}

.server-graph {
  height: 160px;
  margin-top: var(--space-sm);
}

.server-core-spark {
  height: 72px;
}

.server-graph__grid {
  stroke: var(--border-subtle);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.server-graph__line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.server-graph-card__scale {
  display: flex;
  justify-content: space-between;
  color: var(--text-faint, var(--text-muted));
  font-size: 0.64rem;
}

.server-section {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-lg);
}

.server-section__head h2 {
  margin: var(--space-3xs) 0 0;
}

.server-section__head p {
  max-width: 52ch;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-size-ui);
  text-align: right;
  overflow-wrap: anywhere;
}

.server-core-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--space-sm);
}

.server-core-card {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
  padding: var(--space-sm);
  border: 1px solid color-mix(in srgb, var(--server-tone) 30%, var(--border-subtle));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--server-tone) 5%, var(--surface-sunken));
}

.server-core-card small {
  color: var(--text-muted);
}

.server-detail-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.server-detail-card {
  display: grid;
  gap: var(--space-md);
  padding: var(--space-md);
}

.server-detail-card dl {
  display: grid;
  gap: var(--space-2xs);
  margin: 0;
}

.server-detail-card dl > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.server-detail-card dl > div:last-child {
  border-bottom: 0;
}

.server-detail-card dt {
  color: var(--text-muted);
}

.server-detail-card dd {
  margin: 0;
  color: var(--text-strong);
  font-weight: var(--font-weight-bold);
  text-align: right;
  overflow-wrap: anywhere;
}

.server-status-note {
  margin: 0;
  padding: 0 var(--space-xs);
  color: var(--text-muted);
  font-size: 0.74rem;
  line-height: var(--line-height-relaxed);
}

@media (max-width: 1120px) {
  .server-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .server-graphs-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 760px) {
  .server-status-toolbar {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }

  .server-status-toolbar__actions {
    justify-content: stretch;
  }

  .server-status-toolbar__actions .btn {
    flex: 1 1 150px;
  }

  .server-summary-grid,
.server-detail-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .server-section {
    padding: var(--space-md);
  }

  .server-section__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .server-section__head p {
    text-align: left;
  }

  .server-core-grid {
    grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  }
}

/* =========================================================
   9. ЄДИНА СТРУКТУРА РОЗДІЛУ «КЕРУВАННЯ»
   ========================================================= */
.admin-page {
  --admin-card-radius: 14px;
  --admin-control-height: var(--control-height);
  display: grid;
  gap: var(--space-md);
}

.admin-page-header {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(520px, 1.35fr);
  gap: 20px;
  align-items: stretch;
  padding: 20px 22px;
  border-radius: var(--admin-card-radius);
  background: linear-gradient(135deg, color-mix(in srgb, var(--surface-raised) 94%, var(--c-accent-500) 6%), var(--surface));
}

.admin-page-header__copy {
  display: grid;
  align-content: center;
  gap: 7px;
  min-width: 0;
}

.admin-page-header__copy h1 {
  margin: 0;
  font-size: clamp(1.55rem, 2.2vw, 2.15rem);
  line-height: 1.05;
  letter-spacing: -0.025em;
}

.admin-page-header__copy p {
  max-width: 68ch;
  margin: 0;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: var(--line-height-relaxed);
}

.admin-page-header__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
  gap: var(--space-xs);
  min-width: 0;
}

.admin-page-header__metric {
  --admin-metric-tone: var(--border-strong);
  display: grid;
  align-content: center;
  gap: var(--space-2xs);
  min-width: 0;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--admin-metric-tone) 36%, var(--border-subtle));
  border-radius: 11px;
  background: color-mix(in srgb, var(--admin-metric-tone) 5%, var(--surface-sunken));
}

.admin-page-header__metric.is-good { --admin-metric-tone: var(--c-success); }
.admin-page-header__metric.is-warning { --admin-metric-tone: var(--c-warning); }
.admin-page-header__metric.is-danger { --admin-metric-tone: var(--c-danger); }

.admin-page-header__metric > span {
  color: var(--text-faint);
  font-size: 0.65rem;
  font-weight: var(--font-weight-heavy);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.admin-page-header__metric > strong {
  min-width: 0;
  color: var(--text-strong);
  font-size: 0.92rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.admin-page-header__metric > small {
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-tight);
  overflow-wrap: anywhere;
}

/* Вкладки більше не виглядають як випадковий ряд пігулок. */
/* Базова геометрія всіх робочих блоків адмінки. */
.admin-page :where(.discord-management-card, .server-section, .server-detail-card, .server-graph-card, .server-summary-card) {
  border-radius: var(--admin-card-radius);
}

.admin-page :where(.input, .select, textarea) {
  min-height: var(--admin-control-height);
}

.admin-page :where(.btn) {
  min-height: var(--admin-control-height);
}

.admin-page :where(.profile-card-head, .discord-management-section-head, .server-section__head) h2 {
  margin: 0;
  font-size: var(--font-size-base);
  line-height: 1.25;
}

.admin-page :where(.profile-card-lead, .discord-management-section-head p) {
  color: var(--text-muted);
  font-size: var(--font-size-ui-lg);
  line-height: var(--line-height-relaxed);
}

/* =========================================================
   10. SERVER MONITORING V2 — швидке тихе оновлення + Docker cache
   ========================================================= */
.server-status-dashboard {
  gap: 14px;
}

.server-status-toolbar {
  padding: 14px 16px;
  border-radius: var(--admin-card-radius);
}

.server-status-toolbar__state {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.server-live-dot {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--c-success);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--c-success) 12%, transparent);
}

.server-live-dot.is-live {
  animation: server-live-pulse 2.2s ease-in-out infinite;
}

.server-live-dot.is-paused {
  background: var(--c-warning);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--c-warning) 12%, transparent);
}

.server-live-dot.is-error {
  background: var(--c-danger);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--c-danger) 12%, transparent);
}

@keyframes server-live-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1); }
}

.server-summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}

.server-summary-card {
  gap: 7px;
  min-height: 128px;
  padding: 14px 15px;
}

.server-summary-card > strong {
  font-size: clamp(1.4rem, 2.1vw, 1.95rem);
}

.server-graphs-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.server-graph-card {
  padding: 14px;
}

.server-graph {
  height: 128px;
  margin-top: 8px;
}

.server-section {
  gap: 14px;
  padding: 16px;
}

.server-docker-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
}

.server-docker-card {
  --server-docker-tone: var(--c-info);
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 12px 13px;
  border: 1px solid color-mix(in srgb, var(--server-docker-tone) 25%, var(--border-subtle));
  border-radius: 11px;
  background: color-mix(in srgb, var(--server-docker-tone) 4%, var(--surface-sunken));
}

.server-docker-card.is-good { --server-docker-tone: var(--c-success); }
.server-docker-card.is-warning { --server-docker-tone: var(--c-warning); }
.server-docker-card.is-neutral { --server-docker-tone: var(--c-info); }

.server-docker-card > span {
  color: var(--text-faint);
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-heavy);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.server-docker-card > strong {
  color: var(--text-strong);
  font-size: 1.18rem;
}

.server-docker-card > small {
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  line-height: 1.4;
}

.server-cache-health {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 11px 13px;
  border: 1px solid var(--border-subtle);
  border-radius: 11px;
  background: var(--surface-sunken);
}

.server-cache-health > div {
  display: grid;
  gap: var(--space-3xs);
}

.server-cache-health strong {
  color: var(--text-strong);
  font-size: var(--font-size-body-sm);
}

.server-cache-health small {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}

.server-cache-health code {
  flex: 0 0 auto;
  padding: 5px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  background: var(--surface-raised);
  color: var(--c-accent-300);
  font-size: var(--font-size-sm);
}

.server-cache-health.is-warning {
  border-color: color-mix(in srgb, var(--c-warning) 42%, var(--border-subtle));
  background: color-mix(in srgb, var(--c-warning) 7%, var(--surface-sunken));
}

.server-cache-health.is-good {
  border-color: color-mix(in srgb, var(--c-success) 28%, var(--border-subtle));
}

.server-docker-empty {
  padding: 16px;
  border: 1px dashed var(--border);
  border-radius: 11px;
  background: var(--surface-sunken);
}

.server-docker-empty strong {
  color: var(--text-strong);
}

.server-docker-empty p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-body);
}

.server-detail-grid {
  gap: 10px;
}

.server-detail-card {
  padding: 14px 16px;
}

@media (max-width: 1180px) {
  .admin-page-header {
    grid-template-columns: minmax(0, 1fr);
  }

  .server-docker-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 860px) {
  .admin-page {
    gap: var(--space-sm);
  }

  .admin-page-header {
    padding: 16px;
  }

  .admin-page-header__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .server-graphs-grid,
.server-docker-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .server-cache-health {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .server-live-dot.is-live {
    animation: none;
  }
}


/* =========================================================
   11. GROUPS — та сама робоча геометрія, що й решта керування
   ========================================================= */

/* Overview security cards: role/country choices use the same compact control language. */

.discord-management-status__item.is-ok {
  border-color: color-mix(in srgb, var(--c-success) 28%, var(--border-subtle));
  background: color-mix(in srgb, var(--c-success) 5%, var(--surface-sunken));
}

.discord-management-status__item.is-warning {
  border-color: color-mix(in srgb, var(--c-warning) 34%, var(--border-subtle));
  background: color-mix(in srgb, var(--c-warning) 6%, var(--surface-sunken));
}

.discord-management-status__item em {
  color: var(--text-faint);
  font-size: var(--font-size-xs);
  font-style: normal;
  line-height: var(--line-height-tight);
}

/* =========================================================
   12. OVERVIEW — зрозуміла геометрія сторінки керування
   ========================================================= */

/* =========================================================
   13. SECURITY FORMS — секції, вибір ролей, зрозумілий стан
   ========================================================= */

/* =========================================================
   12. DISCORD MANAGEMENT V2 — task-oriented workspace
   ========================================================= */
.discord-management-page {
  --discord-zone-gap: 14px;
}

.discord-management-health-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.72fr);
  gap: var(--discord-zone-gap);
  align-items: stretch;
  scroll-margin-top: 132px;
}

.discord-management-health-grid > .panel {
  height: 100%;
}

.discord-management-health-grid .discord-management-status {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.discord-management-section--roles {
  align-content: start;
}

.discord-role-hierarchy-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.discord-management-zone {
  display: grid;
  gap: 10px;
  min-width: 0;
  scroll-margin-top: 132px;
}

.discord-management-zone__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: 0 4px;
}

.discord-management-zone__head .discord-management-section-head {
  gap: var(--space-3xs);
}

.discord-management-zone__head h2 {
  font-size: 1.02rem;
}

.discord-settings-card {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(420px, 0.92fr);
  gap: 18px;
  align-items: end;
  border-left-color: var(--c-info);
}

.discord-settings-card__primary,
.discord-settings-card__limits {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}

.discord-settings-card__limits {
  padding-left: 18px;
  border-left: 1px solid var(--border-subtle);
}


.discord-settings-card__limits > .btn {
  justify-self: end;
  min-width: 220px;
}

.discord-member-actions-grid,
.discord-automation-grid {
  display: grid;
  gap: var(--discord-zone-gap);
  align-items: start;
  min-width: 0;
}

.discord-member-actions-grid {
  grid-template-columns: minmax(300px, 0.7fr) minmax(0, 1.55fr);
}

.discord-automation-grid {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
}

.discord-management-card {
  gap: var(--space-sm);
  padding: 16px;
  border-left-width: 2px;
}

.discord-management-card--member-roles {
  min-width: 0;
}

.discord-management-card--danger {
  border-left-color: var(--c-danger);
}

.discord-management-card__body {
  gap: var(--space-sm);
}

.discord-management-user-field {
  width: min(100%, 360px);
  max-width: 360px;
}

.discord-role-checkboxes {
  grid-template-columns: repeat(auto-fill, minmax(min(235px, 100%), 1fr));
  gap: 7px;
  max-height: 360px;
  padding: 7px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.discord-role-checkboxes--compact {
  grid-template-columns: repeat(auto-fill, minmax(min(215px, 100%), 1fr));
}

.discord-role-option {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: start;
  gap: 9px;
  min-width: 0;
  min-height: 58px;
  padding: 9px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-raised) 52%, var(--surface-sunken));
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.discord-role-option:hover {
  border-color: var(--border-strong);
  background: var(--surface-raised);
}

.discord-role-option:has(input:checked) {
  border-color: color-mix(in srgb, var(--c-accent-400) 62%, var(--border-strong));
  background: color-mix(in srgb, var(--c-accent-500) 10%, var(--surface-raised));
}

.discord-role-option > input {
  margin-top: 1px;
}

.discord-role-option__copy {
  display: grid;
  gap: var(--space-2xs);
  min-width: 0;
}

.discord-role-option__copy > strong {
  min-width: 0;
  color: var(--text-strong);
  font-size: 0.84rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.discord-role-option__copy > small {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 7px;
  min-width: 0;
  color: var(--text-faint);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-tight);
}

.discord-role-option__copy code {
  max-width: 100%;
  color: var(--text-muted);
  font-size: 0.65rem;
  overflow-wrap: anywhere;
  word-break: break-all;
}

.discord-role-option > em {
  align-self: center;
  padding: 3px 6px;
  border-radius: var(--radius-pill);
  background: var(--tint-warning-bg);
  color: var(--c-warning);
  font-size: 0.62rem;
  font-style: normal;
  font-weight: var(--font-weight-bold);
}

.discord-role-option.is-disabled {
  opacity: 0.62;
}

.discord-management-status__item {
  min-height: 90px;
  align-content: start;
  padding: 12px;
}

.discord-management-status__item small {
  order: -1;
}

.discord-management-status__item strong {
  font-size: 0.92rem;
  line-height: 1.25;
}

.discord-management-status__item em {
  margin-top: auto;
  font-size: var(--font-size-caption);
  line-height: var(--line-height-tight);
}

.discord-info-chip {
  align-items: center;
  white-space: normal;
}

.discord-info-chip small {
  color: var(--text-muted);
  font-size: 0.69rem;
}

.discord-management-blocked-roles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.discord-management-blocked-roles > span {
  display: grid;
  gap: var(--space-3xs);
  padding: 8px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.discord-management-blocked-roles strong {
  color: var(--text-soft);
  font-size: var(--font-size-meta);
}

.discord-management-blocked-roles small {
  color: var(--text-faint);
  font-size: 0.67rem;
  line-height: var(--line-height-tight);
}

.discord-management-details {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.discord-management-details > summary {
  min-height: var(--control-height);
  padding: 10px 12px;
  color: var(--text-soft);
  font-size: var(--font-size-meta);
  font-weight: var(--font-weight-bold);
  cursor: pointer;
}

.discord-management-details--explanation > p {
  margin: 0;
  padding: 0 12px 12px;
  color: var(--text-muted);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-copy);
}

.discord-inline-warning {
  margin: 0;
  padding: 9px 11px;
  border: 1px solid var(--tint-warning-border);
  border-radius: var(--radius-md);
  background: var(--tint-warning-bg);
  color: var(--text-soft);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-body);
}

.discord-automation-grid > form,
.discord-member-actions-grid > form {
  height: 100%;
}

@media (max-width: 1240px) {
  .discord-management-health-grid,
.discord-settings-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-settings-card__limits {
    padding-left: 0;
    padding-top: 14px;
    border-left: 0;
    border-top: 1px solid var(--border-subtle);
  }


  .discord-member-actions-grid {
    grid-template-columns: minmax(280px, 0.72fr) minmax(0, 1.28fr);
  }
}

@media (max-width: 1000px) {
.discord-member-actions-grid,
.discord-automation-grid {
    grid-template-columns: minmax(0, 1fr);
  }

}

@media (max-width: 700px) {
.discord-management-health-grid,
.discord-management-zone {
    scroll-margin-top: 84px;
  }

  .discord-management-health-grid .discord-management-status {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .discord-management-blocked-roles {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-role-checkboxes,
.discord-role-checkboxes--compact {
    grid-template-columns: minmax(0, 1fr);
    max-height: none;
    overflow: visible;
  }

  .discord-management-card {
    padding: 13px;
  }

  .discord-settings-card__limits > .btn,
.discord-management-card .form-actions .btn {
    width: 100%;
    min-width: 0;
  }

  .discord-management-user-field {
    width: 100%;
    max-width: none;
  }
}

@media (max-width: 520px) {
  .discord-management-health-grid .discord-management-status {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-management-zone__head {
    align-items: stretch;
  }

  .discord-role-option {
    grid-template-columns: 20px minmax(0, 1fr);
  }

  .discord-role-option > em {
    grid-column: 2;
    justify-self: start;
  }
}

/* Automated inactive-account maintenance -------------------------------- */

/* Discord nickname warning automation */
.discord-settings-card {
  align-items: start;
  grid-template-columns: minmax(320px, 0.78fr) minmax(520px, 1.22fr);
}

.discord-settings-card__limits {
  align-content: start;
}

.nickname-policy-card,
.nickname-warning-settings {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  border: 1px solid rgba(245, 158, 11, 0.18);
  border-radius: 16px;
  background: rgba(18, 13, 9, 0.48);
}

.nickname-policy-card__head,
.nickname-warning-settings__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.nickname-policy-card__head h3,
.nickname-warning-settings__head h3 {
  margin: 4px 0 0;
  font-size: var(--font-size-base);
}

.nickname-policy-card > p,
.nickname-warning-settings__head p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-size-ui-lg);
  line-height: var(--line-height-relaxed);
}

.nickname-structure-list {
  display: grid;
  gap: var(--space-xs);
}

.nickname-structure-item {
  display: grid;
  grid-template-columns: minmax(105px, auto) minmax(0, 1fr);
  gap: var(--space-sm);
  align-items: center;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--surface-sunken);
}

.nickname-structure-item > span {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
}

.nickname-structure-item code {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--c-accent-300);
  font-size: var(--font-size-ui);
}

.nickname-policy-example {
  display: grid;
  gap: var(--space-2xs);
  padding: 11px 12px;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.07);
}

.nickname-policy-example small {
  color: var(--text-muted);
}

.nickname-policy-example strong {
  overflow-wrap: anywhere;
  font-size: 0.86rem;
}

.nickname-advanced-settings > summary {
  color: var(--text-muted);
}

.nickname-advanced-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
  padding: 0 12px 12px;
}

.settings-toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  max-width: 420px;
  cursor: pointer;
}

.settings-toggle-row--card {
  min-width: 190px;
  padding: 10px 12px;
  border: 1px solid rgba(245, 158, 11, 0.18);
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.06);
}

.settings-toggle-row input {
  margin-top: 4px;
  accent-color: var(--c-accent-400);
}

.settings-toggle-row span {
  display: grid;
  gap: 3px;
}

.settings-toggle-row small {
  color: var(--text-muted);
  line-height: 1.4;
}

.nickname-warning-settings__group {
  display: grid;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.nickname-warning-settings__group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
}

.nickname-warning-settings__group-head > strong {
  font-size: var(--font-size-body-sm);
}

.nickname-warning-settings__group-head > small {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}

.nickname-warning-settings__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
}

.nickname-fallback-field {
  margin-top: 2px;
}

.input-with-suffix {
  position: relative;
}

.input-with-suffix .input {
  width: 100%;
  padding-right: 48px;
}

.input-with-suffix > span {
  position: absolute;
  top: 50%;
  right: 13px;
  transform: translateY(-50%);
  color: var(--text-faint);
  font-size: var(--font-size-sm);
  pointer-events: none;
}

.discord-settings-save-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.discord-settings-save-row > span {
  max-width: 520px;
  color: var(--text-muted);
  font-size: 0.74rem;
  line-height: var(--line-height-compact);
}

.discord-settings-save-row .btn {
  flex: 0 0 auto;
  min-width: 210px;
}

.nickname-warning-card .discord-management-card__body {
  gap: var(--space-md);
}

.nickname-warning-card__head {
  align-items: flex-start;
}

.nickname-warning-card__head p {
  max-width: 680px;
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: var(--font-size-ui-lg);
  line-height: var(--line-height-body);
}

.nickname-warning-status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.nickname-warning-metric {
  display: grid;
  align-content: start;
  gap: var(--space-2xs);
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--surface-sunken);
}

.nickname-warning-metric > small {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.nickname-warning-metric > strong {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--c-accent-300);
  font-size: var(--font-size-body);
}

.nickname-warning-metric > span {
  color: var(--text-faint);
  font-size: 0.69rem;
  line-height: var(--line-height-tight);
}

.nickname-warning-flow {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-xs);
}

.nickname-warning-flow > span {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 9px;
  align-items: center;
  min-width: 0;
  padding: 11px 12px;
  border: 1px solid rgba(245, 158, 11, 0.14);
  border-radius: 12px;
  background: rgba(12, 9, 7, 0.42);
}

.nickname-warning-flow b {
  grid-row: 1 / 3;
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border-radius: var(--radius-pill);
  background: rgba(245, 158, 11, 0.13);
  color: var(--c-accent-400);
  font-size: 0.75rem;
}

.nickname-warning-flow strong {
  min-width: 0;
  font-size: var(--font-size-body-sm);
}

.nickname-warning-flow small {
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  line-height: 1.4;
}

.nickname-warning-actions {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 14px;
  align-items: end;
  padding-top: 14px;
  border-top: 1px solid var(--border-subtle);
}

.nickname-warning-actions__field .field-label {
  margin: 0;
}

.nickname-warning-actions__buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
}

.nickname-warning-actions__buttons .btn {
  min-width: 0;
}

.nickname-warning-history__list {
  display: grid;
  gap: 7px;
  padding-top: 10px;
}

.nickname-warning-history__row {
  content-visibility: auto;
  contain-intrinsic-size: auto 74px;

  display: grid;
  grid-template-columns: minmax(170px, 1.35fr) repeat(4, minmax(86px, 0.65fr));
  gap: 10px;
  align-items: center;
  padding: 9px 11px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: var(--control-radius);
  background: rgba(0, 0, 0, 0.14);
  font-size: var(--font-size-meta);
}

.nickname-warning-history__row.is-warning,
.nickname-warning-history__row.is-error {
  border-color: rgba(248, 113, 113, 0.2);
}

.nickname-warning-history__row > span:first-child {
  display: grid;
  gap: var(--space-3xs);
}

.nickname-warning-history__row small {
  color: var(--text-muted);
}

@media (max-width: 1240px) {
  .discord-settings-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-settings-card__primary,
  .discord-settings-card__limits {
    padding-left: 0;
  }
}

@media (max-width: 980px) {
  .nickname-warning-status-grid,
  .nickname-warning-flow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nickname-warning-actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .nickname-warning-actions__buttons {
    justify-content: flex-start;
  }

  .nickname-warning-history__row {
    grid-template-columns: minmax(160px, 1.3fr) repeat(2, minmax(90px, 0.7fr));
  }
}

@media (max-width: 720px) {
  .nickname-policy-card__head,
  .nickname-warning-settings__head,
  .nickname-warning-settings__group-head,
  .discord-settings-save-row {
    display: grid;
  }

  .nickname-warning-settings__grid,
  .nickname-warning-status-grid,
  .nickname-warning-flow,
  .nickname-warning-history__row,
  .nickname-advanced-settings__grid {
    grid-template-columns: 1fr;
  }

  .nickname-structure-item {
    grid-template-columns: 1fr;
    gap: 5px;
  }

  .settings-toggle-row,
  .settings-toggle-row--card {
    max-width: none;
    width: 100%;
  }

  .discord-settings-save-row .btn,
  .nickname-warning-actions__buttons .btn {
    width: 100%;
  }
}

/* Discord role to website group mapping. Every row has a real select. */
```

## src/app/styles/components.css

```css

/* =========================================================
   COMPONENTS — панелі, кнопки, форми, повідомлення,
списки

   Усе взято з мови сайту: .card / .panel з assets/css/style.css,
поля форм з apply.css,
пігулки з guild.css. Тут вони зведені
   до кількох патернів,
щоб не описувати кожен клас окремо.

   Правило проєкту: жодного !important.
   ========================================================= */

/* =========================================================
   1. ПОВЕРХНІ: панель і картка
   ========================================================= */
.panel,
[class$="-card"]:not(:where([class*="nav"])),
[class*="-card "]:not(:where([class*="nav"])),
[class$="__card"],
[class*="__card "],
[class$="-panel"]:not(:where(.dashboard-list-panel)),
[class*="-panel "]:not(:where(.dashboard-list-panel)),
[class$="__panel"],
[class*="__panel "],
[class$="-box"],
[class*="-box "] {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}

.panel:not(:where([class*="hero"])) {
  padding: var(--pad-card);
}

[class$="-card"]:not(:where([class*="nav"])),
[class*="-card "]:not(:where([class*="nav"])),
[class$="__card"],
[class*="__card "],
[class$="-panel"]:not(:where(.dashboard-list-panel)),
[class*="-panel "]:not(:where(.dashboard-list-panel)),
[class$="__panel"],
[class*="__panel "],
[class$="-box"],
[class*="-box "] {
  padding: var(--pad-card-compact);
}

/* Панель — вертикальний стек: кожна панель дихає однаково.
   Hero-блоки виключені: вони теж носять .panel, але мають власну
   двоколонкову сітку в layout.css, і стек її перекривав. */
.panel:not(:where([class*="hero"])) {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
}

/* Панель усередині панелі не подвоює рамку */
.panel .panel,
.panel [class$="-card"],
.panel [class*="-card "],
.panel [class$="__card"],
.panel [class*="__card "] {
  background: var(--surface-raised);
  box-shadow: none;
}

/* Клікабельна картка */
a.card,
a[class$="-card"],
a[class*="-card "],
a[class$="__card"],
a[class*="__card "],
[class$="-card"][role="button"],
[class*="-card "][role="button"] {
  color: inherit;
  transition: transform var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

a.card:hover,
a[class$="-card"]:hover,
a[class*="-card "]:hover,
a[class$="__card"]:hover,
a[class*="__card "]:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-lg);
  color: inherit;
}

/* Виділена картка — смуга акценту зліва */
.is-active[class$="-card"],
.is-active[class*="-card "],
.is-selected[class$="-card"],
.is-selected[class*="-card "] {
  border-color: var(--border-strong);
}

.is-active[class$="-card"]::after,
.is-active[class*="-card "]::after,
.is-selected[class$="-card"]::after,
.is-selected[class*="-card "]::after {
  content: "";
  position: absolute;
  inset: var(--space-sm) auto var(--space-sm) 0;
  width: 3px;
  border-radius: var(--radius-pill);
  background: var(--accent-gradient);
  pointer-events: none;
}

/* Шапка картки: заголовок ліворуч,
дії праворуч */
.profile-card-head,
.poll-section-head,
.content-section-head,
.content-form-section-head,
[class$="__head"],
[class*="__head "],
[class$="-head"],
[class*="-head "] {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-card-head--inline,
[class$="__head"] > div,
[class*="__head "] > div,
[class$="-head"] > div,
[class*="-head "] > div {
  min-width: 0;
}

[class$="__head"] strong,
[class*="__head "] strong,
[class$="-head"] strong,
[class*="-head "] strong {
  color: var(--text-strong);
}

[class$="__head"] small,
[class*="__head "] small,
[class$="-head"] small,
[class*="-head "] small {
  display: block;
  color: var(--text-muted);
}

.profile-card-lead,
[class$="__lead"],
[class*="__lead "] {
  color: var(--text-soft);
  font-size: var(--font-size-body);
  line-height: 1.58;
}

/* Іконка-плитка в шапці */
[class$="__icon"],
/* Іконка-плитка в шапці */
[class*="__icon "],
[class$="-icon"],
[class*="-icon "] {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
}

.global-toast__icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--c-accent-300);
  font-size: var(--font-size-base);
}

/* =========================================================
   2. КНОПКИ — єдиний силует інтерактивних дій
   ========================================================= */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  min-height: var(--control-height);
  padding: 0 var(--control-pad-x);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-raised);
  color: var(--text-body);
  font-size: 0.84rem;
  font-weight: var(--font-weight-bold);
  line-height: 1.2;
  letter-spacing: 0.005em;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.btn:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  color: var(--text-strong);
}

.btn:disabled,
.btn[aria-disabled="true"],
.btn.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Головна дія — бурштиновий градієнт, як кнопка донату на сайті */
.btn.primary,
.btn-primary {
  border-color: transparent;
  background: var(--accent-gradient);
  color: var(--text-on-accent);
}

.btn.primary:hover,
.btn-primary:hover {
  color: var(--text-on-accent);
  box-shadow: 0 12px 26px -14px var(--accent-ring);
}

/* Другорядна дія */
.btn.subtle,
.btn.secondary {
  background: var(--surface);
  color: var(--text-soft);
}

.btn.subtle:hover,
.btn.secondary:hover {
  background: var(--surface-hover);
  color: var(--text-strong);
}

/* Прозора */
.btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-soft);
}

.btn.ghost:hover {
  background: var(--surface-hover);
  border-color: var(--border-subtle);
}

/* Статусні */
.btn.danger {
  border-color: rgba(224, 112, 95, 0.35);
  background: rgba(224, 112, 95, 0.12);
  color: var(--c-danger);
}

.btn.danger:hover {
  background: rgba(224, 112, 95, 0.2);
  color: #ffb3a6;
}

.btn.warning {
  border-color: rgba(232, 179, 74, 0.35);
  background: rgba(232, 179, 74, 0.12);
  color: var(--c-warning);
}

.btn.warning:hover {
  background: rgba(232, 179, 74, 0.2);
  color: #ffd88a;
}

.btn.success {
  border-color: rgba(124, 196, 143, 0.35);
  background: rgba(124, 196, 143, 0.12);
  color: var(--c-success);
}

.btn.success:hover {
  background: rgba(124, 196, 143, 0.2);
  color: #a9e0ba;
}

/* Розміри */
.btn-sm {
  min-height: var(--control-height-sm);
  padding: 0 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-meta);
}

.btn-icon {
  width: var(--control-height);
  min-width: var(--control-height);
  padding: 0;
}

.btn__icon {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
}

.btn svg,
.btn__icon > svg {
  width: 1.1em;
  height: 1.1em;
  flex: 0 0 auto;
}

/* =========================================================
   3. ФОРМИ — геометрія з apply.css сайту
   ========================================================= */
.content-field,
.raid-poll-field,
.application-filter-field,
[class$="-field"]:not(:where([class*="filter-shell"])),
[class*="-field "]:not(:where([class*="filter-shell"])),
[class$="__field"],
[class*="__field "] {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.content-field > span,
.raid-poll-field > span,
[class$="-field"] > span:first-child,
[class*="-field "] > span:first-child,
.field-label,
label > span:first-child {
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.02em;
  color: var(--text-soft);
}

.field-label {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

/* Підказка під полем */
.content-field small,
[class$="-field"] small,
[class*="-field "] small {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Самі контролі */
.input,
.select,
.textarea,
.modern-select,
.markdown-area,
input[type="text"],
input[type="search"],
input[type="email"],
input[type="url"],
input[type="password"],
input[type="number"],
input[type="date"],
input[type="time"],
input[type="datetime-local"],
input:not(:where([type])),
select,
textarea {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--space-md);
  border: 1px solid rgba(255, 155, 85, 0.16);
  border-radius: var(--control-radius);
  background: var(--surface-sunken);
  color: var(--text-body);
  font-size: 16px;
  outline: 0;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.textarea,
.markdown-area,
textarea {
  min-height: 120px;
  padding: var(--space-sm) var(--space-md);
  line-height: var(--line-height-relaxed);
  resize: vertical;
}

.textarea.compact,
textarea.compact {
  min-height: 80px;
}

.markdown-area {
  font-family: var(--font-mono);
  font-size: 0.86rem;
}

.input::placeholder,
.textarea::placeholder,
input::placeholder,
textarea::placeholder {
  color: var(--text-faint);
}

.input:focus,
.select:focus,
.textarea:focus,
input:not(:where([type="checkbox"])):not(:where([type="radio"])):focus,
select:focus,
textarea:focus {
  border-color: var(--border-strong);
  background: rgba(12, 10, 7, 0.7);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.input:disabled,
select:disabled,
textarea:disabled,
.is-disabled .input {
  opacity: 0.55;
  cursor: not-allowed;
}

.input.is-invalid,
.is-invalid .input {
  border-color: rgba(224, 112, 95, 0.5);
}

/* Селект — стрілка домальована фоном, як на сайті */
.select,
.modern-select,
select {
  appearance: none;
  cursor: pointer;
  padding-right: var(--space-xl);
  background-image:
    linear-gradient(45deg, transparent 50%, var(--c-accent-300) 50%),
    linear-gradient(135deg, var(--c-accent-300) 50%, transparent 50%);
  background-position:
    right var(--space-md) center,
    right calc(var(--space-md) - 6px) center;
  background-size: 6px 6px, 6px 6px;
  background-repeat: no-repeat;
  font-weight: var(--font-weight-medium);
}

select option {
  background: #fff6ea;
  color: #1b120c;
}

/* Чекбокси та радіо */
input[type="checkbox"],
input[type="radio"] {
  width: 18px;
  height: 18px;
  min-height: 0;
  flex: 0 0 auto;
  padding: 0;
  accent-color: var(--c-accent-500);
  cursor: pointer;
}

.inline-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 36px;
  cursor: pointer;
  color: var(--text-soft);
  font-size: 0.85rem;
}

.inline-check > span {
  font-weight: var(--font-weight-ui);
}

.inline-check--card {
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

/* Секція форми */
.content-form-section,
.raid-form-section,
[class$="-form-section"],
[class*="-form-section "] {
  display: grid;
  gap: var(--space-md);
  padding: var(--pad-card-compact);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

fieldset {
  border: 0;
  min-width: 0;
}

legend {
  padding: 0;
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-accent-300);
}

form {
  min-width: 0;
}

/* =========================================================
   4. ПОВІДОМЛЕННЯ — нейтральне, помилка,
попередження
   ========================================================= */
.notice,
.error-note,
.warning-note,
.login-alert,
.raid-notice,
.discord-notice,
.raid-ilvl-notice,
[class$="-alert"],
[class*="-alert "],
[class$="-notice"],
[class*="-notice "] {
  display: block;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border);
  border-left: 3px solid var(--c-ink-500);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-soft);
  font-size: 0.86rem;
  line-height: var(--line-height-relaxed);
}

.notice.panel {
  border-left-width: 3px;
  box-shadow: none;
}

.error-note,
.login-alert,
.notice.danger {
  border-color: var(--tint-danger-border);
  border-left-color: var(--c-danger);
  background: var(--tint-danger-bg);
  color: var(--text-on-danger);
}

.warning-note,
.notice.warning,
.notice.is-warning {
  border-color: var(--tint-warning-border);
  border-left-color: var(--c-warning);
  background: var(--tint-warning-bg);
  color: var(--text-on-warning);
}

.notice.success,
.notice.is-ok {
  border-color: var(--tint-success-border);
  border-left-color: var(--c-success);
  background: var(--tint-success-bg);
  color: var(--text-on-success);
}

.notice.info,
.discord-notice {
  border-left-color: var(--c-accent-400);
  background: var(--accent-soft);
  color: var(--c-accent-100);
}

/* =========================================================
   5. ПІГУЛКИ ТА ЧІПИ
   ========================================================= */
.status-pill,
.poll-chip,
.status-chip,
.poll-state,
.raid-state,
.profile-count-pill,
.content-mode-pill,
[class$="-pill"],
[class*="-pill "],
[class$="-chip"],
[class*="-chip "],
[class$="-badge"],
[class*="-badge "],
[class$="-tag"],
[class*="-tag "] {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.04em;
  line-height: var(--line-height-copy);
  white-space: nowrap;
}

/* Тони пігулок — один набір станів на весь дашборд */
.is-ok,
.is-ready,
.is-active,
.is-synced,
.is-complete,
.is-connected,
.is-on,
.good,
.success,
[class$="--ok"],
[class*="--ok "],
[class$="--success"],
[class*="--success "] {
  --tone: var(--c-success);
}

.is-warning,
.is-pending,
.is-paused,
.warning,
[class$="--warning"],
[class*="--warning "] {
  --tone: var(--c-warning);
}

.is-problem,
.is-missing,
.is-blocked,
.is-expired,
.is-disconnected,
.is-invalid,
.danger,
[class$="--danger"],
[class*="--danger "],
[class$="--error"],
[class*="--error "] {
  --tone: var(--c-danger);
}

.is-selected,
.is-open,
.is-next,
.is-main,
.primary,
[class$="--accent"],
[class*="--accent "] {
  --tone: var(--c-accent-400);
}

.is-closed,
.is-empty,
.is-absent,
.is-off,
.subtle,
[class$="--muted"],
[class*="--muted "],
[class$="--ghost"],
[class*="--ghost "] {
  --tone: var(--c-ink-400);
}

.status-pill,
.poll-chip,
.status-chip,
.poll-state,
.raid-state,
.profile-count-pill,
.content-mode-pill,
[class$="-pill"],
[class*="-pill "],
[class$="-chip"],
[class*="-chip "],
[class$="-badge"],
[class*="-badge "] {
  border-color: color-mix(in srgb, var(--tone, var(--c-ink-400)) 32%, transparent);
  background: color-mix(in srgb, var(--tone, var(--c-ink-400)) 12%, transparent);
  color: var(--tone, var(--text-soft));
}

/* Кнопка-фільтр у шапці таблиці */
[class$="-filter"]:not(:where([class*="field"])),
[class*="-filter "]:not(:where([class*="field"])) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 38px;
  padding: 0 var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}


[class$="--tank"],
[class*="--tank "] {
  --tone: var(--c-role-tank);
}

[class$="--healer"],
[class*="--healer "] {
  --tone: var(--c-role-healer);
}

[class$="--dps"],
[class*="--dps "] {
  --tone: var(--c-role-dps);
}

[class$="--mythic"],
[class*="--mythic "] {
  --tone: var(--c-diff-mythic);
}

[class$="--heroic"],
[class*="--heroic "] {
  --tone: var(--c-diff-heroic);
}

[class$="--normal"],
[class*="--normal "] {
  --tone: var(--c-diff-normal);
}

/* =========================================================
   6. СПИСКИ ТА ТАБЛИЦІ
   ========================================================= */
.dashboard-list-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
}

.dashboard-list,
[class$="-list"]:not(:where(.dashboard-nav-more__menu-list)):not(:where(.discord-preview-list)),
[class*="-list "]:not(:where(.dashboard-nav-more__menu-list)):not(:where(.discord-preview-list)) {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}


/* Складений рядок: зміст ліворуч, дії праворуч */
.dashboard-list-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.dashboard-list-row > *:first-child {
  flex: 1 1 min(320px, 100%);
  min-width: 0;
}

/* Табличний рядок: рівні колонки, шапка вирівнюється з ними.
   Оголошено після .dashboard-list-row, тож на рядках із обома
   класами виграє саме сітка. */


.dashboard-list-row {
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: inherit;
  min-width: 0;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

a.dashboard-list-row:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  transform: translateY(-2px);
  color: inherit;
}

.dashboard-list-row > [role="cell"] {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.dashboard-list-row strong {
  font-size: 0.88rem;
  color: var(--text-strong);
  overflow-wrap: break-word;
}

.dashboard-list-row small {
  font-size: 0.74rem;
  color: var(--text-muted);
  overflow-wrap: break-word;
}

.dashboard-list-row > [role="cell"] > [class$="-pill"],
.dashboard-list-row > [role="cell"] > [class*="-pill "],
.dashboard-list-row > [role="cell"] > [class$="-chip"],
.dashboard-list-row > [role="cell"] > [class*="-chip "] {
  justify-self: start;
}


.raid-empty,
.poll-empty,
.content-empty,
[class$="-empty"]:not(:where([class*="characters"])):not(:where([class*="--empty"])),
[class*="-empty "]:not(:where([class*="characters"])):not(:where([class*="--empty"])) {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-xl) var(--space-md);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  text-align: center;
  color: var(--text-muted);
}

[class$="-empty"]:not(:where([class*="--empty"])) strong,
[class*="-empty "]:not(:where([class*="--empty"])) strong {
  color: var(--text-soft);
  font-size: 0.95rem;
}

/* Смуга показників над таблицею */
.guild-hero-stats,
.raid-list-summary,
[class$="-stats"]:not(:where([class*="grid"])),
[class*="-stats "]:not(:where([class*="grid"])) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(130px, 100%), 1fr));
  gap: var(--space-sm);
}

.guild-hero-stat-card {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

/* Керування у шапці таблиці */
.content-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}


/* Мобільний вигляд рядків: картка з підписами колонок */
/* ---------- Мобільний вигляд списків ----------
   Табличний рядок перетворюється на картку: підпис колонки стає
   надрядком, значення — під ним. Двоколонковий варіант із підписом
   збоку тут не працює — довгі значення (ніки, спеки, дати) стискали
   праву колонку до 2-3 символів на 390px. */
@media (max-width: 860px) {
  

  

  .dashboard-list {
    gap: var(--space-sm);
  }

  .dashboard-list-row {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
    gap: var(--space-xs);
    padding: var(--space-md);
    border-radius: var(--radius-md);
  }

  .dashboard-list-row > [role="cell"] {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3xs);
  }

  .dashboard-list-row > [role="cell"][data-label]::before {
    content: attr(data-label);
    font-size: 0.64rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  /* Перша комірка — заголовок картки, підпис їй не потрібен */
  

  

  

  /* Решта комірок лягає у дві колонки — інакше картка стає вежею */
  

  

  

  .dashboard-list-row > *:first-child {
    flex: 1 1 100%;
  }

  /* Дії у складених рядках розтягуються на всю ширину картки */
  .dashboard-list-actions,
.dashboard-list-row [class$="-actions"] {
    width: 100%;
  }

  

  

  
}

/* =========================================================
   7. ДЕТАЛІ, ТАБИ, ТУЛБАРИ
   ========================================================= */
details {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

summary {
  padding: var(--space-sm) var(--space-md);
  color: var(--text-soft);
  font-size: 0.85rem;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  list-style: none;
}

summary::-webkit-details-marker {
  display: none;
}

summary::before {
  content: "▸";
  display: inline-block;
  margin-right: var(--space-xs);
  color: var(--c-accent-300);
  transition: transform var(--dur-fast) var(--ease-out);
}

details[open] > summary::before {
  transform: rotate(90deg);
}

details > *:not(:where(summary)) {
  padding: 0 var(--space-md) var(--space-md);
}

/* Смуга вкладок */
[class$="-tabs"],
[class*="-tabs "] {
  display: flex;
  gap: var(--space-2xs);
  overflow-x: auto;
  scroll-snap-type: x proximity;
  padding-bottom: var(--space-2xs);
  scrollbar-width: none;
}

[class$="-tabs"]::-webkit-scrollbar,
[class*="-tabs "]::-webkit-scrollbar {
  display: none;
}

[class$="-tabs"] > a,
[class*="-tabs "] > a,
[class$="-tabs"] > button,
[class*="-tabs "] > button {
  flex: 0 0 auto;
  scroll-snap-align: start;
  min-height: 40px;
  padding: 0 var(--space-md);
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-size: var(--font-size-body-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

[class$="-tabs"] > a.is-active,
[class*="-tabs "] > a.is-active,
[class$="-tabs"] > button.is-active,
[class*="-tabs "] > button.is-active {
  border-color: transparent;
  background: var(--accent-gradient);
  color: var(--text-on-accent);
}

/* =========================================================
   8. АВАТАРИ ТА МЕДІА
   ========================================================= */
[class$="-avatar"],
/* =========================================================
   8. АВАТАРИ ТА МЕДІА
   ========================================================= */
[class*="-avatar "],
[class$="__avatar"],
[class*="__avatar "] {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border);
  background: var(--surface-raised);
}

.raid-signup-avatar--empty,
[class$="-avatar--empty"],
[class*="-avatar--empty "] {
  display: grid;
  place-items: center;
  border-style: dashed;
  color: var(--text-faint);
}

/* =========================================================
   9. ТОСТИ
   ========================================================= */
.global-toast-stack {
  position: fixed;
  right: var(--space-md);
  bottom: calc(var(--space-md) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: min(360px, calc(100vw - var(--space-xl)));
  pointer-events: none;
}

.global-toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border);
  border-left: 3px solid var(--tone, var(--c-accent-400));
  border-radius: var(--radius-md);
  background: var(--nav-panel);
  box-shadow: var(--shadow-lg);
  color: var(--text-body);
  font-size: 0.85rem;
  pointer-events: auto;
  animation: toast-in var(--dur-base) var(--ease-spring);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.global-toast__body {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: var(--space-3xs);
}

.global-toast__close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.global-toast__close:hover {
  background: var(--surface-hover);
  color: var(--text-strong);
}

@media (max-width: 640px) {
  .global-toast-stack {
    left: var(--space-sm);
    right: var(--space-sm);
    width: auto;
  }
}

/* =========================================================
   10. КАСТОМНІ ЧЕКБОКСИ Й РАДІО

   Системні контроли на темному тлі виглядають чужорідно:
   у Chrome вони світлі, у Firefox — інші за розміром.
   Малюємо власні, зберігаючи справжній input для доступності.
   ========================================================= */
input[type="checkbox"],
input[type="radio"] {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 20px;
  height: 20px;
  min-height: 0;
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-strong);
  background: var(--surface-sunken);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

input[type="checkbox"] {
  border-radius: var(--radius-sm);
}

input[type="radio"] {
  border-radius: 50%;
}

input[type="checkbox"]:hover,
input[type="radio"]:hover {
  border-color: var(--c-accent-400);
}

input[type="checkbox"]:checked,
input[type="radio"]:checked {
  border-color: transparent;
  background: var(--accent-gradient);
}

/* Галочка домальована рамкою — жодних зображень і шрифтів */
input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid var(--text-on-accent);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

input[type="radio"]:checked::after {
  content: "";
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--text-on-accent);
}

input[type="checkbox"]:focus-visible,
input[type="radio"]:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 4px var(--accent-soft);
}

input[type="checkbox"]:disabled,
input[type="radio"]:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Мітка поруч із контролом клікабельна цілком */
label:has(> input[type="checkbox"]),
label:has(> input[type="radio"]) {
  cursor: pointer;
}

/* Вибраний варіант підсвічує всю картку, а не лише кружечок */
label:has(> input[type="radio"]:checked),
label:has(> input[type="checkbox"]:checked) {
  border-color: var(--border-strong);
}

/* =========================================================
   11. РОЗМІР ЦІЛІ ДЛЯ ДОТИКУ

   На десктопі компактні кнопки (34–38px) доречні: миша точна.
   На сенсорі це замало — палець промахується. Тому мінімум
   піднімається саме за шириною екрана, а не глобально:
   інакше десктопні тулбари роздулися б без причини.
   ========================================================= */
@media (max-width: 860px) {
  .btn-sm,
.raid-list-icon-action,
.poll-tab,
.nav-sheet__link {
    min-height: 44px;
  }

  /* Іконкові кнопки лишаються квадратними, просто більшими */
  .raid-list-icon-action,
.profile-icon-action {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }

  /* Чекбокс і радіо: сам контрол більший, мітка клікабельна вся */
  input[type="checkbox"],
input[type="radio"] {
    width: 24px;
    height: 24px;
  }

  input[type="checkbox"]:checked::after {
    left: 8px;
    top: 3px;
    width: 6px;
    height: 12px;
  }

  input[type="radio"]:checked::after {
    inset: 6px;
  }

  .inline-check {
    min-height: 44px;
  }
}

/* Товщий бігунок діапазону там, де вказівник грубий.
   pointer: coarse точніший за ширину екрана: планшет із мишею
   лишається з тонким бігунком, телефон отримує великий. */

/* =========================================================
   12. ДОПОМІЖНІ ВИБОРИ — компактні чипи, не окремі кнопки дії
   ========================================================= */
.author-suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.author-suggestion-chips > small {
  flex: 0 0 auto;
}

.author-suggestion-chips > span {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  min-width: 0;
}

.author-suggestion-chip {
  display: inline-grid;
  gap: 1px;
  min-height: var(--control-height-sm);
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-soft);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.author-suggestion-chip:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  color: var(--text-strong);
}

.author-suggestion-chip strong {
  font-size: var(--font-size-ui);
  line-height: 1.15;
}

.author-suggestion-chip em {
  color: var(--text-faint);
  font-size: var(--font-size-2xs);
  font-style: normal;
  line-height: 1.15;
}

/* R6.7 publication recovery, scoped to its own panel. */
.publication-workbench { display: grid; gap: 1rem; min-width: 0; padding: clamp(1rem, 2vw, 1.5rem); }
.publication-workbench h2, .publication-workbench p { margin: 0; }
.publication-workbench__states { display: grid; gap: 1rem; margin: 0; }
.publication-workbench__states dt { font-weight: 700; }
.publication-workbench__states dd { margin: .35rem 0 0; overflow-wrap: anywhere; }
.publication-workbench__link { display: grid; gap: .5rem; min-width: 0; }
.publication-workbench__link input { width: 100%; min-width: 0; }
.publication-workbench__actions { display: flex; flex-wrap: wrap; gap: .65rem; }
.publication-workbench__actions .btn { white-space: normal; overflow-wrap: anywhere; max-width: 100%; }
/* Async actions may replace their button with a focusable result. */
[data-action-result]:focus,
[data-workflow-title]:focus {
  outline: 2px solid var(--orange-main);
  outline-offset: 3px;
  border-radius: 3px;
}
/* Keep empty live regions registered for assistive technology. */
[data-action-result]:empty {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Durable feedback for individual and bulk raid-poll actions. */
.raid-poll-action { display: contents; }
.raid-poll-action-result { flex-basis: 100%; max-width: 100%; margin: 0; color: var(--text-soft); overflow-wrap: anywhere; }
.poll-bulk-results { display: grid; gap: var(--space-sm); padding: 0; list-style: none; }
.poll-bulk-results li { display: flex; flex-wrap: wrap; gap: var(--space-sm); min-width: 0; overflow-wrap: anywhere; }
.poll-bulk-results span { flex-basis: 100%; }
```

## src/app/styles/desktop.css

```css
/* =========================================================
   DESKTOP — єдиний робочий каркас Mistblossom Vanguard

   Цей файл йде після основних доменних шарів, але перед явними
   інтеграційними винятками (guild-banner / management). Доменні файли описують
   зміст конкретних сторінок, а тут задається ОДНА геометрія ПК:
   ширина полотна, ритм секцій, картки, контролі, таблиці й профіль.
   ========================================================= */

@media (min-width: 1001px) {
  body {
    padding-top: 88px;
    background:
      radial-gradient(circle at 10% -8%, rgba(200, 155, 60, 0.11), transparent 32rem),
      radial-gradient(circle at 90% 0%, rgba(255, 122, 47, 0.055), transparent 30rem),
      linear-gradient(180deg, #0d0b08 0%, var(--site-bg-1) 48%, #15110d 100%);
  }

  /* ---------- Єдина ширина та відступ сторінок ---------- */
  main,
.container,
.app-page,
.admin-container {
    width: 100%;
    max-width: var(--page-max);
    margin-inline: auto;
    padding: 24px var(--page-gutter) 64px;
  }

  .container .container,
.app-page .dashboard-shell,
.container .dashboard-shell,
main .dashboard-shell {
    max-width: none;
    padding: 0;
  }

  .dashboard-shell,
.content-shell,
.app-page-stack,
[class$="-shell"],
[class*="-shell "] {
    gap: var(--page-gap);
  }

  .content-form-section,
.raid-form-section,
.discord-management-section {
    gap: var(--section-gap);
  }

  /* ---------- Поверхні: одна товщина, радіус і тінь ---------- */
  .panel {
    border-radius: var(--card-radius);
    border-color: rgba(255, 226, 196, 0.1);
    background: rgba(29, 23, 18, 0.76);
    box-shadow:
      0 14px 34px -27px rgba(0, 0, 0, 0.96),
      inset 0 1px 0 rgba(255, 255, 255, 0.018);
  }

  /* Fallback для доменних surface-класів. :where() має нульову
     специфічність, тому свідомий стиль конкретного компонента завжди
     сильніший за глобальну нормалізацію. */
  :where([class$="-card"]:not([class*="nav"]), [class*="-card "]:not([class*="nav"]), [class$="__card"], [class*="__card "], [class$="-panel"]:not(.dashboard-list-panel), [class*="-panel "]:not(.dashboard-list-panel), [class$="__panel"], [class*="__panel "], [class$="-box"], [class*="-box "]) {
    border-radius: var(--card-radius);
    border-color: rgba(255, 226, 196, 0.1);
  }

  .panel:not(:where([class*="hero"])) {
    padding: var(--panel-padding);
  }


  :where(.panel) :where(.panel, [class$="-card"], [class*="-card "], [class$="__card"], [class*="__card "]) {
    border-color: rgba(255, 226, 196, 0.075);
    background: rgba(12, 10, 7, 0.3);
    box-shadow: none;
  }

  /* ---------- Заголовок сторінки ---------- */
  .hero,
.dashboard-hero,
[class$="-hero"]:not(:where([class*="landing"])),
[class*="-hero "]:not(:where([class*="landing"])) {
    grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.7fr);
    gap: var(--space-lg);
    min-height: 0;
    padding: 22px 24px;
    border-radius: var(--card-radius);
    border-color: rgba(255, 178, 106, 0.14);
    background:
      linear-gradient(110deg, rgba(255, 155, 85, 0.05), transparent 42%),
      rgba(25, 20, 16, 0.82);
    box-shadow:
      0 16px 38px -30px rgba(0, 0, 0, 0.98),
      inset 0 1px 0 rgba(255, 255, 255, 0.024);
  }

  .hero-copy h1,
.dashboard-hero__copy h1,
[class$="-hero__copy"] h1,
[class*="-hero__copy "] h1 {
    margin-bottom: 6px;
    font-size: clamp(1.55rem, 1.9vw, 2.1rem);
    line-height: 1.12;
  }

  .eyebrow,
.app-state-eyebrow,
[class$="__eyebrow"],
[class*="__eyebrow "],
[class$="-eyebrow"],
[class*="-eyebrow "] {
    padding: 3px 9px;
    margin-bottom: 6px;
    font-size: 9.5px;
    letter-spacing: 0.12em;
  }

  .lead,
[class$="__lead"],
[class*="__lead "],
[class$="-lead"],
[class*="-lead "] {
    font-size: var(--font-size-body);
    line-height: 1.58;
  }

  /* ---------- Заголовки секцій та action bars ---------- */
  .dashboard-list-head,
.profile-card-head,
.content-section-head,
.content-form-section-head {
    align-items: center;
    gap: var(--space-md);
  }

  .dashboard-list-head h2,
.profile-card-head h2 {
    font-size: 1.08rem;
    line-height: 1.25;
  }

  .raid-greylist-mini-actions {
    gap: var(--space-xs);
  }

  /* ---------- Контроли ---------- */
  .btn {
    min-height: var(--control-height);
    padding-inline: var(--control-pad-x);
    border-radius: var(--control-radius);
    font-size: var(--font-size-body-sm);
  }

  .btn-sm {
    min-height: var(--control-height-sm);
    padding-inline: 12px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-meta);
  }

  .btn-icon {
    width: var(--control-height);
    min-width: var(--control-height);
    padding: 0;
  }

  input,
textarea,
select {
    font-size: 14px;
  }

  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
select {
    min-height: var(--control-height);
  }

  textarea {
    min-height: 104px;
  }

  /* ---------- Сітки: один ритм, без випадкових 12/24/32px ---------- */
  :where([class$="-grid"], [class*="-grid "], [class$="__grid"], [class*="__grid "]) {
    gap: var(--section-gap);
  }

  :where([class$="-layout"]:not(.access-groups-layout), [class*="-layout "]:not(.access-groups-layout)) {
    gap: var(--page-gap);
  }

  /* ---------- Таблиці й списки ---------- */
  .dashboard-list-panel {
    overflow: hidden;
    border: 1px solid rgba(255, 226, 196, 0.1);
    border-radius: var(--card-radius);
    background: rgba(29, 23, 18, 0.76);
    box-shadow: 0 14px 34px -27px rgba(0, 0, 0, 0.96);
  }

  .dashboard-list-head {
    padding: 16px 18px;
    border-bottom: 1px solid var(--border-subtle);
    background: rgba(255, 255, 255, 0.014);
  }

  

  .dashboard-list-row {
    border-color: rgba(255, 226, 196, 0.065);
  }

  .dashboard-list-row:hover {
    background: rgba(255, 155, 85, 0.035);
  }

  

  /* =======================================================
     PROFILE — виправлення проблем зі скріну
     ======================================================= */

  .profile-card-toolbar--compact {
    gap: var(--space-xs);
  }

  .profile-card-toolbar--compact > span {
    min-width: 84px;
    padding: 7px 12px;
  }

  /* auto-fit, не auto-fill: порожні треки більше не залишають
     величезну пусту ділянку праворуч, коли персонажів 2–3. */
  .profile-character-list--single-flow {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-md);
    align-items: stretch;
  }

  .profile-character-card {
    min-width: 0;
    height: 100%;
    padding: 0;
    overflow: hidden;
    background: var(--surface);
  }

  .profile-character-artwork {
    height: 250px;
  }

  .profile-character-body {
    min-height: 360px;
    padding: 18px;
  }

  .profile-character-actions,
.profile-character-actions__full,
.profile-character-actions__full > *,
.profile-character-actions__row > *,
.profile-character-action {
    width: 100%;
  }

  .profile-character-actions__row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-character-action {
    min-width: 0;
  }

  /* ---------- Адмінські екрани ---------- */
  .app-footer {
    padding-top: 24px;
    padding-bottom: 24px;
    background: rgba(12, 10, 7, 0.42);
  }

  .app-footer__inner {
    max-width: var(--page-max);
  }
}

@media (min-width: 1320px) {
  .dashboard-brand__copy strong {
    max-width: 260px;
  }
}

/* Logged-out public navigation shares the regular design language. */
.dashboard-public-nav { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; }
.dashboard-public-nav a { display: inline-flex; align-items: center; min-height: 36px; padding: 5px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); color: var(--text-soft); text-decoration: none; }
.dashboard-public-nav a:hover,
.dashboard-public-nav a[aria-current="page"] { color: var(--text-strong); border-color: var(--border-strong); background: var(--surface-sunken); }
.dashboard-public-nav--mobile { gap: 4px; flex-wrap: nowrap; }
.dashboard-public-nav--mobile a { padding: 5px 7px; font-size: 0.77rem; white-space: nowrap; }
@media (max-width: 380px) { .dashboard-public-nav--mobile a { padding: 4px 5px; font-size: 0.7rem; } }
```

## src/app/styles/directory.css

```css
/* =========================================================
   DIRECTORY — єдиний шаблон сторінок-довідників

   Одна розкладка на всі сторінки, де є «hero + фільтри + таблиця»:
   /guild (склад гільдії), /profiles (профілі) і будь-яка майбутня.

   Замість трьох паралельних наборів (`guild-*`, `profile-directory-*`,
   `directory-*`) правила описані один раз і згруповані селекторами,
   бо в розмітці ці класи вже стоять поруч на тих самих вузлах.

   Порядок блоків: оболонка → hero → підсумок → тулбар → фільтри →
   таблиця → віджети → адаптив. Жодного !important.
   ========================================================= */

/* =========================================================
   1. ОБОЛОНКА
   ========================================================= */

.guild-page {
  min-width: 0;
}

.guild-shell {
  display: flex;
  flex-direction: column;
  gap: var(--gap-grid);
  min-width: 0;
}

/* =========================================================
   2. HERO
   ========================================================= */

.guild-hero-side {
  display: grid;
  gap: var(--space-md);
  align-content: start;
  min-width: 0;
}

/* Бічна панель hero: підсумок + лічильники */
.guild-hero-summary {
  display: grid;
  gap: var(--space-sm);
}

.guild-hero-summary__block {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.guild-hero-summary__label {
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.guild-hero-summary__block strong {
  font-size: 0.98rem;
  color: var(--text-strong);
}

.guild-hero-summary__block p {
  margin: 0;
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

.guild-hero-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(96px, 100%), 1fr));
  gap: var(--space-xs);
}

.guild-hero-stat-card {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  text-align: left;
}

.guild-hero-stat-card > span {
  font-size: 0.62rem;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.guild-hero-stat-card > strong {
  font-size: 1.05rem;
  color: var(--c-accent-200);
}

.guild-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

/* Підсумкова картка: емблема + лічильник + смуга показників */


/* Кнопка ручного оновлення складу */
.guild-refresh-action {
  display: grid;
  gap: var(--space-2xs);
  justify-items: start;
}

.guild-refresh-action__status {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

.guild-refresh-action__status--loading {
  color: var(--c-info);
}

.guild-refresh-action__status--error {
  color: var(--c-danger);
}

/* =========================================================
   3. ТУЛБАР І ФІЛЬТРИ
   ========================================================= */


#guild-roster-search {
  display: block;
  min-width: 0;
}

/* Розгорнута панель розширених фільтрів */


/* Група діапазону займає дві колонки: усередині вже є дві */


/* ---------- Діапазон від/до з двома повзунками ---------- */


/* Поля «від» і «до» стоять поруч, повзунок — під ними на всю ширину.

   Позиції задані явно, бо в розмітці порядок інший:
   заголовок → «від» → повзунок → «до». З автоматичним
   розміщенням «до» падало у третій рядок, і група
   розтягувалась у вежу з трьох поверхів. */


/* Суфіксний патерн [class$="-filter"] у components.css робить із
   .directory-range-filter кнопку-пігулку: капсульна рамка, padding
   і min-height. Тут це контейнер групи полів, тож скидаємо. */


/* Два range-инпути накладаються один на одного над спільною лінією.
   Клікабельні лише «бігунки», тож нижній повзунок не перехоплює
   натискання по всій ширині доріжки. */


/* =========================================================
   4. ТАБЛИЦЯ ДОВІДНИКА
   ========================================================= */


/* Головна комірка рядка: імʼя крупніше за решту */


/* Підвал таблиці: пагінація + підпис */

/* Роль фарбує ліву грань рядка — так само, як статус у списку рейдів */


/* Клас + спек однією коміркою з кольоровою міткою класу */


/* Сегменти Raider.IO без окремого legacy-блоку: активний стан оформлює поточна таблиця. */

/* =========================================================
   6. АДАПТИВ

   Мобільні правила рядків таблиці живуть у components.css
   (рядок → картка з підписами колонок). Тут лише те, що
   стосується довідника: hero, фільтри й віджети.
   ========================================================= */

/* =========================================================
   PROFILE DIRECTORY — щільний, читабельний roster без дублювання статистики
   ========================================================= */

/* Staff-only Discord raid preferences; horizontally scrollable on mobile. */
```

## src/app/styles/management.css

```css
/* Opt-in management layer using the shared system palette.
   Ordinary surfaces and controls inherit geometry from the shared design system. */
.admin-workspace {
  gap: var(--page-gap);
  min-width: 0;
}
.admin-workspace *, .admin-workspace *::before, .admin-workspace *::after { box-sizing: border-box; }
.admin-workspace .panel {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--card-radius);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}
.admin-workspace :where(h1, h2, h3, p) { overflow-wrap: anywhere; }
.admin-workspace :where(h2) { font-size: clamp(21px, 2vw, 27px); line-height: 1.25; }
.admin-workspace :where(h3) { font-size: 19px; line-height: 1.35; }
.admin-workspace :where(p, label, small) { line-height: 1.6; }
.admin-workspace :where(.input, .select, textarea, select) { min-width: 0; max-width: 100%; }
.admin-workspace :where(input, select, button, a, textarea, summary):focus-visible { outline: 2px solid var(--accent-ring); outline-offset: 4px; }
.admin-workspace :where(.eyebrow) { font-size: 10px; font-weight: 750; letter-spacing: .12em; color: var(--c-accent-200); background: transparent; padding: 0; border: 0; border-radius: 0; }
.admin-workspace .admin-page-header { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; padding: clamp(22px, 3vw, 34px); }
.admin-workspace .admin-page-header__copy { max-width: 860px; }
.admin-workspace .admin-page-header h1 { margin: 8px 0 12px; font-size: clamp(29px, 3.3vw, 44px); line-height: 1.13; letter-spacing: -.025em; }
.admin-workspace .admin-page-header__copy p { max-width: 74ch; font-size: 14px; margin: 0; color: var(--text-soft); }
.admin-workspace .admin-page-header__metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 10px; min-width: 0; }
.admin-workspace .admin-page-header__metric { padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--card-radius); background: var(--surface-raised); min-width: 0; }
.admin-workspace .admin-page-header__metric strong { font-size: 18px; overflow-wrap: anywhere; }
.admin-workspace .management-nav { display: grid; grid-template-columns: 1.1fr 1.25fr .8fr; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: var(--card-radius); background: var(--nav-surface); }
.admin-workspace .management-nav-group { min-width: 0; }
.admin-workspace .management-nav-label { display: block; margin: 0 0 9px 8px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); }
.admin-workspace .management-nav-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(114px, 100%), 1fr)); gap: 5px; }
.admin-workspace .management-nav a { min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 11px 10px; border: 1px solid transparent; border-radius: 11px; color: var(--text-body); text-decoration: none; transition: background .15s ease, border-color .15s ease; }
.admin-workspace .management-nav a strong { font-size: 13px; font-family: inherit; }
.admin-workspace .management-nav a small { font-size: 10px; color: var(--text-muted); line-height: 1.4; overflow-wrap: anywhere; }
.admin-workspace .management-nav a:hover { background: var(--surface-hover); }
.admin-workspace .management-nav a[aria-current="page"] { border-color: var(--border-strong); background: var(--accent-soft); color: var(--text-strong); }
.admin-workspace .management-sections { min-width: 0; }
.admin-workspace .management-section-tabs { display: flex; flex-wrap: wrap; gap: 7px; padding: 0 0 15px; border-bottom: 1px solid var(--border); }
.admin-workspace .management-section-tabs button { white-space: normal; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 10px 14px; border: 1px solid transparent; border-radius: 11px; background: var(--surface-raised); color: var(--text-soft); cursor: pointer; font: inherit; font-size: 13px; }
.admin-workspace .management-section-tabs button[aria-selected="true"] { background: var(--accent-gradient); color: var(--text-on-accent); border-color: transparent; font-weight: 700; }
.admin-workspace .management-section-number { font-size: 10px; opacity: .6; font-variant-numeric: tabular-nums; }
.admin-workspace .management-section-panel { min-width: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.admin-workspace .management-section-panel[hidden] { display: none !important; }
.admin-workspace .management-section-description { margin: 15px 2px 20px; color: var(--text-soft); font-size: 13px; }
.admin-workspace .management-task-stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; min-width: 0; }
.admin-workspace .management-section-panel > :where(.panel, article, section) { padding: clamp(20px, 2.6vw, 30px); }
.admin-workspace .management-section-panel > .discord-management-health-grid { padding: 0; }
.admin-workspace .management-section-panel > .discord-management-zone { padding: 0; }
.admin-workspace :where(.nickname-policy-card, .discord-management-status__item, .server-summary-card) { border-radius: var(--card-radius); border-color: var(--border); }
.admin-workspace :where(.discord-management-card, .discord-management-section) { padding: clamp(20px, 2.5vw, 28px); }
.admin-workspace :where(.discord-settings-card__limits, .discord-member-actions-grid, .discord-automation-grid) { gap: 18px; }
.admin-workspace :where(.discord-management-card__body) { gap: 18px; }
.admin-workspace :where(.discord-management-details) { border: 1px solid var(--border); border-radius: var(--card-radius); background: var(--surface-sunken); }
.admin-workspace :where(.discord-management-details) > summary { padding: 13px 15px; cursor: pointer; min-height: 44px; color: var(--text-body); }
.admin-workspace :where(.discord-management-details) > :not(summary) { margin: 0 15px 15px; }
.admin-workspace .management-welcome-preview { width: 100%; }
.admin-workspace .management-welcome-preview img { width: 100%; height: auto; border-radius: 14px; display: block; }
.admin-workspace .management-preview-placeholder { display: grid; justify-items: center; text-align: center; align-content: center; gap: 10px; min-height: 210px; padding: 24px; background: radial-gradient(ellipse at top, var(--accent-soft), var(--surface-sunken)); border-radius: var(--card-radius); }
.admin-workspace .management-preview-placeholder strong { font-size: 19px; }
.admin-workspace .management-preview-placeholder p { color: var(--text-soft); font-size: 13px; margin: 0; }
.admin-workspace .server-status-toolbar { gap: 16px; }
.admin-workspace :where(.server-summary-grid, .server-graphs-grid, .server-detail-grid) { gap: 16px; }
.admin-workspace :where(.server-section, .server-summary-card) { padding: 22px; }
.admin-workspace .discord-cleanup { gap: 20px; }
.admin-workspace .discord-cleanup-member { border-radius: var(--card-radius); background: var(--surface-sunken); border-color: var(--border); }
@media (max-width: 1000px) {
  .admin-workspace .management-nav { grid-template-columns: 1fr 1fr; }
  .admin-workspace .management-nav-group:last-child { grid-column: 1 / -1; }
  .admin-workspace .management-nav-group:last-child .management-nav-links { max-width: 360px; }
}
@media (max-width: 700px) {
  .admin-workspace { gap: 16px; }
  .admin-workspace .management-nav { grid-template-columns: 1fr; gap: 13px; padding: 13px; }
  .admin-workspace .management-nav-group:last-child { grid-column: auto; }
  .admin-workspace .management-nav-group:last-child .management-nav-links { max-width: none; }
  .admin-workspace .management-nav a small { display: none; }
  .admin-workspace .management-nav a { padding: 11px 8px; }
  .admin-workspace .management-nav-label { margin-bottom: 5px; font-size: 9px; }
  .admin-workspace .admin-page-header { padding: 22px 18px; gap: 18px; }
  .admin-workspace .admin-page-header__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .admin-workspace .admin-page-header__metric { padding: 11px 12px; }
  .admin-workspace .admin-page-header__metric strong { font-size: 16px; }
  .admin-workspace .management-section-tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
  .admin-workspace .management-section-tabs button { padding: 11px 10px; text-align: left; font-size: 12px; }
  .admin-workspace .management-section-number { display: none; }
  .admin-workspace :where(.discord-management-card, .discord-management-section) { padding: 18px; }
  .admin-workspace .management-section-panel > :where(.panel, article, section) { padding: 18px; }
  .admin-workspace .management-section-panel > :where(.discord-management-health-grid, .discord-management-zone) { padding: 0; }
  .admin-workspace :where(.form-actions) { gap: 10px; }
  .admin-workspace :where(.form-actions) .btn { white-space: normal; }
  .admin-workspace .management-section-description { font-size: 12px; margin-bottom: 16px; }
}
@media (prefers-reduced-motion: reduce) { .admin-workspace .management-nav a { transition: none; } }

.admin-workspace .management-shortcut { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 20px; padding: 20px 24px; }
.admin-workspace .management-shortcut h2 { font-size: 19px; }
.admin-workspace .management-shortcut .btn { width: auto; }
@media (max-width: 700px) {
  .admin-workspace .management-shortcut { grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 18px; }
  .admin-workspace .management-shortcut .btn { width: 100%; }
}

/* R5: drafts and revision review use the existing system colour tokens. */

/* Management hub and protected maintenance use the same surface/tokens as all admin sections. */

/* Administration keeps navigation beside the task, with a single content column. */
.management-workspace-grid { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: var(--page-gap); align-items: start; }
.management-workspace-sidebar { position: sticky; top: calc(var(--nav-space, 72px) + var(--space-md)); max-height: calc(100dvh - var(--nav-space, 72px) - var(--space-xl)); overflow-y: auto; scrollbar-width: thin; }
.management-workspace-content { container-type: inline-size; display: grid; gap: var(--section-gap); min-width: 0; }
.management-workspace-sidebar .management-nav { grid-template-columns: 1fr; padding: var(--space-sm); gap: var(--space-lg); }
.management-workspace-sidebar .management-nav-links { grid-template-columns: 1fr; }
.management-workspace-content .admin-page-header { padding: var(--panel-padding); }
.management-workspace-content .admin-page-header h1 { font-size: clamp(1.65rem, 2.6vw, 2.25rem); }
@media (max-width: 1000px) {
  .management-workspace-grid { grid-template-columns: minmax(0, 1fr); }
  .management-workspace-sidebar { position: static; max-height: none; overflow: visible; }
  .management-workspace-sidebar .management-nav { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-sm); }
  .management-workspace-sidebar .management-nav-group:last-child { grid-column: auto; }
  .management-workspace-sidebar .management-nav-links { max-width: none; }
}
@media (max-width: 640px) {
  .management-workspace-sidebar .management-nav { grid-template-columns: minmax(0, 1fr); }
  .management-workspace-sidebar .management-nav-links { display: flex; flex-wrap: wrap; }
  .management-workspace-sidebar .management-nav-links a { flex: 1 1 auto; }
}
```

## src/app/styles/onboarding.css

```css
/* PROFILE SETUP — registration remains separate from public guild rules acceptance. */
.profile-name-panel {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-discord-standard__head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-discord-standard__head > span {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.profile-discord-standard__head strong {
  font-size: var(--font-size-body);
  color: var(--text-strong);
}

.profile-discord-standard__head small {
  font-size: var(--font-size-ui);
  line-height: var(--line-height-body);
  color: var(--text-muted);
}

.profile-name-panel__label {
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-soft);
}

.profile-discord-standard__identity {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

@media (max-width: 860px) {

  .profile-discord-standard__head {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .profile-discord-standard__head > *:nth-child(3) {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
#profile-gender-settings {
  min-width: 0;
}

@media (max-width: 760px) {

  .profile-candidate-bulk-buttons .btn {
    width: 100%;
    min-width: 0;
    justify-self: stretch;
  }

  .profile-candidates-box {
    border-radius: var(--radius-md);
  }
}
```

## src/app/styles/pages.css

```css
/* =========================================================
   PAGES — родини сторінок дашборду

   Базові поверхні, кнопки й поля вже описані в components.css.
   Тут лишається тільки те, що специфічне для конкретної
   сторінки: розкладка рядка рейду, перегляд Discord-повідомлення,
   бічна колонка профілю тощо.

   Жодного !important.
   ========================================================= */

/* =========================================================
   ГОЛОВНА
   ========================================================= */

.hero-secure-note {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--text-faint);
  font-size: var(--font-size-ui);
}

.hero-lock {
  color: var(--c-accent-300);
}

/* =========================================================
   ПУЛИ
   ========================================================= */
.poll-section-head {
  align-items: center;
}

.poll-chip--ghost {
  --tone: var(--c-ink-500);
}

/* =========================================================
   ПРОФІЛЬ
   ========================================================= */
/* Сторінка профілю: бічна колонка + основний стовпчик */

.profile-character-candidate__kind {
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.profile-discord-standard {
  display: grid;
  gap: var(--space-sm);
}

.profile-card-head--inline {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-sm);
}

.profile-empty-characters {
  display: grid;
  gap: var(--space-xs);
  padding: var(--space-lg);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  text-align: center;
  color: var(--text-muted);
}

.profile-empty-characters--compact {
  padding: var(--space-md);
}

.profile-nickname-preview {
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--c-accent-200);
  overflow-wrap: anywhere;
}

.profile-nickname-hint {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

/* =========================================================
   DISCORD — редактор і перегляд повідомлення
   ========================================================= */
.discord-builder-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr);
  gap: var(--gap-grid);
  align-items: start;
}

.discord-builder-panel,
.discord-preview-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: 0;
}

.discord-builder-titlebar,
.discord-preview-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--font-size-ui);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.discord-builder-body,
.discord-builder-form {
  display: grid;
  gap: var(--space-md);
  min-width: 0;
}

.discord-preview-mode-toggle {
  display: inline-flex;
  gap: var(--space-3xs);
  padding: var(--space-3xs);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
}

.discord-preview-mode-toggle button {
  min-height: 28px;
  padding: 0 var(--space-sm);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.04em;
  cursor: pointer;
}

.discord-preview-mode-toggle button.is-active {
  background: var(--accent-soft);
  color: var(--c-accent-200);
}

/* Полотно перегляду — темніше за панель, як канал у Discord */
.discord-preview-canvas {
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: #1a1611;
  overflow-x: auto;
}

.discord-preview-panel--mobile .discord-preview-canvas {
  max-width: 420px;
}

.discord-chat-preview {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-sm);
}

.discord-chat-preview__avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--c-discord);
  color: #fff;
  font-size: 0.75rem;
  font-weight: var(--font-weight-bold);
}

.discord-chat-preview__body {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-chat-preview__meta {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
}

.discord-chat-preview__meta strong {
  color: #fff;
  font-size: 0.92rem;
}

.discord-chat-preview__meta span {
  font-size: var(--font-size-caption);
  color: var(--text-faint);
}

.discord-preview-content {
  display: grid;
  gap: var(--space-2xs);
  color: #dcddde;
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.discord-preview-mentions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.discord-preview-mentions span,
.discord-preview-mention {
  padding: 0 var(--space-2xs);
  border-radius: var(--radius-sm);
  background: rgba(88, 101, 242, 0.24);
  color: #c9cdfb;
  font-weight: var(--font-weight-medium);
}

/* Сам ембед */
.discord-message-preview {
  border-left: 4px solid var(--c-accent-400);
  border-radius: var(--radius-sm);
  background: #211c16;
  padding: var(--space-sm) var(--space-md);
  max-width: 520px;
}

.discord-message-preview__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-sm);
}

.discord-message-preview__main {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-preview-author-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.discord-preview-author-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.discord-preview-author {
  font-size: var(--font-size-body-sm);
  font-weight: var(--font-weight-medium);
  color: #fff;
}

.discord-preview-title {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  color: var(--c-accent-200);
  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0;
  text-transform: none;
}

.discord-preview-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
  gap: var(--space-xs);
}

.discord-preview-fields--with-thumb {
  padding-right: var(--space-sm);
}

/* Discord кладе inline-поля поруч, а звичайні — на всю ширину ембеда */
.discord-preview-field--full {
  grid-column: 1 / -1;
}

.discord-preview-field {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.discord-preview-field-name {
  font-size: var(--font-size-body-sm);
  color: #fff;
}

.discord-preview-field-value {
  font-size: 0.84rem;
  color: #dcddde;
}

.discord-preview-thumb {
  width: 80px;
  height: 80px;
  border-radius: var(--radius-sm);
  object-fit: cover;
}

.discord-preview-image {
  width: 100%;
  margin-top: var(--space-sm);
  border-radius: var(--radius-sm);
}

.discord-message-preview footer {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--font-size-sm);
  color: var(--text-faint);
}

.discord-message-preview footer img {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}

.discord-preview-error {
  font-size: var(--font-size-ui-lg);
  color: var(--c-danger);
}

/* Markdown усередині перегляду */
.discord-preview-markdown {
  display: grid;
  gap: var(--space-xs);
  color: #dcddde;
  font-size: 0.88rem;
  line-height: var(--line-height-relaxed);
}

.discord-preview-markdown--compact {
  gap: var(--space-2xs);
}

.discord-preview-link {
  color: #00a8fc;
}

.discord-preview-heading {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  color: #fff;
  font-size: 0.95rem;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0;
  text-transform: none;
}

.discord-preview-subtext {
  font-size: var(--font-size-ui);
  color: var(--text-faint);
}

.discord-preview-quote {
  padding-left: var(--space-sm);
  border-left: 3px solid var(--c-base-400);
}

.discord-preview-list {
  display: grid;
  gap: var(--space-3xs);
  padding-left: var(--space-md);
}

.discord-preview-list-bullet {
  color: var(--c-accent-300);
}

.discord-preview-codeblock {
  padding: var(--space-sm);
  border: 1px solid #111;
  border-radius: var(--radius-sm);
  background: #131313;
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-lg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.discord-preview-spoiler {
  border-radius: var(--radius-sm);
  background: #202225;
  color: transparent;
  cursor: pointer;
}

.discord-preview-spoiler:hover {
  color: #dcddde;
}

.discord-preview-timestamp {
  padding: 0 var(--space-2xs);
  border-radius: var(--radius-sm);
  background: rgba(88, 101, 242, 0.18);
}

.discord-preview-emoji {
  display: inline-block;
  width: 1.25em;
  height: 1.25em;
  vertical-align: -0.2em;
}

.discord-preview-gap {
  height: var(--space-xs);
}

/* Керування Discord */
.discord-management-card {
  display: grid;
  gap: var(--space-sm);
}

.discord-management-card__body {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-management-card--action {
  border-color: var(--border-strong);
}

.discord-management-section {
  display: grid;
  gap: var(--gap-stack);
}

.discord-role-picker {
  --role-picker-gap: 6px;
  --role-picker-card-height: 40px;
  display: grid;
  gap: var(--role-picker-gap);
  min-width: 0;
}

.discord-role-selected-shell {
  display: grid;
  gap: var(--space-2xs);
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 88%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-raised) 78%, var(--surface-sunken));
}

.discord-role-selected-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  min-height: 18px;
}

.discord-role-selected-head strong {
  color: var(--text-strong);
  font-size: var(--font-size-ui);
}

.discord-role-selected-head span {
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-semibold);
}

.discord-role-selected {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 24px;
}

.discord-role-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 72%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--c-accent-500) 10%, var(--surface-raised));
  color: var(--text-strong);
  font-size: 0.75rem;
  font-weight: var(--font-weight-bold);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.discord-role-chip:hover {
  border-color: color-mix(in srgb, var(--c-accent-400) 58%, var(--border-strong));
  background: color-mix(in srgb, var(--c-accent-500) 16%, var(--surface-raised));
  transform: translateY(-1px);
}

.discord-role-chip__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.discord-role-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-sunken) 72%, transparent);
  color: var(--text-muted);
  font-size: var(--font-size-body-sm);
  line-height: 1;
}

.discord-role-placeholder {
  color: var(--text-faint);
  font-size: var(--font-size-ui);
  line-height: 1.25;
}

.discord-role-search-shell {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  min-height: 36px;
  padding-inline: 9px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 88%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-sunken) 72%, transparent);
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.discord-role-search-shell:focus-within {
  border-color: color-mix(in srgb, var(--c-accent-400) 54%, var(--border-strong));
  background: color-mix(in srgb, var(--surface-raised) 82%, var(--surface-sunken));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c-accent-500) 14%, transparent);
}

.discord-role-search-icon {
  color: var(--text-muted);
  font-size: var(--font-size-base);
  line-height: 1;
}

.discord-role-search {
  width: 100%;
  max-width: none;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.discord-role-search:focus {
  box-shadow: none;
}

.discord-role-picker-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  align-items: start;
}

.discord-role-picker-option {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  grid-template-areas: "control body badge";
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: var(--role-picker-card-height);
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 88%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-raised) 76%, var(--surface-sunken));
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.discord-role-picker-option:hover {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--surface-raised) 88%, var(--surface-sunken));
  transform: translateY(-1px);
}

.discord-role-picker-option[data-selected="true"] {
  border-color: color-mix(in srgb, var(--c-accent-400) 62%, var(--border-strong));
  background: color-mix(in srgb, var(--c-accent-500) 12%, var(--surface-raised));
}

.discord-role-picker-option__control {
  grid-area: control;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 72%, transparent);
  border-radius: var(--radius-pill);
  background: transparent;
  color: transparent;
  font-size: 0.75rem;
  font-weight: var(--font-weight-heavy);
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.discord-role-picker-option[data-selected="true"] .discord-role-picker-option__control {
  border-color: color-mix(in srgb, var(--c-accent-300) 72%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--c-accent-400) 72%, white 8%), color-mix(in srgb, var(--c-accent-500) 84%, black 8%));
  color: #201106;
}

.discord-role-picker-option__body {
  grid-area: body;
  display: grid;
  gap: 0;
  min-width: 0;
}

.discord-role-picker-option__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.discord-role-picker-option__name {
  min-width: 0;
  color: var(--text-strong);
  font-size: var(--font-size-body-sm);
  font-weight: var(--font-weight-bold);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discord-role-picker-option__hint {
  display: none;
}

.discord-role-picker-option__badge {
  grid-area: badge;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-sunken) 72%, transparent);
  color: var(--text-muted);
  font-size: 0.65rem;
  font-weight: var(--font-weight-bold);
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}

.discord-role-picker-option[data-selected="true"] .discord-role-picker-option__badge {
  border-color: color-mix(in srgb, var(--c-accent-400) 52%, var(--border-strong));
  background: color-mix(in srgb, var(--c-accent-500) 18%, var(--surface-raised));
  color: var(--c-accent-200);
}

.discord-role-empty {
  grid-column: 1 / -1;
  padding: 10px 12px;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-sunken) 82%, transparent);
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

.discord-role-picker__help {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-tight);
}

.discord-role-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.discord-visual-section {
  display: grid;
  gap: var(--space-sm);
}

.discord-shell,
.discord-hub-card {
  min-width: 0;
}

@media (max-width: 1000px) {
  .discord-builder-shell {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Дві колонки зберігаємо на планшетах. На телефоні переходимо в одну,
   але самі картки залишаються низькими й не перетворюються на вертикальні блоки. */
@media (max-width: 640px) {
  .discord-role-picker {
    --role-picker-gap: 6px;
    --role-picker-card-height: 44px;
  }

  .discord-role-selected-shell {
    padding: 7px 9px;
  }

  .discord-role-selected {
    min-height: 22px;
  }

  .discord-role-search-shell {
    min-height: 36px;
    padding-inline: 9px;
  }

  .discord-role-search {
    min-height: 32px;
  }

  .discord-role-picker-list {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .discord-role-picker-option {
    grid-template-columns: 20px minmax(0, 1fr) auto;
    grid-template-areas: "control body badge";
    align-items: center;
    gap: 7px;
    padding: 5px 8px;
    border-radius: var(--radius-md);
  }

  .discord-role-picker-option__control {
    width: 18px;
    height: 18px;
  }

  .discord-role-picker-option__hint {
    display: none;
  }

  .discord-role-picker-option__badge {
    min-width: 56px;
    min-height: 24px;
    padding-inline: 7px;
    font-size: 0.65rem;
  }

  .discord-role-picker__help {
    font-size: var(--font-size-xs);
  }
}

@media (max-width: 420px) {
  .discord-role-picker-option {
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: 7px;
  }

  .discord-role-picker-option__badge {
    min-width: 54px;
    padding-inline: 7px;
  }
}

@media (max-width: 640px) {
  .discord-message-preview__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-preview-thumb {
    width: 100%;
    height: auto;
  }
}

/* =========================================================
   КОНТЕНТ (новини / гайди)
   ========================================================= */
.content-hero-status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.content-hero-path {
  font-family: var(--font-mono);
  font-size: var(--font-size-meta);
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.content-mode-pill--library {
  --tone: var(--c-info);
}

.content-section-head--toolbar {
  align-items: center;
}

/* =========================================================
   АДМІН
   ========================================================= */
.admin-page {
  min-width: 0;
}

.admin-container {
  display: flex;
  flex-direction: column;
  gap: var(--gap-grid);
  min-width: 0;
}

/* На вузьких екранах адмінка ніколи не тягне горизонтальний скрол */
.admin-page * {
  overflow-wrap: break-word;
}

/* =========================================================
   ПРАВИЛА / ОНБОРДИНГ
   ========================================================= */

/* =========================================================
   АВТОРИЗАЦІЯ — пейзаж, золото й ембер із наданого шаблону.
   Ізольовано від геометрії навігації та решти сторінок.
   ========================================================= */
body:has(.login-screen) {
  padding: 0;
  background: #0c1734;
}

body:has(.login-screen) #site-starfield,
body:has(.login-screen) .app-footer--site-wide {
  display: none;
}

.login-screen {
  position: relative;
  isolation: isolate;
  flex: 1 0 auto;
  display: grid;
  place-items: center;
  max-width: none;
  margin: 0;
  min-height: 100vh;
  min-height: 100svh;
  width: 100%;
  padding: max(36px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(36px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
  overflow: hidden;
  background: #0c1734;
}
.login-background { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.login-background-poster { position: absolute; inset: 0; background: url("/assets/img/auth/forever-landscape.avif") center / cover no-repeat; transform: scale(1.06); }
.login-background-video { position: absolute; inset: 0; opacity: 0; transition: opacity 1.6s; }
.login-background.is-on .login-background-video { opacity: 1; }
.login-background-video video { position: absolute; top: 50%; left: 50%; width: 100%; height: 100%; max-width: none; object-fit: cover; transform: translate(-50%, -50%) scale(1.12); opacity: 0; transition: opacity 1s; }
.login-background-video video.is-retiring { opacity: 1; z-index: 1; transition: none; }
.login-background-video video.is-shown { opacity: 1; z-index: 2; }
.login-background::after { content: ""; position: absolute; inset: 0; background: radial-gradient(60% 45% at 50% 68%, rgba(6, 12, 30, .55) 0%, transparent 100%), radial-gradient(120% 80% at 50% 40%, transparent 35%, rgba(6, 12, 30, .75) 100%), linear-gradient(to bottom, rgba(6, 12, 30, .55) 0%, transparent 22%, transparent 45%, rgba(12, 23, 52, .92) 88%, #0c1734 100%); }

.login-shell {
  position: relative;
  z-index: 1;
  width: min(460px, 100%);
  padding: clamp(28px, 4vw, 42px) clamp(22px, 4vw, 36px);
  border: 1px solid rgba(216, 178, 94, .65);
  border-radius: 3px;
  background: linear-gradient(155deg, rgba(46, 33, 12, .95), rgba(9, 18, 44, .97));
  box-shadow: 0 30px 80px rgba(0, 0, 0, .55), 0 0 60px rgba(245, 197, 52, .08), inset 0 0 0 5px rgba(6, 12, 30, .16);
}

.login-shell__corner {
  position: absolute;
  width: 9px;
  height: 9px;
  background: #d8b25e;
  rotate: 45deg;
  box-shadow: 0 0 0 2px #2b1705;
  pointer-events: none;
}
.login-shell__corner--tl { top: -5px; left: -5px; }
.login-shell__corner--tr { top: -5px; right: -5px; }
.login-shell__corner--bl { bottom: -5px; left: -5px; }
.login-shell__corner--br { bottom: -5px; right: -5px; }

.login-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  min-width: 0;
  text-align: center;
}
.login-brandmark {
  position: relative;
  display: grid;
  width: 88px;
  height: 88px;
  place-items: center;
}
.login-brandmark__halo {
  position: absolute;
  inset: -20px;
  background: radial-gradient(circle, rgba(216, 178, 94, .17), transparent 68%);
  pointer-events: none;
}
.login-brandmark img {
  width: 72px;
  height: 72px;
  border: 1px solid #d8b25e;
  border-radius: 50%;
  background: #0c1734;
  box-shadow: 0 4px 18px rgba(0, 0, 0, .5);
}
.login-brandmark__frame {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(216, 178, 94, .45);
  border-radius: 50%;
  pointer-events: none;
}
.login-title-block { display: grid; justify-items: center; gap: 12px; width: 100%; }
.login-guild-name {
  max-width: 100%;
  margin: 0;
  color: #d8b25e;
  font-family: var(--font-guild-heading), Georgia, serif;
  font-size: 1rem;
  line-height: 1.35;
  letter-spacing: .13em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.login-content h1 {
  margin: 0;
  color: #fff3d6;
  font-family: var(--font-guild-heading), Georgia, serif;
  font-size: clamp(1.9rem, 4vw, 2.3rem);
  font-weight: 700;
  line-height: 1.15;
  text-wrap: balance;
  text-shadow: 0 2px 12px rgba(0, 0, 0, .65);
}
.login-title-divider { display: grid; grid-template-columns: 1fr 7px 1fr; align-items: center; gap: 9px; width: 152px; }
.login-title-divider > span { height: 1px; background: linear-gradient(90deg, transparent, #d8b25e); }
.login-title-divider > span:last-child { transform: scaleX(-1); }
.login-title-divider > i { width: 7px; height: 7px; rotate: 45deg; border: 1px solid #d8b25e; }
.login-lead { max-width: 34ch; margin: 0; color: #e0d5bb; font-size: .94rem; line-height: 1.65; }
.login-alert {
  width: 100%;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid #b66051;
  border-left: 3px solid #d48b76;
  border-radius: 3px;
  background: rgba(85, 17, 17, .55);
  color: #ffede1;
  font-size: .92rem;
  line-height: 1.55;
  text-align: left;
  overflow-wrap: anywhere;
}
.login-alert.notice.success { border-color: #7eae8c; background: rgba(26, 56, 40, .65); color: #e3f3e5; }
.login-alert strong { color: inherit; }
.login-action-row { display: grid; gap: 12px; width: 100%; }
.login-discord-button {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px 16px;
  border: 2px solid #d8b25e;
  border-radius: 3px;
  background: linear-gradient(180deg, #b82e25, #8e1b16 55%, #5a0d0a);
  color: #fff3d6;
  text-align: left;
  box-shadow: inset 0 1px 0 rgba(255, 220, 160, .45), 0 0 0 1px #2b1705, 0 8px 24px rgba(0, 0, 0, .35);
  transition: filter .2s, transform .2s;
}
.login-discord-button:hover { color: #fff3d6; filter: brightness(1.12); }
.login-discord-button:active { transform: translateY(1px); }
.login-discord-button:focus-visible,
.login-token summary:focus-visible,
.login-token input:focus-visible,
.login-token button:focus-visible { outline: 2px solid #ffe9b5; outline-offset: 5px; }
.login-discord-button__icon { display: grid; width: 28px; height: 28px; place-items: center; }
.login-discord-button__icon svg { width: 26px; height: 26px; }
.login-discord-button strong { display: block; color: inherit; font-size: 1rem; line-height: 1.3; }
.login-discord-button small { display: block; margin-top: 3px; color: #f3d7c3; font-size: .72rem; line-height: 1.4; }
.login-discord-button__arrow { color: #f3d58d; font-size: 1.3rem; }
.login-token { width: 100%; padding-top: 18px; border-top: 1px solid rgba(216, 178, 94, .25); text-align: left; }
.login-token summary { padding-block: 6px; color: #d8c69d; font-size: .85rem; cursor: pointer; }
.login-token form { display: grid; gap: 9px; margin-top: 12px; }
.login-token label { color: #efe2c0; font-size: .85rem; }
.login-token__row { display: flex; gap: 10px; }
.login-token__row input { min-width: 0; flex: 1; border-color: rgba(216, 178, 94, .55); background: #0c1734; color: #fff3d6; font-size: 16px; }
.login-token__row button { flex: 0 0 auto; min-height: 46px; padding-inline: 16px; }

@media (max-width: 640px) {
  .login-screen {
    padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));

  }
  .login-shell { padding: 28px 22px; }
  .login-content { gap: 18px; }
  .login-brandmark { width: 78px; height: 78px; }
  .login-brandmark img { width: 64px; height: 64px; }
  .login-content h1 { font-size: clamp(1.75rem, 7.5vw, 2rem); }
  .login-guild-name { font-size: .85rem; letter-spacing: .09em; }
  .login-lead { font-size: .9rem; }
  .login-discord-button { min-height: 64px; gap: 10px; padding-inline: 12px; }
  .login-discord-button strong { font-size: .95rem; }
  .login-discord-button__arrow { display: none; }
  .login-discord-button { grid-template-columns: auto minmax(0, 1fr); }
  .login-token__row { display: grid; }
  .login-token__row button { width: 100%; }
}

@media (max-height: 600px) and (min-width: 641px) {
  .login-screen { padding-block: 20px; }
  .login-shell { padding-block: 24px; }
  .login-content { gap: 14px; }
  .login-brandmark { width: 68px; height: 68px; }
  .login-brandmark img { width: 56px; height: 56px; }
}

@media (prefers-reduced-motion: reduce) {
  .login-discord-button { transition: none; }
  .login-background-video { display: none; transition: none; }
  .login-background-video video { transition: none; }
}

.app-state-page {
  display: grid;
  gap: var(--space-sm);
  justify-items: center;
  text-align: center;
}

/* =========================================================
   РОСТЕР
   ========================================================= */
.roster-inline-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

/* =========================================================
   ГОЛОВНА: КАЛЕНДАР І НАЙБЛИЖЧІ ПОДІЇ
   ========================================================= */

/* =========================================================
   DISCORD: РЕДАКТОР, ДІАГНОСТИКА, ТАБЛИЦІ
   ========================================================= */
.discord-builder-textarea,
.discord-description-area {
  min-height: 180px;
  font-family: var(--font-mono);
  font-size: 0.85rem;
}

.discord-send-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
}

.discord-load-message-btn {
  flex: 0 0 auto;
}

/* Вибір кольору: системний свотч + код поруч */
.discord-color-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.discord-color-picker input[type="color"] {
  width: 46px;
  height: 44px;
  min-height: 0;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-sunken);
  cursor: pointer;
}

.discord-color-code {
  font-family: var(--font-mono);
  font-size: var(--font-size-body-sm);
  color: var(--c-accent-200);
  text-transform: uppercase;
}

/* Чекбокси ролей і службові прапорці */
.discord-role-checkboxes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
  gap: var(--space-xs);
  max-height: 260px;
  overflow-y: auto;
  padding: var(--space-2xs);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.discord-inline-check,
.discord-timestamp-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 38px;
  color: var(--text-soft);
  font-size: var(--font-size-body-sm);
  cursor: pointer;
}

/* Діагностика та JSON-помилки — моноширинні блоки */
.discord-diagnostics {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}


.discord-json-error {
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--tint-danger-border);
  border-left: 3px solid var(--c-danger);
  border-radius: var(--radius-md);
  background: var(--tint-danger-bg);
  color: var(--text-on-danger);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui);
  overflow-wrap: anywhere;
}

.discord-management-blocked-roles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

/* Таблиці Discord-розділу успадковують шаблон довідника */
.discord-raid-signups-table,
.discord-rules-table {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-rules-data-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--space-sm);
}


.discord-rules-metric {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.discord-rules-metric strong {
  font-size: 1.05rem;
  color: var(--text-strong);
}

.discord-rules-metric small {
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* Дві колонки «бібліотека + редактор» */
.discord-rules-library-split {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: var(--gap-grid);
  align-items: start;
  min-width: 0;
}

.discord-preview-quote--multi {
  display: grid;
  gap: var(--space-3xs);
}

/* =========================================================
   ДРІБНІ КЛАСИ БЕЗ ВЛАСНОГО ДОМЕНУ
   ========================================================= */
.status-select {
  min-width: 0;
}

.sync-message,
.permission-check {
  color: var(--text-muted);
  font-size: var(--font-size-ui-lg);
  line-height: var(--line-height-relaxed);
}

.global-toast--persistent {
  border-left-color: var(--c-warning);
}

.access-denied-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

/* Завантаження зображення: підпис поверх поля */

/* Таблиці з модифікатором домену — ті самі правила довідника */


@media (max-width: 1000px) {
  .discord-rules-library-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 860px) {
  

  

  .discord-role-checkboxes {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-send-controls .btn {
    width: 100%;
  }
}


.discord-builder-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-md);
  align-items: start;
}

.discord-mode-pill {
  align-self: start;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0.35rem 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-raised) 85%, transparent);
  color: var(--text-soft);
  font-size: 0.75rem;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.discord-builder-form {
  gap: clamp(14px, 1.3vw, 18px);
}

.discord-builder-form .content-form-section {
  display: grid;
  gap: clamp(12px, 1.1vw, 16px);
  min-width: 0;
  padding: clamp(16px, 1.45vw, 22px);
  border-radius: 18px;
}

.discord-builder-form .content-form-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.discord-builder-form .content-form-section-head strong {
  font-size: var(--font-size-base);
}

.discord-builder-form .content-form-section-head small {
  color: var(--text-muted);
  font-size: var(--font-size-meta);
}

.discord-builder-form .content-field,
.discord-builder-form .inline-check,
.discord-builder-form .discord-field-row,
.discord-builder-form .discord-autorole-card,
.discord-builder-form .discord-role-picker {
  min-width: 0;
}

.discord-builder-form .content-field > span:first-child {
  margin-bottom: 6px;
}

.discord-builder-form .input:not(textarea),
.discord-builder-form .select,
.discord-builder-form .modern-select,
.discord-color-picker {
  min-height: 46px;
}

.discord-builder-form .input:not(textarea),
.discord-builder-form .select,
.discord-builder-form .modern-select {
  width: 100%;
}

.discord-edit-grid,
.discord-builder-grid,
.discord-author-footer-grid,
.discord-footer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(12px, 1vw, 16px);
  min-width: 0;
}

.discord-send-layout {
  display: grid;
  gap: clamp(12px, 1vw, 16px);
}

.discord-send-controls {
  display: grid;
  grid-template-columns: minmax(220px, 1.35fr) 96px 160px auto;
  gap: clamp(10px, 0.9vw, 14px);
  align-items: end;
  padding-top: 0;
  border-top: 0;
}

.discord-channel-field {
  grid-column: 1 / 2;
}

.discord-color-picker-field {
  grid-column: 2 / 3;
}

.discord-color-code-field {
  grid-column: 3 / 4;
}

.discord-timestamp-check {
  grid-column: 4 / 5;
  min-height: 46px;
  padding-inline: 2px;
  align-self: center;
}

.discord-content-field--full,
.discord-message-link-field,
.discord-author-name-field {
  grid-column: 1 / -1;
}

.discord-message-link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-sm);
  align-items: stretch;
}

.discord-load-message-btn {
  min-width: 122px;
  min-height: 46px;
}

.discord-color-picker-field .discord-color-picker {
  inline-size: 100%;
  block-size: 46px;
  padding: 4px;
  border-radius: var(--control-radius);
}

.discord-color-code-field .input,
.discord-color-picker-field .discord-color-picker {
  font-family: var(--font-mono);
}

.discord-builder-textarea,
.discord-description-area {
  min-height: 160px;
}

.discord-description-area {
  min-height: 170px;
}

.discord-author-footer-grid {
  align-items: start;
}

.discord-footer-grid,
.discord-builder-grid,
.discord-author-footer-grid {
  grid-auto-rows: minmax(min-content, max-content);
}

.discord-field-editor {
  display: grid;
  gap: var(--space-sm);
}

.discord-field-row {
  display: grid;
  gap: var(--space-sm);
  padding: clamp(12px, 1vw, 16px);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-sunken) 86%, transparent);
}

.discord-field-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.discord-add-field {
  justify-self: start;
}

.discord-autorole-toolbar {
  align-items: end;
}

.discord-autorole-toolbar .btn {
  min-height: var(--control-height);
}

.discord-autorole-card {
  gap: clamp(12px, 1vw, 16px);
  padding: clamp(14px, 1.1vw, 18px);
  border-radius: 16px;
}

.discord-autorole-card__head {
  align-items: start;
}

.discord-autorole-card__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.discord-autorole-card__actions .btn {
  min-height: 40px;
}

.discord-autorole-grid {
  gap: clamp(12px, 1vw, 16px);
}

.discord-autorole-grid .content-field small {
  margin-top: 6px;
  display: block;
}

.discord-builder-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
  justify-content: flex-start;
  padding-top: var(--space-sm);
}

.discord-builder-actions .btn {
  min-height: 46px;
}

.discord-preview-panel {
  position: sticky;
  top: calc(var(--nav-space) + var(--space-xs));
}

@media (max-width: 1200px) {
  .discord-send-controls {
    grid-template-columns: minmax(0, 1fr) 100px 170px;
  }

  .discord-channel-field,
.discord-content-field--full {
    grid-column: 1 / -1;
  }

  .discord-timestamp-check {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@media (max-width: 1000px) {
  .discord-preview-panel {
    position: static;
  }
}

@media (max-width: 860px) {
  .discord-builder-head,
.discord-edit-grid,
.discord-builder-grid,
.discord-author-footer-grid,
.discord-footer-grid,
.discord-autorole-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-mode-pill {
    justify-self: start;
  }

  .discord-send-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .discord-channel-field,
.discord-color-code-field,
.discord-content-field--full,
.discord-message-link-field,
.discord-author-name-field,
.discord-timestamp-check {
    grid-column: 1 / -1;
  }

  .discord-color-picker-field {
    grid-column: auto;
  }
}

@media (max-width: 640px) {
  .discord-builder-form .content-form-section {
    padding: 14px;
    border-radius: 16px;
  }

  .discord-send-controls,
.discord-message-link-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-load-message-btn,
.discord-builder-actions .btn,
.discord-autorole-toolbar .btn {
    width: 100%;
  }

  .discord-autorole-card__actions {
    width: 100%;
    justify-content: stretch;
  }

  .discord-autorole-card__actions .btn {
    flex: 1 1 110px;
  }

  .discord-builder-titlebar,
.discord-preview-titlebar {
    align-items: flex-start;
    flex-direction: column;
  }
}


/* Embed editor density normalization — shared by general embeds, rules and autoroles. */
.discord-builder-form .content-form-section {
  padding: clamp(14px, 1.15vw, 18px);
}

.discord-builder-form .input:not(textarea),
.discord-builder-form .select,
.discord-builder-form .modern-select,
.discord-builder-form .discord-color-picker,
.discord-builder-form .btn {
  min-height: var(--control-height);
}

.discord-builder-form .content-field > span:first-child {
  margin-bottom: 4px;
  font-size: var(--font-size-ui);
  line-height: 1.2;
}

.discord-builder-form .content-field small,
.discord-builder-form .discord-limit-counter {
  line-height: 1.25;
}

.discord-builder-form .discord-builder-textarea {
  min-height: 124px;
}

.discord-builder-form .discord-description-area {
  min-height: 146px;
}

.discord-builder-form .discord-author-footer-grid,
.discord-builder-form .discord-footer-grid,
.discord-builder-form .discord-builder-grid,
.discord-builder-form .discord-autorole-grid {
  gap: var(--space-sm);
}

.discord-builder-form .discord-autorole-card,
.discord-builder-form .discord-field-row {
  padding: 12px;
}

.discord-builder-form .discord-builder-actions .btn {
  min-height: 44px;
}

@media (max-width: 640px) {
  .discord-builder-form .input:not(textarea),
.discord-builder-form .select,
.discord-builder-form .modern-select,
.discord-builder-form .btn {
    min-height: 44px;
  }
}

/* =========================================================
   DISCORD AUTOROLES
   Shared embed foundation + Discord component editor
   ========================================================= */
.discord-hub-card--autoroles {
  border-color: color-mix(in srgb, var(--c-success) 32%, var(--border-subtle));
}

.discord-autorole-editor {
  display: grid;
  gap: var(--space-md);
  min-width: 0;
}

.discord-autorole-toolbar,
.discord-autorole-card__head,
.discord-autorole-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.discord-autorole-toolbar > div {
  display: grid;
  gap: var(--space-3xs);
}

.discord-autorole-toolbar small,
.discord-autorole-card small {
  color: var(--text-muted);
}

.discord-autorole-list {
  display: grid;
  gap: var(--space-sm);
}

.discord-autorole-card {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.discord-autorole-card__actions .btn {
  min-width: 0;
  padding-inline: 0.7rem;
}

.discord-autorole-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
  min-width: 0;
}

.discord-preview-components {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-top: 8px;
}

.discord-preview-component-button {
  appearance: none;
  border: 0;
  border-radius: 4px;
  min-height: 32px;
  padding: 2px 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
  font-weight: var(--font-weight-semibold);
  line-height: 1;
  color: #fff;
  cursor: default;
}

.discord-preview-component-button--1 { background: #5865f2; }
.discord-preview-component-button--2 { background: #4e5058; }
.discord-preview-component-button--3 { background: #248046; }
.discord-preview-component-button--4 { background: #da373c; }
.discord-preview-component-button.is-disabled { opacity: 0.5; }

@media (max-width: 760px) {
  .discord-autorole-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-autorole-toolbar,
.discord-autorole-card__head {
    align-items: stretch;
    flex-direction: column;
  }

  .discord-autorole-card__actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

/* =========================================================
   DISCORD HUB — responsive action dashboard
   Primary actions stay prominent; tools keep a balanced 3-up desktop row.
   ========================================================= */
.discord-hub-page {
  --discord-hub-gap: clamp(12px, 1.25vw, 18px);
}

.discord-hub-shell {
  gap: var(--discord-hub-gap);
}

.discord-dashboard-hero {
  align-items: stretch;
  gap: clamp(16px, 2vw, 24px);
  padding: clamp(18px, 2vw, 24px);
}

.discord-dashboard-hero .lead {
  max-width: 56ch;
}

.discord-dashboard-hero .hero-secure-note {
  margin-top: 12px;
}

.discord-dashboard-hero__side {
  align-content: stretch;
  gap: 10px;
}

.discord-dashboard-hero__side .guild-hero-summary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-xs);
}

.discord-dashboard-hero__side .guild-hero-summary__block {
  min-height: 78px;
  align-content: center;
  padding: 11px 13px;
}

.discord-dashboard-hero__side .guild-hero-summary__block strong,
.discord-dashboard-hero__side .guild-hero-summary__block p {
  overflow-wrap: anywhere;
}

.discord-dashboard-hero__side .guild-hero-stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-xs);
}

.discord-dashboard-hero__side .guild-hero-stat-card {
  min-height: 58px;
  align-content: center;
  padding: 9px 11px;
}

.discord-hub-sections {
  display: grid;
  gap: var(--discord-hub-gap);
  min-width: 0;
}

.discord-hub-section-group {
  display: grid;
  gap: var(--discord-hub-gap);
  min-width: 0;
  align-items: stretch;
}

.discord-hub-section-group--primary {
  grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
}

.discord-hub-section-group--tools {
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
}

.discord-hub-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 11px;
  min-width: 0;
  min-height: 214px;
  padding: clamp(16px, 1.4vw, 20px);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  transition: transform 160ms var(--ease-out),
    border-color 160ms var(--ease-out),
    background-color 160ms var(--ease-out);
}

.discord-hub-card--featured {
  min-height: 198px;
}

.discord-hub-card > .eyebrow {
  align-self: flex-start;
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.discord-hub-card > strong {
  display: block;
  color: var(--text-strong);
  font-size: clamp(1rem, 1.1vw, 1.12rem);
  line-height: 1.3;
}

.discord-hub-card > p {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--font-size-body);
  line-height: 1.58;
  overflow-wrap: anywhere;
}

.discord-hub-card > .btn {
  width: 100%;
  min-height: 44px;
  margin-top: auto;
  padding-inline: 14px;
}

.discord-hub-card:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--c-accent-300) 72%, white 28%);
  outline-offset: 3px;
}

@media (hover: hover) and (pointer: fine) {
  .discord-hub-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--c-accent-400) 36%, var(--border));
    background: color-mix(in srgb, var(--surface-raised) 92%, var(--c-accent-500) 8%);
  }
}

@media (max-width: 1080px) {
  .discord-hub-section-group--tools {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .discord-hub-section-group--tools > :last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
}

@media (max-width: 860px) {
  .discord-dashboard-hero {
    grid-template-columns: minmax(0, 1fr);
    padding: 18px;
  }

  .discord-dashboard-hero__side .guild-hero-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .discord-hub-card,
.discord-hub-card--featured {
    min-height: 0;
  }
}

@media (max-width: 680px) {
  .discord-hub-page {
    --discord-hub-gap: 10px;
  }

  .discord-hub-shell {
    gap: 10px;
  }

  .discord-dashboard-hero {
    gap: 14px;
    padding: 15px;
    border-radius: var(--radius-lg);
  }

  .discord-dashboard-hero .content-hero-status-row {
    gap: 6px;
  }

  .discord-dashboard-hero .content-hero-path {
    font-size: var(--font-size-sm);
    line-height: var(--line-height-tight);
  }

  .discord-dashboard-hero h1 {
    font-size: clamp(1.45rem, 7vw, 1.8rem);
  }

  .discord-dashboard-hero .lead {
    font-size: 0.88rem;
    line-height: var(--line-height-body);
  }

  .discord-dashboard-hero .hero-secure-note {
    margin-top: 9px;
    font-size: var(--font-size-ui);
  }

  .discord-dashboard-hero__side {
    gap: var(--space-xs);
  }

  .discord-dashboard-hero__side .guild-hero-summary,
.discord-dashboard-hero__side .guild-hero-stats {
    gap: 7px;
  }

  .discord-dashboard-hero__side .guild-hero-summary__block {
    min-height: 70px;
    padding: 9px 10px;
  }

  .discord-dashboard-hero__side .guild-hero-stat-card {
    min-height: 54px;
    padding: 8px;
  }

  .discord-dashboard-hero__side .guild-hero-stat-card > strong {
    font-size: 0.95rem;
  }

  .discord-hub-section-group--primary,
.discord-hub-section-group--tools {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-hub-section-group--tools > :last-child:nth-child(odd) {
    grid-column: auto;
  }

  .discord-hub-card {
    gap: 9px;
    padding: 15px;
    border-radius: var(--radius-lg);
  }

  .discord-hub-card > .eyebrow {
    white-space: normal;
    text-overflow: clip;
  }

  .discord-hub-card > strong {
    font-size: var(--font-size-base);
  }

  .discord-hub-card > p {
    font-size: 0.86rem;
    line-height: 1.52;
  }

  .discord-hub-card > .btn {
    min-height: 46px;
    font-size: var(--font-size-body);
  }
}

@media (max-width: 430px) {
  .discord-dashboard-hero__side .guild-hero-summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-dashboard-hero__side .guild-hero-summary__block {
    min-height: 0;
  }

  .discord-dashboard-hero__side .guild-hero-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .discord-dashboard-hero__side .guild-hero-stat-card {
    min-width: 0;
  }

  .discord-dashboard-hero__side .guild-hero-stat-card > span {
    font-size: 0.56rem;
    letter-spacing: 0.08em;
  }
}

@media (prefers-reduced-motion: reduce) {
  .discord-hub-card {
    transition: none;
  }
}

/* Standalone guild agreement shares the full-viewport login background. */
body:has(.guild-agreement-screen) { padding: 0; background: #0c1734; }
body:has(.guild-agreement-screen) #site-starfield { display: none; }
.guild-agreement-screen {
  position: relative; isolation: isolate; width: 100%; max-width: none; margin: 0;
  padding: max(48px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) 48px max(24px, env(safe-area-inset-left));
  flex: 1 0 auto; min-height: 80svh; color: #f4ead6;
}
.guild-agreement-card {
  position: relative; z-index: 1; width: min(860px, 100%); margin: 0 auto;
  border: 1px solid #94743e; border-radius: 18px; padding: clamp(24px, 4vw, 52px);
  background: linear-gradient(145deg, rgba(24, 30, 47, .96), rgba(15, 20, 35, .97));
  box-shadow: 0 24px 80px #0008, inset 0 0 0 4px #d8b25e0a;
}
.guild-agreement-heading { text-align: center; padding-bottom: 28px; border-bottom: 1px solid #d8b25e33; }
.guild-agreement-kicker { color: #d8b25e; font-size: 12px; letter-spacing: .15em; text-transform: uppercase; }
.guild-agreement-heading h1 { margin: 12px 0; color: #f4dfae; font-size: clamp(28px, 4vw, 42px); line-height: 1.2; overflow-wrap: anywhere; }
.guild-agreement-heading p,
.guild-agreement-note { color: #bfc4d1; }
.guild-agreement-account { display: inline-block; margin-top: 12px; padding: 8px 14px; border-radius: 20px; background: #ffffff08; color: #d5d9e3; font-size: 13px; overflow-wrap: anywhere; }
.guild-agreement-text { padding-block: 28px; font-size: 16px; line-height: 1.8; overflow-wrap: anywhere; }
.guild-agreement-text > :first-child { margin-top: 0; }
.guild-agreement-text h2,
.guild-agreement-text h3,
.guild-agreement-text h4 { color: #e9c77f; margin-block: 26px 12px; line-height: 1.4; }
.guild-agreement-text p { margin-block: 12px; }
.guild-agreement-text ul,
.guild-agreement-text ol { padding-left: 24px; }
.guild-agreement-text ul { list-style: disc; }
.guild-agreement-text ol { list-style: decimal; }
.guild-agreement-text li { margin-block: 8px; }
.guild-agreement-text a { color: #e9c77f; text-decoration: underline; }
.guild-agreement-text blockquote { border-left: 3px solid #d8b25e; margin-inline: 0; padding: 4px 18px; background: #ffffff05; }
.guild-agreement-text pre { overflow-x: auto; padding: 16px; background: #0004; }
.guild-agreement-text table { display: block; overflow-x: auto; max-width: 100%; border-collapse: collapse; }
.guild-agreement-text th,
.guild-agreement-text td { padding: 8px; border: 1px solid #d8b25e33; }
.guild-agreement-form { border-top: 1px solid #d8b25e33; padding-top: 24px; }
.guild-agreement-check { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; font-size: 15px; line-height: 1.6; min-height: 44px; }
.guild-agreement-check input { flex: 0 0 22px; width: 22px; height: 22px; margin: 2px 0; accent-color: #d8b25e; }
.guild-agreement-actions { display: grid; grid-template-columns: .75fr 1fr; gap: 12px; align-items: center; max-width: 432px; margin: 24px auto 0; }
.guild-agreement-login,
.guild-agreement-submit { display: inline-flex; align-items: center; justify-content: center; text-align: center; border-radius: 8px; padding: 8px 12px; font-family: inherit; text-decoration: none; line-height: 1.3; }
.guild-agreement-login { min-height: 45px; font-size: 12px; color: #b7bcc9; border: 1px solid #9dabc52e; background: #ffffff04; }
.guild-agreement-submit { min-height: 60px; font-size: 16px; font-weight: 700; color: #fff1d2; background: linear-gradient(#a53023, #761810); border: 1px solid #d8b25e99; cursor: pointer; transition: background-color .2s, box-shadow .2s; }
.guild-agreement-submit:disabled { opacity: .5; cursor: default; }
.guild-agreement-submit:not(:disabled):hover { box-shadow: 0 0 18px #d8b25e33; }
.guild-agreement-login:hover { color: #f4ead6; background: #ffffff0c; }
.guild-agreement-login:focus-visible,
.guild-agreement-submit:focus-visible,
.guild-agreement-check input:focus-visible { outline: 2px solid #f4dfae; outline-offset: 4px; }
.guild-agreement-note { text-align: center; font-size: 12px; line-height: 1.6; margin: 18px 0 0; }
.guild-agreement-notice { padding: 16px; margin-block: 24px; border: 1px solid #d8b25e66; border-radius: 10px; background: #d8b25e0d; line-height: 1.7; }
.guild-agreement-success { border-top: 1px solid #d8b25e33; padding-top: 28px; text-align: center; }
.guild-agreement-success > span { color: #a7dcaf; font-size: 36px; }
.guild-agreement-success .guild-agreement-login,
.guild-agreement-unavailable .guild-agreement-login { width: 180px; margin-top: 12px; }
.guild-agreement-unavailable { text-align: center; color: #bfc4d1; }
body:has(.guild-agreement-screen) .app-footer--site-wide { position: relative; z-index: 1; margin-top: 0; background: #0c1734e8; }
@media (max-width: 640px) {
  .guild-agreement-screen { padding: max(20px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 24px max(12px, env(safe-area-inset-left)); }
  .guild-agreement-card { padding: 24px 18px; border-radius: 12px; }
  .guild-agreement-text { font-size: 15px; line-height: 1.75; }
  .guild-agreement-submit { font-size: 14px; }
  .guild-agreement-login { padding-inline: 8px; }
}
@media (prefers-reduced-motion: reduce) { .guild-agreement-submit { transition: none; } }
.guild-rules-editor-note { color: var(--text-muted); line-height: 1.6; }
.guild-rules-editor-preview { padding: 16px; border: 1px solid var(--border-subtle); border-radius: 12px; box-shadow: var(--shadow-sm); background: #0c1734; color: #f4ead6; }
.guild-rules-editor-preview summary { cursor: pointer; min-height: 44px; align-content: center; }
```

## src/app/styles/patterns.css

```css

/* =========================================================
   PATTERNS — структурні заглушки за суфіксом класу

   У дашборді ~1250 класів. Описувати кожен окремо означало б
   повернути той самий борг,
з якого ми щойно вийшли. Тому тут
   зібрані загальні правила за суфіксом імені: будь-який
   *-row поводиться як рядок, *-stack — як вертикальний стек,
*-meta — як приглушений підпис.

   Цей шар підключається ПІСЛЯ components.css і pages.css,
але
   свідомо тримає низьку специфічність (один клас або атрибут),
тож будь-яке іменне правило вище лишається сильнішим.
   Виняток — тільки там,
де без цього ламається розкладка.
   ========================================================= */

/* ---------- Рядки: зміст ліворуч,
дії праворуч ---------- */
[class$="-row"]:not(:where([role="row"])),
[class*="-row "]:not(:where([role="row"])),
[class$="__row"],
[class*="__row "],
[class$="-bar"],
[class*="-bar "],
[class$="__bar"],
[class*="__bar "],
[class$="-toolbar"],
[class*="-toolbar "],
[class$="-links"],
[class*="-links "],
[class$="-badges"],
[class*="-badges "],
[class$="-pills"],
[class*="-pills "],
[class$="__pills"],
[class*="__pills "] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

/* ---------- Вертикальні стеки ---------- */
[class$="-stack"],
[class*="-stack "],
[class$="__stack"],
[class*="__stack "],
[class$="-column"],
[class*="-column "],
[class$="__column"],
[class*="__column "],
[class$="-body"],
[class*="-body "],
[class$="__body"],
[class*="__body "],
[class$="-copy"],
[class*="-copy "],
[class$="__copy"],
[class*="__copy "],
[class$="-content"]:not(:where(.discord-preview-content)),
[class*="-content "]:not(:where(.discord-preview-content)),
[class$="__content"],
[class*="__content "],
[class$="-main"],
[class*="-main "],
[class$="__main"],
[class*="__main "],
[class$="-identity"],
[class*="-identity "],
[class$="__identity"],
[class*="__identity "],
[class$="-summary"]:not(:where(summary)),
[class*="-summary "]:not(:where(summary)),
[class$="__summary"],
[class*="__summary "],
[class$="-details"]:not(:where(details)),
[class*="-details "]:not(:where(details)),
[class$="-steps"],
[class*="-steps "],
[class$="-group"],
[class*="-group "],
[class$="__group"],
[class*="__group "],
[class$="-groups"],
[class*="-groups "] {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

/* ---------- Сторінкові контейнери ---------- */
[class$="-page"],
[class*="-page "],
[class$="-container"]:not(:where(.container)),
[class*="-container "]:not(:where(.container)),
[class$="-shell"]:not(:where(.discord-builder-shell)),
[class*="-shell "]:not(:where(.discord-builder-shell)) {
  min-width: 0;
}

/* ---------- Форми ---------- */
[class$="-form"]:not(:where(.roster-inline-form)),
[class*="-form "]:not(:where(.roster-inline-form)),
[class$="__form"],
[class*="__form "] {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}

/* Форма-обгортка навколо однієї кнопки не має розтягуватись */
[class$="-action-form"],
[class*="-action-form "],
[class$="-button-form"],
[class*="-button-form "],
[class$="-bulk-form"],
[class*="-bulk-form "] {
  display: inline-grid;
  gap: var(--space-2xs);
}

/* ---------- Дрібний службовий текст ---------- */
[class$="-meta"],
[class*="-meta "],
[class$="__meta"],
[class*="__meta "],
[class$="-hint"],
[class*="-hint "],
[class$="__hint"],
[class*="__hint "],
[class$="-status"],
[class*="-status "],
[class$="__status"],
[class*="__status "],
[class$="-caption"],
[class*="-caption "],
[class$="-placeholder"],
[class*="-placeholder "],
[class$="-counter"],
[class*="-counter "],
[class$="__counter"],
[class*="__counter "],
[class$="-order"],
[class*="-order "] {
  color: var(--text-muted);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-body);
}

/* ---------- Заголовки блоків ---------- */
.section-title,
[class$="-title"]:not(:where(.discord-preview-title)),
[class*="-title "]:not(:where(.discord-preview-title)),
[class$="__title"]:not(:where(.app-footer__title)),
[class*="__title "]:not(:where(.app-footer__title)),
[class$="-label"]:not(:where(.field-label)),
[class*="-label "]:not(:where(.field-label)),
[class$="__label"],
[class*="__label "] {
  color: var(--text-strong);
  font-weight: var(--font-weight-bold);
  min-width: 0;
}

[class$="-label"]:not(:where(.field-label)),
[class*="-label "]:not(:where(.field-label)),
[class$="__label"],
[class*="__label "] {
  font-size: var(--font-size-ui-lg);
  letter-spacing: 0.02em;
}

[class$="-header"],
[class*="-header "],
[class$="__header"],
[class*="__header "] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-width: 0;
}

/* ---------- Виділені врізки ---------- */
[class$="-callout"],
[class*="-callout "],
[class$="-banner"],
[class*="-banner "],
[class$="-warning"]:not(:where(.warning-note)),
[class*="-warning "]:not(:where(.warning-note)) {
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--c-accent-400);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-soft);
  font-size: 0.85rem;
  line-height: var(--line-height-relaxed);
}

/* ---------- Варіанти вибору: радіо-картки ---------- */
[class$="-option"]:not(:where(option)),
[class*="-option "]:not(:where(option)),
[class$="__option"],
[class*="__option "] {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 40px;
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-size: 0.84rem;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

[class$="-option"]:hover,
[class*="-option "]:hover,
[class$="__option"]:hover,
[class*="__option "]:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

[class$="-option"].is-selected,
[class*="-option "].is-selected,
[class$="-option"].is-active,
[class*="-option "].is-active,
[class$="__option"].is-selected,
[class*="__option "].is-selected {
  border-color: var(--border-strong);
  background: var(--accent-soft);
  color: var(--c-accent-200);
}

/* ---------- Дії та кнопки без класу .btn ---------- */
[class$="-action"]:not(:where(.raid-action)):not(:where([class*="raid-action--"])),
[class*="-action "]:not(:where(.raid-action)):not(:where([class*="raid-action--"])),
[class$="__action"],
[class*="__action "],
[class$="-button"]:not(:where(.btn)),
[class*="-button "]:not(:where(.btn)),
[class$="__button"],
[class*="__button "] {
  min-width: 0;
}

/* ---------- Роздільники ---------- */
[class$="-divider"],
[class*="-divider "],
[class$="__divider"],
[class*="__divider "],
[class$="-separator"]:not(:where(.app-footer__link-separator)):not(:where(.discord-preview-footer-separator)),
[class*="-separator "]:not(:where(.app-footer__link-separator)):not(:where(.discord-preview-footer-separator)) {
  width: 100%;
  height: 1px;
  border: 0;
  background: var(--border-subtle);
}

/* ---------- Крапка-індикатор ---------- */
[class$="-dot"]:not(:where(.discord-role-dot)),
[class*="-dot "]:not(:where(.discord-role-dot)) {
  display: inline-block;
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--tone, var(--c-ink-400));
}

/* ---------- Посилання всередині блоків ---------- */
[class$="-link"]:not(:where(.discord-preview-link)),
[class*="-link "]:not(:where(.discord-preview-link)) {
  color: var(--c-accent-300);
}

/* ---------- Підвал блоку ---------- */
[class$="-footer"]:not(:where(.app-footer)),
[class*="-footer "]:not(:where(.app-footer)),
[class$="__footer"],
[class*="__footer "] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

/* ---------- Пошук ---------- */
[class$="-search"],
[class*="-search "],
[class$="__search"],
[class*="__search "] {
  display: block;
  min-width: 0;
}

/* ---------- Секції всередині сторінки ---------- */
[class$="-section"]:not(:where([class*="form-section"])),
[class*="-section "]:not(:where([class*="form-section"])),
[class$="__section"],
[class*="__section "] {
  display: grid;
  gap: var(--gap-stack);
  min-width: 0;
}

/* ---------- Елементи списків ---------- */
[class$="-item"]:not(:where(.dashboard-list-row)):not(:where(.raid-list-item)),
[class*="-item "]:not(:where(.dashboard-list-row)):not(:where(.raid-list-item)),
[class$="__item"]:not(:where(.dashboard-nav-measure__item)),
[class*="__item "]:not(:where(.dashboard-nav-measure__item)) {
  min-width: 0;
}

/* ---------- Нічого не має вилазити за межі екрана ---------- */
[class*="-page"],
[class*="-shell"],
[class*="-panel"],
[class*="-card"] {
  max-width: 100%;
}
```

## src/app/styles/profile.css

```css
/* =========================================================
   PROFILE — профіль, налаштування та суміжні сторінки

   Головна зміна структури: розділи йдуть ОДИН ЗА ОДНИМ згори вниз,
   а не розкидані в чотири колонки. Горизонтальна сітка на широкому
   екрані змушувала читати зигзагом і різала довгі підписи, а на
   вузькому все одно згорталася в стовпчик — тобто дві різні
   структури для одного змісту.

   Другий наскрізний мотив: пари <strong>значення</strong><small>підпис</small>
   тут описані один раз, бо саме через їхню відсутність підписи
   зліплювалися («ІмʼяДмитро», «0Гільдійні 0Інші»).

   Порядок: оболонка → бічна колонка → статуси → секції →
   персонажі → рейди → Battle.net → кандидати → адаптив.
   Жодного !important.
   ========================================================= */

/* =========================================================
   1. ОБОЛОНКА
   ========================================================= */

/* Дві колонки: липка бічна навігація + основний потік */

/* ---------- Бічна колонка ---------- */

/* =========================================================
   2. СТАТУСНА СМУГА
   ========================================================= */

/* Іконка-плитка: без неї в розмітці лишалося порожнє коло */

/* =========================================================
   3. СЕКЦІЇ — ОДНА ЗА ОДНОЮ

   Раніше .profile-grid--settings робив auto-fit і чотири картки
   ставали в ряд. Тепер це просто вертикальний стек: форма →
   форма → форма, як у будь-якому майстрі налаштувань.
   ========================================================= */

/* Шапка секції: заголовок ліворуч, дії праворуч */
.profile-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-card-head--inline {
  align-items: center;
}

.profile-card-lead {
  margin: 0;
  max-width: 80ch;
  color: var(--text-soft);
  font-size: var(--font-size-body);
  line-height: var(--line-height-copy);
}

.profile-card-note {
  color: var(--text-muted);
  font-size: var(--font-size-ui-lg);
  line-height: var(--line-height-relaxed);
}

.profile-card-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.profile-card-toolbar--compact {
  gap: var(--space-2xs);
}

/* Підрозділ усередині секції */

/* =========================================================
   4. ІМʼЯ ТА ВІДОБРАЖЕННЯ
   ========================================================= */
.profile-name-panel {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-name-panel__label {
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-soft);
}

/* Варіанти формату імені — картки-перемикачі, а не злиплі рядки */

.profile-display-mode-option {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

.profile-display-mode-option:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

.profile-display-mode-option.is-selected {
  border-color: var(--border-strong);
  background: var(--accent-soft);
}

.profile-display-mode-option strong {
  font-size: 0.85rem;
  color: var(--text-strong);
}

.profile-display-mode-option small,
.profile-display-mode-option span {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.profile-display-mode-option__radio {
  accent-color: var(--c-accent-500);
}

/* Реальний серверний нік + кнопка копіювання */

.profile-server-nickname {
  display: grid;
  gap: var(--space-2xs);
  min-width: 0;
}

.profile-nickname-preview {
  flex: 1 1 220px;
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--c-accent-200);
  overflow-wrap: anywhere;
}

.profile-nickname-hint {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

/* =========================================================
   5. ПЕРСОНАЖІ
   ========================================================= */
.profile-character-list {
  display: grid;
  gap: var(--space-md);
  min-width: 0;
}

/* Один потік: картки на всю ширину, а не плитка */
.profile-character-list--single-flow {
  grid-template-columns: minmax(0, 1fr);
}

.profile-character-card {
  content-visibility: auto;
  contain-intrinsic-size: auto 360px;

  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-md);
  padding: var(--pad-card-compact);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--c-ink-500);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.profile-character-card.is-main {
  border-left-color: var(--c-accent-400);
}

.profile-character-artwork {
  width: 92px;
  height: 92px;
  flex: 0 0 auto;
  border-radius: var(--radius-md);
  object-fit: cover;
  border: 1px solid var(--border);
  background: var(--surface-raised);
}

.profile-character-artwork__fallback {
  display: grid;
  place-items: center;
  color: var(--c-accent-300);
  font-size: 1.6rem;
  font-weight: var(--font-weight-bold);
}

.profile-character-body {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-character-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-character-title-row--stacked {
  align-items: flex-start;
}

.profile-character-title-copy {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.profile-character-title-copy strong {
  font-size: var(--font-size-base);
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.profile-character-title-copy small,
.profile-character-meta {
  font-size: var(--font-size-ui);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.profile-character-main-corner {
  position: absolute;
  top: var(--space-sm);
  right: var(--space-sm);
}

/* Показники персонажа */
.profile-character-stats-grid,
.profile-character-stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(120px, 100%), 1fr));
  gap: var(--space-xs);
}

.profile-character-stat {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface);
  min-width: 0;
}

.profile-character-stat__icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--c-accent-300);
  font-size: var(--font-size-ui);
}

.profile-character-stat__copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.profile-character-stat__copy strong {
  font-size: 0.85rem;
  color: var(--text-strong);
}

.profile-character-stat__copy small {
  font-size: var(--font-size-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.profile-character-stats-divider {
  height: 1px;
  border: 0;
  background: var(--border-subtle);
}

/* Значки гільдії / статусу */
.profile-character-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.profile-character-badge {
  --tone: var(--c-ink-400);
  display: inline-flex;
  align-items: center;
  gap: var(--space-3xs);
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid color-mix(in srgb, var(--tone) 32%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--tone) 12%, transparent);
  color: var(--tone);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-bold);
  white-space: nowrap;
}

.profile-character-badge--guild {
  --tone: var(--c-success);
}

.profile-character-badge--external {
  --tone: var(--c-warning);
}

.profile-character-badge--main {
  --tone: var(--c-accent-400);
}

/* Дії над персонажем */
.profile-character-actions {
  display: grid;
  gap: var(--space-xs);
}

.profile-character-actions__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: var(--space-xs);
}

.profile-character-actions__row.is-single {
  grid-template-columns: minmax(0, 1fr);
}

.profile-character-actions__full > * {
  width: 100%;
}

/* =========================================================
   6. BATTLE.NET
   ========================================================= */

/* Лічильники «0 гільдійних · 0 інших» — сітка пар, не суцільний рядок */

/* =========================================================
   7. РЕЙДОВІ ЗАПИСИ
   ========================================================= */

/* Порожній стан із дією, а не голий текст */

/* =========================================================
   8. КАНДИДАТИ НА ДОДАВАННЯ
   ========================================================= */
.profile-candidates-box {
  display: grid;
  gap: var(--space-sm);
  padding: var(--pad-card-compact);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.profile-candidate-group,
.profile-character-candidates {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.profile-character-candidate {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface);
  min-width: 0;
}

.profile-character-candidate__avatar {
  width: 34px;
  height: var(--control-height-sm);
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-subtle);
}

.profile-character-candidate__body {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.profile-character-candidate__kind {
  font-size: var(--font-size-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.profile-candidate-bulk-form,
.profile-candidate-bulk-actions {
  display: grid;
  gap: var(--space-sm);
}

.profile-candidate-bulk-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.profile-candidate-counter,
.profile-candidate-expiry {
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

.profile-candidate-toggle-all {
  justify-self: start;
}

.profile-candidate-select {
  display: block;
  min-width: 0;
}

/* =========================================================
   9. АДАПТИВ
   ========================================================= */

@media (max-width: 860px) {

  .profile-character-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-character-artwork {
    width: 64px;
    height: 64px;
  }

  .profile-character-main-corner {
    position: static;
    justify-self: start;
  }

  .profile-card-head {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 520px) {

  .profile-character-actions__row {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* =========================================================
   10. КЕРУВАННЯ ІМЕНЕМ (ProfileNameControls)

   Ці класи не мали правил узагалі, тому:
   - кнопка-галочка розтягувалась у сіру смугу на всю ширину,
   - «Застосувати» ставало велетенським порожнім прямокутником,
   - варіанти формату злипались у «ІмʼяДмитро».

   Компонент спільний для /rules/accept і налаштувань профілю,
   тож правила описані один раз тут.
   ========================================================= */
.profile-name-section {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-name-section__head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-name-section__head > span:not(:where([class$="__icon"])):not(:where([class$="-pill"])) {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.profile-name-status-pill {
  --tone: var(--c-ink-400);
  display: inline-flex;
  align-items: center;
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid color-mix(in srgb, var(--tone) 32%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--tone) 12%, transparent);
  color: var(--tone);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-bold);
  white-space: nowrap;
}

.profile-name-status-pill.is-synced,
.profile-name-status-pill.is-ok {
  --tone: var(--c-success);
}

.profile-name-status-pill.is-missing,
.profile-name-status-pill.is-invalid {
  --tone: var(--c-warning);
}

/* ---------- Поле імені з кнопкою-галочкою ---------- */
.profile-name-edit-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.profile-name-edit-form.is-invalid .input {
  border-color: rgba(224, 112, 95, 0.5);
}

/* Іконкова дія використовує спільну .btn.btn-icon геометрію. */
.profile-icon-action svg {
  width: 18px;
  height: 18px;
}

/* ---------- Збережене імʼя ---------- */
.profile-name-display-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.profile-name-display-row.is-empty {
  border-style: dashed;
}

.profile-name-display-row__value {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.profile-name-display-row__value strong {
  font-size: 0.95rem;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.profile-name-display-row__value small {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

/* ---------- Формат відображення ---------- */
.profile-display-mode-section {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.profile-display-mode-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--space-xs);
  min-width: 0;
}

/* Кожен варіант — окрема форма-кнопка на всю ширину клітинки */
.profile-display-mode-action {
  display: grid;
  min-width: 0;
}

.profile-display-mode-action > .profile-display-mode-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-soft);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.profile-display-mode-action > .profile-display-mode-option:disabled {
  cursor: default;
}

/* Кружечок намальований span-ом, бо це кнопка, а не radio */
.profile-display-mode-option__radio {
  position: relative;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: var(--surface);
}

.profile-display-mode-option.is-selected .profile-display-mode-option__radio {
  border-color: transparent;
  background: var(--accent-gradient);
}

.profile-display-mode-option.is-selected .profile-display-mode-option__radio::after {
  content: "";
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: var(--text-on-accent);
}

/* Пара «назва + приклад» — у стовпчик, інакше «ІмʼяДмитро» */
.profile-display-mode-option > span:not(:where(.profile-display-mode-option__radio)) {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.profile-display-mode-option strong {
  font-size: 0.86rem;
  color: var(--text-strong);
}

.profile-display-mode-option small {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

/* ---------- Discord-нік ---------- */
.profile-discord-standard__head--modern,
.profile-name-section__head--modern {
  align-items: flex-start;
}

.profile-server-nickname {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.profile-server-nickname__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--c-accent-300);
}

.profile-server-nickname__body {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.profile-server-nickname__body small {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.profile-server-nickname__body strong {
  font-size: var(--font-size-body);
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

/* Discord nickname: форма не задає власну геометрію кнопки. */
.profile-discord-nick-form {
  display: inline-grid;
}

.profile-nick-sync-button.is-synced {
  border-color: color-mix(in srgb, var(--c-success) 40%, transparent);
  background: color-mix(in srgb, var(--c-success) 12%, transparent);
  color: var(--c-success);
}

.profile-nick-sync-button svg {
  width: 18px;
  height: 18px;
}

/* ---------- Роль у рейді ---------- */

.profile-nickname-hint code {
  padding: 0 var(--space-3xs);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-lg);
  color: var(--c-accent-200);
}

@media (max-width: 640px) {
  .profile-name-section__head {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .profile-name-section__head > .profile-name-status-pill {
    grid-column: 1 / -1;
    justify-self: start;
  }

  .profile-display-mode-form {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* =========================================================
   11. ПРОФІЛЬ ЯК ОКРЕМА СТОРІНКА, А НЕ ЩЕ ОДНА ПАНЕЛЬ

   Профіль — єдина сторінка про конкретну людину, тож він має
   власний характер: банер із аватаром поверх градієнта,
   показники стрічкою під ним і вкладки замість купи панелей.

   На телефоні банер стає вертикальним, вкладки — горизонтальним
   скролом, а показники лягають у дві колонки. Це свідомо: на
   390px чотири показники в ряд дають по 80px, де не влазить
   ані число, ані підпис.
   ========================================================= */

/* ---------- Банер ---------- */

/* Тонка бурштинова грань згори — підпис «це профіль» */

/* ---------- Стрічка показників ---------- */

/* ---------- Вкладки розділів ---------- */

/* Підкреслення замість заливки: вкладка — це навігація,
   а не дія, тож вона не має конкурувати з кнопками. */

/* ---------- Адаптив банера ---------- */

/* =========================================================
   12. КАРТКА ПЕРСОНАЖА — ВИПРАВЛЕННЯ НАПОВНЕННЯ

   Три помилки, знайдені при звірці розмітки зі стилями:
     - `.profile-character-meta` був лише кольором, тож три
       інлайнові <span> зліплювались: «Guardian • ДруїдТанк»;
     - значки гільдії малювались поверх арту без позиціювання;
     - `.profile-character-stats-row` вкладався у сітку і давав
       випадкову кількість колонок.
   ========================================================= */

/* Метадані — рядок із крапками-роздільниками */
.profile-character-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3xs) var(--space-sm);
  min-width: 0;
}

.profile-character-meta > span {
  position: relative;
  font-size: var(--font-size-ui);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.profile-character-meta > span + span::before {
  content: "·";
  position: absolute;
  left: calc(var(--space-sm) / -2);
  transform: translateX(-50%);
  color: var(--text-faint);
}

/* Арт із накладеним значком гільдії */
.profile-character-artwork {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
}

.profile-character-artwork img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-character-badges--art {
  position: absolute;
  inset: auto var(--space-3xs) var(--space-3xs) var(--space-3xs);
  justify-content: center;
}

.profile-character-badges--art .profile-character-badge {
  padding: 2px var(--space-2xs);
  font-size: 0.6rem;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.profile-character-main-corner {
  position: absolute;
  top: var(--space-3xs);
  right: var(--space-3xs);
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent-gradient);
  color: var(--text-on-accent);
}

/* Показники: два рядки по дві пари з роздільником між ними */
.profile-character-stats-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2xs);
}

.profile-character-stats-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

/* Пара всередині рядка більше не має власної рамки */
.profile-character-stats-row .profile-character-stat {
  padding: 0;
  border: 0;
  background: none;
}

.profile-character-stats-divider {
  width: 1px;
  height: 22px;
  background: var(--border-subtle);
}

/* Дія «Зробити мейном» на всю ширину — вона головна в картці */
.profile-character-actions__full {
  display: grid;
}

.profile-character-actions__full > .btn {
  width: 100%;
}

@media (max-width: 520px) {
  /* На вузькому екрані пари показників стають одна під одною:
     чотири значення в два стовпці лишали по 60px на число. */
  .profile-character-stats-row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2xs);
  }

  .profile-character-stats-divider {
    width: 100%;
    height: 1px;
  }
}

/* =========================================================
   13. БІЧНА КОЛОНКА — ПОКРАЩЕНА ВЕРСІЯ СТАРОЇ СХЕМИ

   Повернуто двоколонкову схему, але з трьома змінами проти
   першої версії:
     - короткий стан (персонажі, мейн, роль) прямо в колонці,
       щоб не бігти по число в основний потік;
     - активний пункт навігації видно;
     - на телефоні колонка стає горизонтальною смугою, а не
       високим блоком, який відсовував увесь вміст униз.
   ========================================================= */

/* Активний пункт навігації */

/* ---------- Мобільна поведінка колонки ---------- */

/* =========================================================
   14. ПРОФІЛЬ ЗА ЗРАЗКОМ РЕФЕРЕНСУ

   Схема з надісланих скріншотів, перекладена на наші токени:

   ПК     — картка-колонка ліворуч (аватар у кільці, імʼя, пігулки,
            вертикальна навігація з іконками, вихід унизу) і
            основний потік праворуч: заголовок, ряд карток-показників,
            далі панелі.

   Телефон — та сама картка згори, але навігація стає смугою САМИХ
            ІКОНОК: сім підписів у рядок не влазять, а перенесення в
            три ряди з'їдало перший екран. Активна іконка підсвічена,
            підпис лишається в `title` та для скрінрідерів.
   ========================================================= */

/* ---------- Картка-колонка ---------- */

/* Верх картки — окремий блок із роздільником, як у зразку */

/* Аватар у кольоровому кільці */

/* ---------- Навігація ---------- */

/* ---------- Картки показників в основному потоці ---------- */

/* Підпис угорі, значення крупно під ним — порядок із зразка */

/* Тонований варіант картки: рамка й фон у колір стану */

/* ---------- Телефон і планшет ---------- */

/* =========================================================
   14. ШАБЛОН ПРОФІЛЮ ЗА ЗРАЗКОМ

   Схема з референсу, перекладена на наші токени:
     - бічна картка: аватар, імʼя, пігулки, вертикальна навігація,
       вихід окремо внизу;
     - на телефоні навігація стискається в СМУГУ САМИХ ІКОНОК,
       а не в стовпчик кнопок із підписами — так вона займає
       один рядок замість половини екрана;
     - показники: плитка іконки + дрібний підпис + велике значення;
     - панелі: шапка з іконкою та рискою, всередині рядки
       «опис ліворуч — дія праворуч».
   ========================================================= */

/* ---------- Бічна картка ---------- */

/* ---------- Вертикальна навігація ---------- */

/* Активний пункт: заливка + бурштинова риска зліва, як у зразку */

/* ---------- Показники ---------- */

/* Підпис дрібний згори, значення велике знизу — порядок із зразка */

/* Тонований варіант: рамка й іконка беруть колір стану */

/* ---------- Шапка панелі з іконкою ---------- */
.profile-card-head {
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
}

/* ---------- Рядок «опис + дія» ---------- */

/* =========================================================
   15. МОБІЛЬНА СХЕМА ЗА ЗРАЗКОМ
   ========================================================= */

/* =========================================================
   16. КАРТКА ПЕРСОНАЖА ЗА ЗРАЗКОМ

   У референсі це вертикальна картка-портрет: арт зверху на всю
   ширину, під ним імʼя, гільдія, рівень і регіон, а внизу два
   показники поруч через роздільник.

   Горизонтальний варіант (арт ліворуч) лишався читабельним, але
   різав арт до 92px — а саме арт тут головний носій впізнавання.
   ========================================================= */
.profile-character-list--single-flow {
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: var(--space-md);
}

.profile-character-card {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 0;
  overflow: hidden;
  border-left-width: 1px;
  background: var(--surface);
}

.profile-character-card.is-main {
  border-color: var(--border-strong);
  box-shadow: 0 0 0 1px var(--accent-soft);
}

/* Арт-банер */
.profile-character-artwork {
  width: 100%;
  height: 240px;
  border-radius: 0;
  border: 0;
  border-bottom: 1px solid var(--border-subtle);
  background:
    radial-gradient(80% 70% at 50% 20%, var(--accent-soft), transparent 70%),
    var(--surface-sunken);
}

.profile-character-artwork__fallback {
  font-size: 3rem;
}

/* Ромб-роздільник між артом і текстом, як у зразку */
.profile-character-body {
  position: relative;
  gap: var(--space-sm);
  padding: var(--space-md);
}

.profile-character-body::before {
  content: "";
  position: absolute;
  top: -5px;
  left: 50%;
  width: 9px;
  height: 9px;
  transform: translateX(-50%) rotate(45deg);
  background: var(--c-accent-400);
}

.profile-character-title-copy h3 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.15rem;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

/* Гільдія курсивом і приглушено — це підпис, а не заголовок */
.profile-character-title-copy p {
  margin: 0;
  color: var(--c-accent-300);
  font-size: var(--font-size-body-sm);
  font-style: italic;
}

.is-other .profile-character-title-copy p {
  color: var(--text-faint);
}

/* Два показники поруч із вертикальною рискою */
.profile-character-stats-row {
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  padding: var(--space-sm) 0 0;
  border: 0;
  border-top: 1px solid var(--border-subtle);
  border-radius: 0;
  background: none;
}

.profile-character-stat {
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
  text-align: center;
  gap: var(--space-3xs);
}

.profile-character-stat__icon {
  display: none;
}

.profile-character-stat__copy {
  justify-items: center;
}

.profile-character-stat__copy strong {
  font-family: var(--font-display);
  font-size: 1.25rem;
  color: var(--text-strong);
}

.profile-character-stat__copy small {
  font-size: 0.62rem;
  letter-spacing: 0.14em;
}

.profile-character-stats-divider {
  height: var(--control-height-sm);
}

/* Дії притиснуті до низу картки */
.profile-character-actions {
  margin-top: auto;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
}

@media (max-width: 520px) {
  .profile-character-artwork {
    height: 200px;
  }

  /* Показники лишаються поруч навіть на вузькому екрані:
     їх лише два, і так вони читаються як пара. */
  .profile-character-stats-row {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  }

  .profile-character-stats-divider {
    width: 1px;
    height: var(--control-height-sm);
  }
}

/* =========================================================
   17. ІКОНКИ ПРОФІЛЮ

   ProfileUiIcon рендерить порожній <span class="profile-ui-icon
   profile-ui-icon--{kind}"> і розраховує, що гліф домалює CSS.
   Правил не було зовсім, тож суфіксні патерни робили з нього
   сірий кружечок — саме ті «зайві елементи» в кнопках
   «Зробити мейном», «Видалити» та «Raider.IO».

   Малюємо маскою: колір береться з currentColor, тож іконка
   збігається з текстом кнопки й не потребує окремих файлів.
   ========================================================= */

/* =========================================================
   18. СМУГА ЛІЧИЛЬНИКІВ ПЕРСОНАЖІВ

   У розмітці це .profile-card-toolbar--compact із парами
   <strong>+<small>. Тулбар був лише flex-рядком, тож пари
   зліплювались у «3Гільдійні 0Інші 0Можна додати».
   ========================================================= */
.profile-card-toolbar--compact {
  gap: var(--space-xs);
}

.profile-card-toolbar--compact > span {
  display: grid;
  gap: 1px;
  padding: var(--space-2xs) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.profile-card-toolbar--compact > span > strong {
  font-size: var(--font-size-base);
  color: var(--text-strong);
}

.profile-card-toolbar--compact > span > small {
  font-size: 0.64rem;
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  white-space: nowrap;
}

@media (max-width: 860px) {
  .profile-card-toolbar--compact {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* =========================================================
   18. КОМПАКТНА СІТКА КАРТОК ПЕРСОНАЖІВ

   Картка має стабільну робочу ширину й не розтягується до
   половини/всієї сторінки, коли персонажів лише один або два.
   ========================================================= */
.profile-character-list--single-flow {
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 360px));
  justify-content: start;
  align-items: stretch;
}

.profile-character-card {
  width: 100%;
  max-width: 360px;
}

@media (max-width: 520px) {
  .profile-character-list--single-flow {
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-character-card {
    max-width: none;
  }
}


/* =========================================================
   19. PROFILE UI NORMALIZATION — v3.8.19

   Один набір локальних profile-токенів керує ритмом профілю на
   телефоні. Desktop-каркас інших сторінок не зачіпається.
   Рейдові картки нижче навмисно оновлені і для desktop, і для mobile.
   ========================================================= */

/* ---------- Рейдові записи: новий desktop + mobile card pattern ---------- */

.profile-card-head--raids {
  align-items: center;
}

.profile-count-pill--raid-count {
  min-width: 34px;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}

.profile-card-lead--raids {
  max-width: 760px;
  margin: 0;
}

/* ---------- Mobile profile normalization ---------- */
@media (max-width: 760px) {

  .profile-character-list {
    gap: var(--section-gap);
  }

  /* Compact identity card: avatar remains beside the name even on phones. */

  /* Four overview cards no longer form a long single-column tower. */

  .profile-card-head {
    gap: var(--space-xs);
    padding-bottom: 10px;
  }

  .profile-card-lead {
    font-size: 0.79rem;
    line-height: var(--line-height-body);
  }

  .profile-card-toolbar--compact {
    gap: 7px;
  }

  .profile-card-toolbar--compact > span {
    padding: 8px 9px;
  }

  .profile-card-toolbar--compact > span > strong {
    font-size: 0.92rem;
  }

  .profile-card-toolbar--compact > span > small {
    font-size: 0.56rem;
  }

  /* Character cards remain portrait-style, but consume much less height. */
  .profile-character-list--single-flow {
    gap: 10px;
  }

  .profile-character-card {
    border-radius: var(--card-radius);
  }

  .profile-character-artwork {
    height: 172px;
  }

  .profile-character-body {
    gap: 10px;
    padding: 12px;
  }

  .profile-character-title-copy h3 {
    font-size: 1.05rem;
  }

  .profile-character-title-copy p,
  .profile-character-meta {
    font-size: 0.74rem;
  }

  .profile-character-stats-row {
    padding-top: 9px;
  }

  .profile-character-stat__copy strong {
    font-size: 1.08rem;
  }

  .profile-character-stat__copy small {
    font-size: 0.56rem;
  }

  .profile-character-actions {
    gap: var(--space-xs);
    padding-top: 10px;
  }

  .profile-character-actions__row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-xs);
  }

  .profile-character-actions__row.is-single {
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-character-actions__row > *,
  .profile-character-actions__row form,
  .profile-character-actions__row .profile-character-action {
    width: 100%;
    min-width: 0;
  }

  .profile-character-action {
    justify-content: center;
    min-height: var(--control-height);
  }

  /* Raid cards switch from desktop split layout to compact mobile stack. */
  .profile-card-head--raids {
    flex-direction: row;
    align-items: center;
  }

  .profile-card-head--raids > div {
    min-width: 0;
  }

  .profile-card-lead--raids {
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-subtle);
  }
}

@media (max-width: 430px) {

  .profile-character-artwork {
    height: 156px;
  }
}


/* =========================================================
   20. PROFILE MOBILE POLISH — v3.8.20

   Тільки вузькі екрани. Desktop-профіль і desktop інших сторінок
   залишаються без змін. Виправляє видимість локального меню профілю,
   компоновку картки персонажа й положення guild/other badge.
   ========================================================= */
.profile-character-mobile-badge {
  display: none;
}

@media (max-width: 760px) {
  /* Меню профілю завжди видиме: 2x2, іконка + підпис. Раніше підпис
     ховався через clip-path, тому на темній темі меню виглядало порожнім. */

  /* Персонаж: менше порожнього арту, чітка шапка і badge праворуч
     від імені/realm, а не поверх зображення. */
  .profile-character-card {
    overflow: hidden;
  }

  .profile-character-artwork {
    height: 148px;
  }

  .profile-character-badges--art {
    display: none;
  }

  .profile-character-body {
    gap: 9px;
    padding: 11px 12px 12px;
  }

  .profile-character-title-row--stacked {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-xs);
  }

  .profile-character-title-copy {
    min-width: 0;
  }

  .profile-character-title-copy h3 {
    overflow: hidden;
    font-size: var(--font-size-base);
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-character-title-copy p {
    overflow: hidden;
    margin-top: 2px;
    font-size: var(--font-size-caption);
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-character-mobile-badge {
    display: inline-flex;
    align-self: start;
    justify-self: end;
    max-width: 112px;
    min-height: 26px;
    padding: 3px 8px;
    font-size: 0.62rem;
    line-height: 1.2;
  }

  .profile-character-mobile-badge > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-character-meta {
    gap: 4px 10px;
    padding-bottom: 1px;
    font-size: var(--font-size-caption);
    line-height: var(--line-height-tight);
  }

  .profile-character-meta > span {
    font-size: var(--font-size-caption);
  }

  .profile-character-stats-grid {
    gap: 0;
  }

  .profile-character-stats-row {
    padding-top: 8px;
  }

  .profile-character-stat__copy strong {
    font-size: var(--font-size-base);
  }

  .profile-character-stats-divider {
    height: 30px;
  }

  .profile-character-actions {
    gap: 7px;
    padding-top: 9px;
  }

  .profile-character-action {
    min-height: 40px;
    padding-inline: 9px;
    font-size: 0.74rem;
  }
}

@media (max-width: 420px) {

  .profile-character-artwork {
    height: 136px;
  }

  .profile-character-mobile-badge {
    max-width: 102px;
    padding-inline: 7px;
  }
}

/* R6.1: explicit profile/name workflow, using the established palette. */
.profile-identity-workflow { display: grid; gap: var(--space-sm); min-width: 0; }
.profile-identity-form { display: flex; flex-wrap: wrap; gap: var(--space-sm); min-width: 0; }
.profile-identity-form input { flex: 1 1 12rem; width: 100%; min-width: 0; }
.profile-identity-form .btn { white-space: normal; height: auto; }
.profile-identity-sync, .profile-identity-conflict { min-width: 0; overflow-wrap: anywhere; }
.profile-identity-sync p, .profile-identity-conflict p { margin: 0 0 var(--space-sm); }
.profile-identity-conflict { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-sm); background: var(--surface-panel); }
.profile-identity-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
.profile-identity-workflow .profile-nickname-preview { display: grid; gap: var(--space-xs); min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) { .profile-identity-form .btn { width: 100%; } }

/* R6.2: explicit character setup, using the shared amber palette. */
.profile-character-setup {
  margin-top: 24px;
  padding: clamp(14px, 2vw, 24px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}
.profile-character-setup form { display: grid; gap: 18px; }
.profile-character-setup > .profile-card-head { display: block; }
.profile-character-setup__choices { min-width: 0; margin: 0; padding: 0; border: 0; display: grid; gap: 12px; }
.profile-character-setup__choices legend { padding: 0 0 12px; font-weight: 700; color: var(--text-strong); }
.profile-character-setup__selection, .profile-character-setup__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.profile-character-setup__selection { justify-content: space-between; color: var(--text-soft); }
.profile-character-setup__list { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.profile-character-setup__candidate { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); cursor: pointer; }
.profile-character-setup__candidate:has(input:checked), .profile-character-setup__roles label:has(input:checked) { border-color: var(--c-accent-400); background: var(--accent-soft); }
.profile-character-setup__candidate > span:nth-child(2) { display: grid; gap: 4px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.profile-character-setup__candidate small, .profile-character-setup__badge { color: var(--text-muted); font-size: 12px; }
.profile-character-setup input[type="checkbox"], .profile-character-setup input[type="radio"] { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--c-accent-400); }
.profile-character-setup__main { display: grid; gap: 8px; color: var(--text-soft); }
.profile-character-setup__main select { width: 100%; min-width: 0; padding: 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-raised); color: var(--text-strong); font: inherit; }
.profile-character-setup__roles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.profile-character-setup__roles label { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px; cursor: pointer; min-width: 0; }
.profile-character-setup__roles span { overflow-wrap: anywhere; }
.profile-character-setup__summary { display: flex; flex-wrap: wrap; gap: 10px 24px; padding: 14px; border-radius: var(--radius-md); background: var(--accent-soft); color: var(--text-soft); overflow-wrap: anywhere; }
.profile-character-setup__status { color: var(--text-soft); overflow-wrap: anywhere; }
.profile-character-setup :is(input, select, button):focus-visible { outline: 2px solid var(--c-accent-400); outline-offset: 3px; }
.profile-character-setup__actions .btn { white-space: normal; text-align: center; }
@media (max-width: 640px) {
  .profile-character-setup__roles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .profile-character-setup__roles label:first-child { grid-column: 1 / -1; }
  .profile-character-setup__candidate { display: grid; grid-template-columns: 18px minmax(0, 1fr); }
  .profile-character-setup__badge { grid-column: 2; }
  .profile-character-setup__actions > .btn { width: 100%; }
}

/* Final responsive exception after the consolidated profile-card rules.
   Keep touch layouts compact even when desktop styles above are extended. */
```

## src/app/styles/tokens.css

```css
/* =========================================================
   ДИЗАЙН-ТОКЕНИ — Mistblossom Vanguard

   Збережена тепла нічна палітра й бурштиновий акцент, але файл
   очищено від legacy aliases: тут лишаються лише токени, які
   реально споживає поточний dashboard.
   ========================================================= */

:root {
  /* ---------- Основа: тепла нічна база ---------- */
  --c-base-900: #0c0a07; /* найглибший фон, підвал */
  --c-base-850: #100d0a;
  --c-base-700: #1a1511; /* підняті поверхні */
  --c-base-500: #2c231b; /* ховер, активні поверхні */
  --c-base-400: #3a2e24; /* межі, розділювачі */

  /* ---------- Акцент: бурштин ---------- */
  --c-accent-100: #ffe6cd;
  --c-accent-200: #ffc890;
  --c-accent-300: #ffb26a;
  --c-accent-400: #ff9b55;
  --c-accent-500: #ff7a2f;
  --c-accent-600: #d86324;

  /* ---------- Текст ---------- */
  --c-ink-100: #fff6ec;
  --c-ink-200: #e6e1d8;
  --c-ink-300: #b8ada0;
  --c-ink-400: #9c948a;
  --c-ink-500: #756b5e;

  /* ---------- Статуси, зведені до теплої бази ---------- */
  --c-success: #7cc48f;
  --c-info: #79a6d8;
  --c-warning: #e8b34a;
  --c-danger: #e0705f;

  /* ---------- Ролі WoW ---------- */
  --c-role-tank: #79a6d8;
  --c-role-healer: #7cc48f;
  --c-role-dps: #e0705f;

  /* ---------- Складності рейду ---------- */
  --c-diff-mythic: #c08adf;
  --c-diff-heroic: #79a6d8;
  --c-diff-normal: #7cc48f;

  /* ---------- Точки зламу ----------
     CSS не дозволяє var() у @media, тому це довідка, а не токени.
     Уся адаптивність сайту зведена до чотирьох ширин:

       1000px — бічна колонка йде під контент (page-layout, side-stack)
        860px — багатоколонкові сітки стають одноколонковими
        640px — таблиці й рядки перебудовуються в картки
        520px — телефон: дії на всю ширину, компактна типографіка

     Desktop workspace починається з 1001px; мобільна навігація
     має окремий компактний режим до 1000px. */

  /* ---------- Текст на кольорових підкладках ----------
     Ці значення повторювались по 3–15 разів у кожному доменному
     файлі. Тепер вони мають імена, і зміна відтінку статусу — одна
     правка тут, а не пошук по 15 стилях. */
  --text-on-accent: #1c1208;
  --text-on-warning: #f4d79a;
  --text-on-danger: #ffbdb1;
  --text-on-success: #b6e2c3;

  /* ---------- Підкладки статусів ----------
     Однакові трійки «межа / фон / м'який фон» для сповіщень,
     чипів і карток. Раніше кожен файл писав свою rgba(). */
  --tint-warning-border: rgba(232, 179, 74, 0.28);
  --tint-warning-bg: rgba(232, 179, 74, 0.08);
  --tint-danger-border: rgba(224, 112, 95, 0.28);
  --tint-danger-bg: rgba(224, 112, 95, 0.08);
  --tint-success-border: rgba(124, 196, 143, 0.28);
  --tint-success-bg: rgba(124, 196, 143, 0.08);

  /* ---------- Брендовий колір інтеграції ---------- */
  --c-discord: #5865f2;

  /* =======================================================
     СЕМАНТИЧНИЙ ШАР — ним і треба користуватися у стилях
     ======================================================= */

  --surface: rgba(34, 27, 21, 0.72);
  --surface-raised: rgba(44, 35, 27, 0.85);
  --surface-hover: rgba(255, 155, 85, 0.06);
  --surface-sunken: rgba(12, 10, 7, 0.55);
  --surface-panel: var(--surface);

  --border-subtle: rgba(255, 226, 196, 0.08);
  --border: rgba(255, 226, 196, 0.13);
  --border-strong: rgba(255, 178, 106, 0.28);

  --text-strong: var(--c-ink-100);
  --text-body: var(--c-ink-200);
  --text-soft: var(--c-ink-300);
  --text-muted: var(--c-ink-400);
  --text-faint: var(--c-ink-500);
  /* compatibility aliases for older isolated modules */
  --text: var(--text-body);

  --accent-soft: rgba(255, 155, 85, 0.12);
  --accent-ring: rgba(255, 155, 85, 0.35);
  --accent-gradient: linear-gradient(135deg, var(--c-accent-300), var(--c-accent-600));

  /* ---------- Тіні ---------- */
  --shadow-sm: 0 8px 20px -14px rgba(0, 0, 0, 0.7);
  --shadow-md: 0 12px 28px -14px rgba(0, 0, 0, 0.75);
  --shadow-lg: 0 24px 50px -24px rgba(0, 0, 0, 0.9);

  /* ---------- Типографічна шкала ----------
     Значення відповідають найчастішим поточним розмірам. Винесення
     у токени не змінює геометрію, але прибирає локальне розходження. */
  --font-size-2xs: 0.66rem;
  --font-size-xs: 0.68rem;
  --font-size-caption: 0.7rem;
  --font-size-sm: 0.72rem;
  --font-size-meta: 0.76rem;
  --font-size-ui: 0.78rem;
  --font-size-ui-lg: 0.8rem;
  --font-size-body-sm: 0.82rem;
  --font-size-body: 0.9rem;
  --font-size-base: 1rem;

  --font-weight-ui: 500;
  --font-weight-medium: 600;
  --font-weight-semibold: 650;
  --font-weight-bold: 700;
  --font-weight-display: 750;
  --font-weight-heavy: 800;

  --line-height-tight: 1.35;
  --line-height-compact: 1.45;
  --line-height-body: 1.5;
  --line-height-relaxed: 1.55;
  --line-height-copy: 1.6;

  /* ---------- Відступи: шкала з кроком 4px ---------- */
  --space-3xs: 2px;
  --space-2xs: 4px;
  --space-xs: 8px;
  --space-sm: 12px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-3xl: 64px;

  /* ---------- Ритм сторінки ---------- */
  --gap-stack: var(--space-md);
  --gap-grid: var(--space-lg);
  --gap-section: var(--gap-grid);
  --pad-card: var(--space-lg);
  --pad-card-compact: var(--space-md);
  --pad-section: clamp(var(--space-xl), 5vw, var(--space-3xl));
  --pad-page-inline: clamp(var(--space-md), 4vw, var(--space-xl));

  /* ---------- Радіуси ---------- */
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-pill: 999px;
  --control-radius: 10px;

  /* ---------- Рух ---------- */
  --dur-instant: 0.12s;
  --dur-fast: 0.2s;
  --dur-base: 0.3s;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  /* ---------- Шрифти та z-index ----------
     Без зовнішнього font fetch: основний UI використовує нативний системний
     sans-stack, брендові заголовки — стабільний serif fallback. */
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-display: var(--font-guild-heading), Georgia, "Times New Roman", serif;
  --font-brand: var(--font-guild-display), "Palatino Linotype", Georgia, serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

  --z-dropdown: 1000;
  --z-navbar: 9999;
  --z-toast: 10500;

  /* ---------- Фон сторінки ---------- */
  --site-bg-0: var(--c-base-900);
  --site-bg-1: var(--c-base-850);
  --site-bg-2: var(--c-base-700);

  /* =======================================================
     ГЕОМЕТРІЯ НАВІГАЦІЇ ДАШБОРДУ
     Мобільна навігація використовує власну компактну шапку.
     Desktop geometry живе у desktop.css/nav.css.
     ======================================================= */
  /* Геометрія мобільної навігації */
  --nav-h: 54px;
  --nav-inset: 16px;
  --nav-space: calc(var(--nav-h) + var(--nav-inset) * 2);

  --nav-surface: rgba(26, 21, 17, 0.82);
  --nav-surface-solid: rgba(18, 15, 12, 0.95);
  --nav-panel: rgba(20, 16, 13, 0.97);
  --nav-line: var(--border);
  --nav-shadow: var(--shadow-lg), 0 2px 12px rgba(0, 0, 0, 0.35);

  /* ---------- Ширина контенту ---------- */
  --page-max: 1520px;
  --page-gutter: clamp(16px, 2vw, 28px);
  --page-gap: 20px;
  --section-gap: 16px;
  --card-radius: var(--radius-md);
  --panel-padding: 20px;
  --control-height: 42px;
  --control-height-sm: 34px;
  --control-pad-x: 16px;

  /* ---------- Короткий alias для фокусу/форм ---------- */
  --orange-main: var(--c-accent-400);

  /* Universal page foundation: approved semantic geometry and states. */
  --heading-page-size: clamp(1.6rem, 2.8vw, 2.25rem);
  --heading-section-size: clamp(1.15rem, 2vw, 1.45rem);
  --heading-card-size: 1rem;
  --stroke-width: 1px;
  --focus-width: 2px;
  --focus-offset: 3px;
  --management-sidebar-width: 232px;
  --data-grid-min: 16rem;
  --toolbar-search-min: 14rem;
  --dropdown-min: 13rem;
  --data-card-min-height: 12rem;
  --skeleton-card-height: var(--data-card-min-height);
  --skeleton-line-height: 1rem;
  --skeleton-row-height: 4rem;
  --skeleton-duration: 1.2s;
  --opacity-disabled: 0.5;
  --opacity-skeleton-low: 0.45;
  --opacity-skeleton-high: 0.8;
  --tint-info-bg: rgba(121, 166, 216, 0.08);
  --tint-info-border: rgba(121, 166, 216, 0.28);
}
```

## src/components/AccessGroupsManager.tsx

```tsx
"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import AccessGroupList from "@/components/access-groups/AccessGroupList";
import AccessGroupFields from "@/components/access-groups/AccessGroupFields";
import AccessGroupPermissions from "@/components/access-groups/AccessGroupPermissions";
import { roleLabel, groupIcon } from "@/components/access-groups/groupLabels";
import DropdownMenu from "@/components/ui/DropdownMenu";
import styles from "@/components/access-groups/groups.module.css";
import { DASHBOARD_PERMISSION_KEYS, DEFAULT_ADMIN_GROUP_ID, DEFAULT_MEMBER_GROUP_ID, DEFAULT_MODERATOR_GROUP_ID, FIXED_GROUP_IDS, PERMISSION_META, type AccessGroup } from "@/lib/accessGroupSchema";
import { draftDirty, groupDraftKey, groupValues, makeGroupDraft, NEW_GROUP_DRAFT, parseGroupDrafts, reconcileGroupDrafts, sameGroupValues, updateGroupDraft, type GroupDraft, type GroupValues } from "@/lib/accessGroupDrafts";
import { claimGroupDraftBucket } from "@/lib/accessGroupDraftStorage";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/hooks/useDashboardRequests";
import { useActionFocus } from "@/hooks/useActionFocus";

type Props = {
  groups: AccessGroup[];
  draftScope: string;
  isServerOwner: boolean;
  currentGroupId?: string;
  saveGroupAction: (formData: FormData) => Promise<void>;
  deleteGroupAction: (formData: FormData) => Promise<void>;
  impersonateAction: (formData: FormData) => Promise<void>;
};
function cannotEditReason(
  group: AccessGroup,
  currentGroupId: string | undefined,
  owner: boolean,
) {
  if (owner) return "";
  if (group.id === currentGroupId)
    return "Це твоя поточна група. Самому собі права не змінюємо.";
  return group.id === DEFAULT_ADMIN_GROUP_ID ||
    group.role === "admin" ||
    group.rank >= 100 ||
    group.permissions.includes("groups.manage")
    ? "Адмінські групи та право керування групами змінює тільки власник Discord-сервера."
    : "";
}
function diffRows(server: GroupValues, draft: GroupValues) {
  const labels = {
    id: "ID",
    name: "Назва",
    role: "Роль",
    rank: "Ранг",
    icon: "Іконка",
    discordRoleId: "Discord role ID",
  };
  const rows = Object.entries(labels)
    .filter(
      ([key]) =>
        server[key as keyof typeof labels] !==
        draft[key as keyof typeof labels],
    )
    .map(([key, label]) => [
      label,
      String(server[key as keyof typeof labels]) || "—",
      String(draft[key as keyof typeof labels]) || "—",
    ]);
  for (const key of DASHBOARD_PERMISSION_KEYS)
    if (server.permissions.includes(key) !== draft.permissions.includes(key))
      rows.push([
        PERMISSION_META[key].title,
        server.permissions.includes(key) ? "Є право" : "Немає права",
        draft.permissions.includes(key) ? "Є право" : "Немає права",
      ]);
  return rows;
}
function migrationSummary(group?: AccessGroup) {
  const migration = group?.assignmentMigration;
  return migration ? ` Призначення профілів перенесено: ${migration.profiles}. ID ${migration.fromId} → ${migration.toId}. Старий ID зарезервовано.` : "";
}
export default function AccessGroupsManager({
  groups: initialGroups,
  draftScope,
  isServerOwner,
  currentGroupId,
  saveGroupAction,
  deleteGroupAction,
  impersonateAction,
}: Props) {
  const [groups, setGroups] = useState(initialGroups);
  const [drafts, setDrafts] = useState(new Map<string, GroupDraft>());
  const draftsRef = useRef(drafts);
  const [expanded, setExpanded] = useState(
    initialGroups[0] ? groupDraftKey(initialGroups[0].id) : NEW_GROUP_DRAFT,
  );
  const expandedRef = useRef(expanded);
  const [ready, setReady] = useState(false),
    [query, setQuery] = useState(""),
    [visibleCount, setVisibleCount] = useState(10);
  const [notice, setNotice] = useState(""),
    [storageWarning, setStorageWarning] = useState("");
  const [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const [externalDrafts, setExternalDrafts] = useState(
    new Map<string, GroupDraft>(),
  );
  const storageKey = useRef<string | null>(null);
  const requests = useDashboardRequests();
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLDivElement>(busy || refreshing);
  const categories = useMemo(
    () => [
      ...new Set(
        DASHBOARD_PERMISSION_KEYS.map((key) => PERMISSION_META[key].category),
      ),
    ],
    [],
  );
  const group = groups.find((item) => groupDraftKey(item.id) === expanded),
    draft = drafts.get(expanded);
  const values = draft?.values || groupValues(group),
    dirty = Boolean(draft && draftDirty(draft));
  const reason = group
    ? cannotEditReason(group, currentGroupId, isServerOwner)
    : "";
  const orphan = expanded !== NEW_GROUP_DRAFT && !group;
  const conflict = Boolean(
    draft &&
    expanded !== NEW_GROUP_DRAFT &&
    (!group || draft.baseRevision !== group.revision),
  );
  const blocked = !ready || busy || Boolean(reason) || orphan;
  const canDelete = Boolean(
    group && !group.protectedGroup && !FIXED_GROUP_IDS.has(group.id) && !reason,
  );
  const fixedRole = Boolean(group && FIXED_GROUP_IDS.has(group.id));
  const fixedRank = Boolean(
    group &&
    [
      DEFAULT_ADMIN_GROUP_ID,
      DEFAULT_MODERATOR_GROUP_ID,
      DEFAULT_MEMBER_GROUP_ID,
    ].includes(group.id),
  );
  const searchIndex = useMemo(() => groups.map(item => ({
    item,
    text: `${item.name} ${item.id} ${roleLabel(item.role)} ${item.discordRoleIds.join(" ")}`.toLocaleLowerCase("uk-UA"),
  })), [groups]);
  const normalizedQuery = query.trim().toLocaleLowerCase("uk-UA");
  const filteredGroups = useMemo(() => searchIndex.filter(entry => entry.text.includes(normalizedQuery)).map(entry => entry.item), [searchIndex, normalizedQuery]);
  function persist(next = draftsRef.current) {
    if (!storageKey.current) return;
    try {
      const raw = JSON.stringify({
        version: 1,
        expanded: expandedRef.current,
        drafts: [...next.values()],
      });
      if (raw.length > 131072 || next.size > 100)
        throw new Error("Забагато чернеток");
      localStorage.setItem(storageKey.current, raw);
    } catch {
      setStorageWarning(
        "Браузер не зберіг чернетки. Вони доступні до закриття сторінки; збережи потрібні зміни явно.",
      );
    }
  }
  function replaceDrafts(next: Map<string, GroupDraft>) {
    draftsRef.current = next;
    setDrafts(next);
    persist(next);
  }
  function select(key: string) {
    expandedRef.current = key;
    setExpanded(key);
    persist();
  }
  function edit(patch: Partial<GroupValues>) {
    if (blocked) return;
    const changed = updateGroupDraft(
        draftsRef.current.get(expanded) || makeGroupDraft(group),
        patch,
      ),
      next = new Map(draftsRef.current);
    if (draftDirty(changed) || changed.pending) next.set(expanded, changed);
    else next.delete(expanded);
    replaceDrafts(next);
  }
  function resetDraft() {
    if (dirty && !window.confirm("Скинути незбережені зміни цієї групи?"))
      return;
    const next = new Map(draftsRef.current);
    next.delete(expanded);
    replaceDrafts(next);
    if (orphan)
      select(groups[0] ? groupDraftKey(groups[0].id) : NEW_GROUP_DRAFT);
    setNotice("Чернетку скинуто. Показано актуальні дані.");
  }
  function applyCatalog(fresh: AccessGroup[]) {
    const old = draftsRef.current.get(expandedRef.current),
      next = reconcileGroupDrafts(draftsRef.current, fresh);
    replaceDrafts(next);
    setGroups(fresh);
    const confirmed =
      old?.pending &&
      fresh.find(
        (item) =>
          item.id === old.pending!.targetId &&
          item.lastMutationId === old.pending!.mutationId,
      );
    if (confirmed) {
      select(groupDraftKey(confirmed.id));
      setNotice(
        "Збереження підтверджено. Подальші зміни залишаються в чернетці." + migrationSummary(confirmed),
      );
    }
    return confirmed || null;
  }
  useEffect(() => {
    let active = true,
      closeBucket: (() => void) | undefined;
    requests.cancel("catalog");
    requests.cancel("mutation");
    setBusy(false);
    setRefreshing(false);
    storageKey.current = null;
    draftsRef.current = new Map();
    setDrafts(new Map());
    setExternalDrafts(new Map());
    setGroups(initialGroups);
    setReady(false);
    setStorageWarning("");
    const firstKey = initialGroups[0]
      ? groupDraftKey(initialGroups[0].id)
      : NEW_GROUP_DRAFT;
    expandedRef.current = firstKey;
    setExpanded(firstKey);
    const prefix = `mistblossom:group-drafts:v1:${draftScope}:`,
      buckets = new Map<string, Map<string, GroupDraft>>();
    const mergedExternal = () => {
      const merged = new Map<string, GroupDraft>();
      for (const bucket of buckets.values())
        for (const [id, candidate] of bucket)
          if (
            !merged.has(id) ||
            merged.get(id)!.updatedAt < candidate.updatedAt
          )
            merged.set(id, candidate);
      return merged;
    };
    const load = async () => {
      try {
        const bucket = await claimGroupDraftBucket(prefix);
        closeBucket = bucket.close;
        if (!active) {
          bucket.close();
          return;
        }
        storageKey.current = bucket.key;
        const ownRaw = localStorage.getItem(bucket.restoreKey),
          own = parseGroupDrafts(ownRaw);
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (!key?.startsWith(prefix) || key === bucket.key) continue;
          buckets.set(key, parseGroupDrafts(localStorage.getItem(key)).drafts);
        }
        const all = mergedExternal(),
          restored = reconcileGroupDrafts(
            ownRaw !== null ? own.drafts : all,
            initialGroups,
          );
        draftsRef.current = restored;
        setDrafts(restored);
        setExternalDrafts(all);
        if (restored.size)
          setNotice(
            `Відновлено чернетки: ${restored.size}. Права ще не змінено.`,
          );
        else if (own.drafts.size) {
          const recovered = [...own.drafts.values()].map(item => item.pending && initialGroups.find(candidate => candidate.id === item.pending!.targetId && candidate.lastMutationId === item.pending!.mutationId)).find(Boolean);
          setNotice("Попереднє збереження підтверджено; чернетку очищено." + migrationSummary(recovered || undefined));
        }
        const selected = own.expanded;
        if (
          selected &&
          (selected === NEW_GROUP_DRAFT ||
            initialGroups.some((item) => groupDraftKey(item.id) === selected) ||
            restored.has(selected))
        ) {
          expandedRef.current = selected;
          setExpanded(selected);
        }
        persist(restored);
      } catch {
        if (!active) return;
        setStorageWarning(
          "Не вдалося відновити чернетки. Дані браузера не видалено; нові зміни залишаться в пам’яті сторінки.",
        );
        storageKey.current = null;
      }
      if (active) setReady(true);
    };
    void load();
    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(prefix) || event.key === storageKey.current)
        return;
      try {
        buckets.set(event.key, parseGroupDrafts(event.newValue).drafts);
        setExternalDrafts(mergedExternal());
      } catch {
        setStorageWarning(
          "Чернетка іншої вкладки має невідомий формат. Поточні зміни збережено окремо.",
        );
      }
    };
    const onPageHide = () => persist();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      active = false;
      closeBucket?.();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onPageHide);
    };
    // Account scope comes from the server. Typing never triggers an API write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftScope]);
  useEffect(() => {
    if (ready) applyCatalog(initialGroups);
  }, [initialGroups]);
  async function refresh(trigger?: HTMLElement) {
    if (trigger) beginActionFocus(trigger);
    const request = requests.begin("catalog", 13_000);
    setRefreshing(true);
    try {
      const result = await dashboardApiJson<{ groups: AccessGroup[] }>(
        "/api/dashboard/access-groups",
        { signal: request.signal, timeoutMs: 12_000, retries: 0 },
      );
      if (request.current()) {
        const confirmed = applyCatalog(result.groups);
        if (!confirmed) setNotice(
          "Список оновлено. Незбережені зміни залишаються в чернетках.",
        );
      }
    } catch (error) {
      if (request.current())
        setNotice(
          error instanceof ApiHttpError
            ? error.message
            : "Не вдалося оновити список. Чернетки збережено; спробуй ще раз.",
        );
    } finally {
      if (request.current()) setRefreshing(false);
      request.finish();
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    const button = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    if (button?.dataset.dashboardAction === "access-groups-impersonate") {
      persist();
      return;
    }
    event.preventDefault();
    const deleting = button?.dataset.dashboardAction === "access-groups-delete";
    if (blocked || conflict || (!deleting && !dirty)) return;
    if (
      !deleting &&
      group &&
      values.id !== group.id &&
      !window.confirm(
        "Змінити ID групи? Призначення профілів перейдуть разом із групою. Старий ID залишиться зарезервованим для записів зі старих сесій.",
      )
    )
      return;
    if (
      deleting &&
      (!canDelete ||
        !window.confirm(
          "Видалити цю групу доступу? Незбережені зміни цієї групи також буде скинуто.",
        ))
    )
      return;
    // React may reuse this same Delete button for the next selected group.
    if (button) beginActionFocus(button, { preferResult: deleting });
    requests.cancel("catalog");
    setRefreshing(false);
    const key = expanded,
      submitted = draftsRef.current.get(key) || makeGroupDraft(group),
      mutationId = crypto.randomUUID();
    if (!deleting) {
      const next = new Map(draftsRef.current);
      next.set(key, {
        ...submitted,
        pending: { mutationId, targetId: values.id, values },
      });
      replaceDrafts(next);
    }
    const request = requests.begin("mutation", 35_000);
    setBusy(true);
    setNotice(deleting ? "Видаляємо групу…" : "Зберігаємо групу…");
    try {
      const result = await dashboardApiJson<{
        group?: AccessGroup;
        deletedId?: string;
      }>("/api/dashboard/access-groups", {
        method: "POST",
        json: {
          action: deleting ? "delete" : "save",
          ...values,
          currentId: group?.id || "",
          expectedRevision: submitted.baseRevision,
          mutationId,
        },
        signal: request.signal,
        timeoutMs: 20_000,
        retries: 0,
      });
      if (!request.current()) return;
      if (deleting) {
        const fresh = groups.filter((item) => item.id !== group!.id),
          next = new Map(draftsRef.current);
        next.delete(key);
        replaceDrafts(next);
        setGroups(fresh);
        if (expandedRef.current === key)
          select(fresh[0] ? groupDraftKey(fresh[0].id) : NEW_GROUP_DRAFT);
        setNotice("Групу видалено.");
      } else if (result.group) {
        const fresh = [
          ...groups.filter(
            (item) => item.id !== group?.id && item.id !== result.group!.id,
          ),
          result.group,
        ].sort((a, b) => b.rank - a.rank);
        applyCatalog(fresh);
        if (expandedRef.current === key) select(groupDraftKey(result.group.id));
        setNotice(
          "Групу збережено. Нові права перевірятимуться в наступних серверних запитах." + migrationSummary(result.group),
        );
      }
    } catch (error) {
      if (!request.current()) return;
      const definiteFailure =
        error instanceof ApiHttpError &&
        error.status >= 400 &&
        error.status < 500;
      if (definiteFailure && !deleting) {
        const next = new Map(draftsRef.current),
          latest = next.get(key);
        if (latest) next.set(key, { ...latest, pending: undefined });
        replaceDrafts(next);
      }
      setNotice(
        definiteFailure
          ? error.message
          : "Відповідь не підтверджено. Перевіряємо збережений стан без повторного запису…",
      );
      if (
        !definiteFailure ||
        (error instanceof ApiHttpError && error.status === 409)
      ) {
        try {
          const fresh = await dashboardApiJson<{ groups: AccessGroup[] }>(
            "/api/dashboard/access-groups",
            { signal: request.signal, timeoutMs: 12_000, retries: 0 },
          );
          if (!request.current()) return;
          applyCatalog(fresh.groups);
          if (deleting && !fresh.groups.some((item) => item.id === group?.id)) {
            const next = new Map(draftsRef.current);
            next.delete(key);
            replaceDrafts(next);
            if (expandedRef.current === key) select(NEW_GROUP_DRAFT);
            setNotice(
              "Група відсутня у свіжому списку. Повторне видалення не потрібне.",
            );
          } else if (
            !deleting &&
            fresh.groups.some(
              (item) =>
                item.lastMutationId === mutationId && item.id === values.id,
            )
          )
            setNotice("Збереження підтверджено. Повторний запис не потрібен." + migrationSummary(fresh.groups.find(item => item.lastMutationId === mutationId && item.id === values.id)));
          else
            setNotice(
              definiteFailure
                ? error.message
                : "Збереження ще не підтверджено. Чернетка залишилась; онови список перед повторною дією.",
            );
        } catch {
          if (request.current())
            setNotice(
              "Не вдалося підтвердити результат. Чернетка збережена; онови список перед повторною дією.",
            );
        }
      }
    } finally {
      if (request.current()) setBusy(false);
      request.finish();
    }
  }
  const otherDraft = externalDrafts.get(expanded),
    otherDiffers = otherDraft && !sameGroupValues(otherDraft.values, values);
  return (
    <div ref={scopeRef} className={`access-groups-layout ${styles.workspace}`} aria-busy={busy || refreshing}>
      <AccessGroupList groups={groups} filteredGroups={filteredGroups} visibleCount={visibleCount} drafts={drafts} expanded={expanded}
        query={query} onQuery={value => { setQuery(value); setVisibleCount(10); }} onSelect={select}
        onMore={() => setVisibleCount(count => count + 10)} busy={busy || refreshing} refreshing={refreshing}
        onRefresh={button => void refresh(button)} />
      <div className={`access-groups-editor ${styles.editor}`}>
        <p className="access-draft-notice" role="status" aria-live="polite" aria-atomic="true" data-action-result="" tabIndex={-1}>
          {notice}
        </p>
        {storageWarning ? (
          <p className="access-warning" role="alert">
            {storageWarning}
          </p>
        ) : null}
        {otherDiffers ? (
          <div className="access-warning">
            <p>
              В іншій вкладці є окрема чернетка цієї групи. Поточні зміни
              залишаються тут.
            </p>
            <button
              className="btn subtle"
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  dirty &&
                  !window.confirm(
                    "Замінити поточну чернетку версією з іншої вкладки?",
                  )
                )
                  return;
                const next = new Map(draftsRef.current);
                next.set(expanded, updateGroupDraft(otherDraft, {}));
                replaceDrafts(next);
              }}
            >
              Відновити чернетку іншої вкладки
            </button>
          </div>
        ) : null}
        {conflict && draft ? (
          <section
            className="access-warning access-draft-conflict"
            role="alert"
          >
            <h3>Група змінилась на сервері</h3>
            <p>
              Збереження заблоковано до перегляду актуальних даних. Ваша
              чернетка залишилась.
            </p>
            {group ? (
              <>
                <div className="access-draft-comparison">
                  <table>
                    <caption>Відмінності чернетки від актуальної групи</caption>
                    <thead>
                      <tr>
                        <th>Поле</th>
                        <th>На сервері</th>
                        <th>У чернетці</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diffRows(groupValues(group), values).map(
                        ([label, server, local]) => (
                          <tr key={label}>
                            <th>{label}</th>
                            <td>{server}</td>
                            <td>{local}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="form-actions">
                  <button
                    className="btn subtle"
                    type="button"
                    disabled={busy}
                    onClick={resetDraft}
                  >
                    Взяти актуальні дані
                  </button>
                  <button
                    className="btn subtle"
                    type="button"
                    disabled={busy || Boolean(reason)}
                    onClick={() => {
                      const next = new Map(draftsRef.current);
                      next.set(expanded, {
                        ...draft,
                        base: groupValues(group),
                        baseRevision: group.revision || null,
                        pending: undefined,
                      });
                      replaceDrafts(next);
                      setNotice(
                        "Чернетку підготовлено. Перевір поля й натисни «Зберегти зміни», щоб застосувати їх.",
                      );
                    }}
                  >
                    Залишити чернетку для нового збереження
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Групу видалено. Її можна створити заново тільки окремим явним
                  збереженням.
                </p>
                <button
                  className="btn subtle"
                  type="button"
                  onClick={() => {
                    if (
                      draftsRef.current.has(NEW_GROUP_DRAFT) &&
                      !window.confirm("Замінити наявну чернетку нової групи?")
                    )
                      return;
                    const next = new Map(draftsRef.current);
                    next.delete(expanded);
                    next.set(NEW_GROUP_DRAFT, { ...makeGroupDraft(), values });
                    replaceDrafts(next);
                    select(NEW_GROUP_DRAFT);
                  }}
                >
                  Підготувати створення заново
                </button>
                <button
                  className="btn subtle"
                  type="button"
                  onClick={resetDraft}
                >
                  Скинути чернетку
                </button>
              </>
            )}
          </section>
        ) : null}
        <form
          className={`access-group-card ${styles.form}`}
          action={saveGroupAction}
          onSubmit={submit}
          data-dashboard-action-form="true"
          data-toast-managed="true"
          data-dashboard-action={
            group ? "access-groups-save" : "access-groups-create"
          }
          aria-busy={busy}
        >
          <input type="hidden" name="groupId" value={group?.id || ""} />
          <input type="hidden" name="currentId" value={group?.id || ""} />
          <input
            type="hidden"
            name="expectedRevision"
            value={draft?.baseRevision || group?.revision || ""}
          />
          <div className={`access-group-card__head ${styles.header}`}>
            <div>
              <span className="eyebrow">
                {group
                  ? FIXED_GROUP_IDS.has(group.id)
                    ? `Системна група · ID ${group.id}`
                    : "Користувацька група"
                  : "Нова група"}
              </span>
              <h2>
                {group ? (
                  <>
                    <span
                      className="access-group-title-icon"
                      aria-hidden="true"
                    >
                      {groupIcon(group)}
                    </span>
                    {group.name}
                  </>
                ) : (
                  "Додати групу доступу"
                )}
              </h2>
              <p>
                {reason ||
                  "Чернетки відновлюються у цьому браузері. Назва, роль і права змінюються лише після явного збереження."}
              </p>
              <span className="access-draft-badge">
                {dirty ? "Незбережені зміни" : "Без незбережених змін"}
              </span>
            </div>

          </div>
          {group ? (
            <div
              className={`access-group-summary ${styles.summary}`}
              aria-label="Коротко про групу"
            >
              <span>
                <strong>{roleLabel(group.role)}</strong>
                <small>Поточна системна роль</small>
              </span>
              <span>
                <strong>Ранг {group.rank}</strong>
                <small>Вищий ранг має пріоритет</small>
              </span>
              <span>
                <strong>
                  {group.discordRoleIds[0] || "Discord role ID не заданий"}
                </strong>
                <small>Одна Discord-роль на групу</small>
              </span>
            </div>
          ) : (
            <p>Системні ID 1, 2, 3 і 99 зайняті.</p>
          )}
          <AccessGroupFields values={values} group={group} blocked={blocked} fixedRole={fixedRole} fixedRank={fixedRank} isServerOwner={isServerOwner} edit={edit} />
          {reason ? (
            <p className="access-warning" role="status">
              {reason}
            </p>
          ) : null}
          <AccessGroupPermissions categories={categories} expanded={expanded} values={values} blocked={blocked} isServerOwner={isServerOwner} edit={edit} />
          <div className="form-actions access-form-actions">
            <button
              className="btn primary"
              type="submit"
              disabled={blocked || conflict || !dirty}
              data-dashboard-action={
                group ? "access-groups-save" : "access-groups-create"
              }
              data-loading-label="Зберігаємо..."
            >
              {busy
                ? "Виконуємо…"
                : group
                  ? "Зберегти зміни"
                  : "Створити групу"}
            </button>
            <DropdownMenu label="Інші дії з групою">
            <button
              className="btn subtle"
              type="button"
              onClick={resetDraft}
              disabled={busy || !draft}
            >
              Скинути чернетку
            </button>
            {canDelete ? (
              <button
                className="btn danger"
                formAction={deleteGroupAction}
                type="submit"
                formNoValidate
                disabled={blocked || conflict}
                data-dashboard-action="access-groups-delete"
                data-loading-label="Видаляємо..."
              >
                Видалити групу
              </button>
            ) : null}
            {group && isServerOwner ? (
              <button
                className="btn subtle"
                formAction={impersonateAction}
                type="submit"
                formNoValidate
                disabled={busy}
                data-dashboard-action="access-groups-impersonate"
                data-loading-label="Вмикаємо перегляд..."
              >
                Переглянути як
              </button>
            ) : null}
            </DropdownMenu>
          </div>
        </form>
      </div>
    </div>
  );
}
```

## src/components/ManagementSections.tsx

```tsx
"use client";
import styles from "./management/sections.module.css";

import Button from "@/components/ui/Button";

import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";

type Section = { id: string; label: string; description: string };

/** Panels stay mounted: switching tasks must not discard unsaved form values. */
export default function ManagementSections({ sections, children, initialSection, variant = "legacy" }: {
  sections: Section[];
  children: ReactNode;
  initialSection?: string;
  variant?: "legacy" | "universal";
}) {
  const universal = variant === "universal";
  const [active, setActive] = useState(initialSection || sections[0]?.id);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const prefix = useId();
  const panels = Children.toArray(children);
  useEffect(() => {
    let frame: number | undefined;
    const readHash = () => {
      if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
      const id = window.location.hash.slice(1);
      if (sections.some(section => section.id === id)) { setActive(id); return; }
      // Context actions can target a specific card inside a hidden task panel.
      const target = document.getElementById(id);
      const panel = target?.closest('[role="tabpanel"]');
      const section = sections.find(section => panel?.id === `${prefix}-panel-${section.id}`);
      if (!target || !section) return;
      setActive(section.id);
      frame = requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => { window.removeEventListener("hashchange", readHash); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [sections, prefix]);
  function select(id: string) {
    setActive(id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
  }
  return <div className={universal ? styles.sections : "management-sections"}>
    <div className={universal ? styles.tabs : "management-section-tabs"} role="tablist" aria-label="Задачі на цій сторінці">
      {sections.map((section, index) => <Button key={section.id} type="button" className={`btn ${universal ? styles.tab : "management-section-tab"}`} role="tab"
        id={`${prefix}-tab-${section.id}`} aria-controls={`${prefix}-panel-${section.id}`}
        aria-selected={active === section.id} tabIndex={active === section.id ? 0 : -1}
        ref={element => { tabs.current[index] = element; }}
        onClick={() => select(section.id)} onKeyDown={event => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % sections.length;
          else if (event.key === "ArrowLeft") next = (index - 1 + sections.length) % sections.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = sections.length - 1;
          else return;
          event.preventDefault(); select(sections[next].id); tabs.current[next]?.focus();
        }}>{!universal ? <span className="management-section-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span> : null}{section.label}</Button>)}
    </div>
    {sections.map((section, index) => <div key={section.id} className={universal ? styles.panel : "management-section-panel"} role="tabpanel"
      id={`${prefix}-panel-${section.id}`} aria-labelledby={`${prefix}-tab-${section.id}`}
      hidden={active !== section.id} tabIndex={0}>
      <p className={universal ? styles.description : "management-section-description"}>{section.description}</p>
      {panels[index]}
    </div>)}
  </div>;
}
```

## src/components/access-groups/AccessGroupFields.tsx

```tsx
"use client";
import type { DashboardRole } from "@/types/auth";
import type { AccessGroup } from "@/lib/accessGroupSchema";
import type { GroupValues } from "@/lib/accessGroupDrafts";
import FormSection from "@/components/page/FormSection";
import { ROLE_OPTIONS } from "./groupLabels";
import styles from "./groups.module.css";
export default function AccessGroupFields({values,group,blocked,fixedRole,fixedRank,isServerOwner,edit}:{values:GroupValues;group?:AccessGroup;blocked:boolean;fixedRole:boolean;fixedRank:boolean;isServerOwner:boolean;edit:(patch:Partial<GroupValues>)=>void}){return <FormSection title="Параметри групи"><div className={`access-form-grid ${styles.fields}`}>
            <label>
              <span>ID групи</span>
              <input
                className="input"
                name="id"
                value={values.id}
                onChange={(event) => edit({ id: event.target.value })}
                required
                maxLength={32}
                pattern="[A-Za-z0-9_-]{1,32}"
                readOnly={blocked || group?.lockedId}
                autoComplete="off"
              />
              <small>
                {group?.lockedId
                  ? "Системний ID не змінюється."
                  : "Латиниця, цифри, _ або -. При зміні ID призначення профілів переносяться разом із групою; старий ID залишається зарезервованим."}
              </small>
            </label>
            <label>
              <span>Назва групи</span>
              <input
                className="input"
                name="name"
                value={values.name}
                onChange={(event) => edit({ name: event.target.value })}
                required
                maxLength={80}
                readOnly={blocked}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Роль у системі</span>
              <select
                className="select"
                name="role"
                value={values.role}
                onChange={(event) =>
                  edit({ role: event.target.value as DashboardRole })
                }
                disabled={blocked || fixedRole}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option
                    key={role.value}
                    value={role.value}
                    disabled={role.value === "admin" && !isServerOwner}
                  >
                    {role.label}
                  </option>
                ))}
              </select>
              <small>
                {fixedRole
                  ? "Для системної групи роль зафіксована."
                  : "Права адміністратора видає лише власник сервера."}
              </small>
            </label>
            <label>
              <span>Ранг</span>
              <input
                className="input"
                name="rank"
                type="number"
                min="1"
                max="100"
                value={values.rank}
                onChange={(event) => edit({ rank: event.target.value })}
                readOnly={blocked || fixedRank}
              />
              <small>Вищий ранг має пріоритет, якщо ролей кілька.</small>
            </label>
            <label>
              <span>
                Іконка групи <em>необов’язково</em>
              </span>
              <input
                className="input"
                name="icon"
                value={values.icon}
                onChange={(event) => edit({ icon: event.target.value })}
                maxLength={24}
                readOnly={blocked}
                autoComplete="off"
              />
            </label>
            <label>
              <span>Discord role ID</span>
              <input
                className="input"
                name="discordRoleId"
                value={values.discordRoleId}
                onChange={(event) =>
                  edit({ discordRoleId: event.target.value })
                }
                maxLength={25}
                inputMode="numeric"
                pattern="[0-9]{16,25}"
                readOnly={blocked}
                autoComplete="off"
              />
              <small>
                Одна група = одна Discord-роль. Поле може бути порожнім.
              </small>
            </label>
          </div></FormSection>;}
```

## src/components/access-groups/AccessGroupList.tsx

```tsx
"use client";
import type { AccessGroup } from "@/lib/accessGroupSchema";
import type { GroupDraft } from "@/lib/accessGroupDrafts";
import { groupDraftKey, NEW_GROUP_DRAFT } from "@/lib/accessGroupDrafts";
import FilterToolbar from "@/components/page/FilterToolbar";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/page/EmptyState";
import StatusBadge from "@/components/page/StatusBadge";
import { groupIcon, roleLabel } from "./groupLabels";
import styles from "./groups.module.css";

type Props = {
  groups: AccessGroup[]; filteredGroups: AccessGroup[]; visibleCount: number; drafts: Map<string, GroupDraft>; expanded: string;
  query: string; onQuery: (value: string) => void; onSelect: (key: string) => void; onMore: () => void;
  busy: boolean; refreshing: boolean; onRefresh: (button: HTMLButtonElement) => void;
};
export default function AccessGroupList(props: Props) {
  return <aside className={`access-groups-list ${styles.list}`} aria-label="Список груп доступу">
    <FilterToolbar label="Пошук груп" search={<FormField label="Знайти групу" type="search" maxLength={120} value={props.query} onChange={event => props.onQuery(event.target.value)} placeholder="Назва, ID або Discord-роль" />}
      result={`${props.groups.length} груп · ${props.drafts.size} чернеток`} />
    {props.filteredGroups.slice(0, props.visibleCount).map(group => <Button key={group.id} className={`access-group-tab ${styles.groupButton}`} aria-pressed={props.expanded === groupDraftKey(group.id)} onClick={() => props.onSelect(groupDraftKey(group.id))}>
      <strong>{groupIcon(group)} {group.name}</strong><small>ID {group.id} · {roleLabel(group.role)} · {group.permissions.length} прав</small>
      {props.drafts.has(groupDraftKey(group.id)) ? <StatusBadge tone="warning">Незбережені зміни</StatusBadge> : null}
    </Button>)}
    {!props.filteredGroups.length ? <EmptyState title="Груп не знайдено" description="Зміни пошук або створи нову групу." /> : null}
    {props.filteredGroups.length > props.visibleCount ? <Button onClick={props.onMore}>Показати ще 10 · {props.filteredGroups.length - props.visibleCount} залишилось</Button> : null}
    {[...props.drafts.keys()].filter(key => key !== NEW_GROUP_DRAFT && !props.groups.some(group => groupDraftKey(group.id) === key)).map(key => <Button key={key} onClick={() => props.onSelect(key)}>Чернетка видаленої групи · {props.drafts.get(key)!.values.name}</Button>)}
    <Button tone="primary" aria-pressed={props.expanded === NEW_GROUP_DRAFT} onClick={() => props.onSelect(NEW_GROUP_DRAFT)}>Нова група</Button>
    <Button busy={props.refreshing} disabled={props.busy} onClick={event => props.onRefresh(event.currentTarget)}>{props.refreshing ? "Оновлюємо…" : "Оновити список"}</Button>
  </aside>;
}
```

## src/components/access-groups/AccessGroupPermissions.tsx

```tsx
"use client";
import { DASHBOARD_PERMISSION_KEYS,PERMISSION_META } from "@/lib/accessGroupSchema";
import type { GroupValues } from "@/lib/accessGroupDrafts";
import FormSection from "@/components/page/FormSection";
import styles from "./groups.module.css";
export default function AccessGroupPermissions({categories,expanded,values,blocked,isServerOwner,edit}:{categories:string[];expanded:string;values:GroupValues;blocked:boolean;isServerOwner:boolean;edit:(patch:Partial<GroupValues>)=>void}){return <FormSection title="Дозволи групи"><div className={`permissions-grid ${styles.permissions}`}>
            {categories.map((category, index) => (
              <details
                className="permissions-category"
                key={`${expanded}:${category}`}
                open={index === 0}
              >
                <summary>
                  {category}
                  <small>
                    {
                      DASHBOARD_PERMISSION_KEYS.filter(
                        (key) => PERMISSION_META[key].category === category,
                      ).length
                    }{" "}
                    прав
                  </small>
                </summary>
                {DASHBOARD_PERMISSION_KEYS.filter(
                  (key) => PERMISSION_META[key].category === category,
                ).map((key) => (
                  <label className="permission-check" key={key}>
                    <input
                      type="checkbox"
                      name="permissions"
                      value={key}
                      checked={values.permissions.includes(key)}
                      disabled={
                        blocked ||
                        key === "dashboard.view" ||
                        (key === "groups.manage" && !isServerOwner)
                      }
                      onChange={(event) =>
                        edit({
                          permissions: event.target.checked
                            ? [...values.permissions, key]
                            : values.permissions.filter((item) => item !== key),
                        })
                      }
                    />
                    <span>
                      <strong>{PERMISSION_META[key].title}</strong>
                      <small>{PERMISSION_META[key].description}</small>
                    </span>
                  </label>
                ))}
              </details>
            ))}
          </div></FormSection>;}
```

## src/components/access-groups/groupLabels.ts

```ts
import type { DashboardRole } from "@/types/auth";
import type { AccessGroup } from "@/lib/accessGroupSchema";
export const ROLE_OPTIONS: Array<{ value: DashboardRole; label: string }> = [
  { value: "member", label: "Учасник" },
  { value: "mentor", label: "Наставник" },
  { value: "moderator", label: "Модератор" },
  { value: "admin", label: "Адмін" },
];
export const roleLabel = (role: DashboardRole) =>
  ROLE_OPTIONS.find((item) => item.value === role)?.label || "Група";
export const groupIcon = (group: AccessGroup) =>
  group.icon ||
  (group.role === "admin"
    ? "👑"
    : group.role === "moderator"
      ? "🛡️"
      : group.role === "mentor"
        ? "🌿"
        : "🍃");
```

## src/components/access-groups/groups.module.css

```css
.workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--section-gap); min-width: 0; }
.workspace .list { display: grid; gap: var(--space-xs); position: static; min-width: 0; padding: 0; max-height: none; }
.list .groupButton { display: grid; justify-items: start; text-align: left; padding: var(--space-sm); gap: var(--space-2xs); min-width: 0; }
.groupButton small { color: var(--text-muted); white-space: normal; }
.groupButton[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--border-strong); }
.editor { display: grid; gap: var(--section-gap); min-width: 0; }
.workspace .form { display: grid; gap: var(--section-gap); padding: 0; background: transparent; border: 0; box-shadow: none; min-width: 0; }
.workspace .header { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: var(--space-md); }
.header h2 { margin: 0; font-size: var(--heading-section-size); color: var(--text-strong); }
.header p { color: var(--text-soft); font-size: var(--font-size-body-sm); line-height: var(--line-height-copy); }
.workspace .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-sm); }
.summary > span { display: grid; gap: var(--space-2xs); padding: var(--space-sm); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); }
.summary small { color: var(--text-muted); }
.workspace .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-md); }
.fields label { display: grid; align-content: start; gap: var(--space-xs); min-width: 0; }
.fields :is(input, select) { width: 100%; min-width: 0; }
.fields small { color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-copy); }
.workspace .permissions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--data-grid-min)), 1fr)); gap: var(--space-sm); }
.permissions :global(.permissions-category) { padding: var(--space-sm); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface-sunken); }
.permissions summary { font-size: var(--font-size-body); color: var(--text-strong); }
.permissions summary small { color: var(--text-muted); margin-inline-start: var(--space-xs); }
.permissions :global(.permission-check) { display: flex; align-items: start; padding: var(--space-sm); gap: var(--space-xs); }
.permissions :global(.permission-check) > span { display: grid; gap: var(--space-2xs); }
.permissions :global(.permission-check) small { font-size: var(--font-size-meta); color: var(--text-muted); line-height: var(--line-height-body); }
@container (min-width: 1000px) { .workspace { grid-template-columns: minmax(0, 1fr) minmax(0, 3fr); align-items: start; } }
.workspace :global(.access-group-title-icon) { display: inline-grid; place-items: center; flex: none; }
.workspace :global(.access-draft-badge) { display: block; color: var(--c-accent-300); font-size: var(--font-size-meta); }
.workspace :global(.access-draft-notice), .workspace :global(.access-warning) { display: grid; gap: var(--space-sm); padding: var(--panel-padding); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--accent-soft); color: var(--text-soft); font-size: var(--font-size-body-sm); line-height: var(--line-height-copy); min-width: 0; overflow-wrap: anywhere; }
.workspace :global(.access-warning) { border-color: var(--tint-warning-border); background: var(--tint-warning-bg); }
.workspace :global(.access-draft-notice):empty { position: absolute; width: var(--stroke-width); height: var(--stroke-width); overflow: hidden; clip-path: inset(50%); padding: 0; margin: 0; border: 0; }
.workspace :global(.access-draft-conflict) h3 { margin: 0; font-size: var(--heading-card-size); }
.workspace :global(.access-draft-comparison) { overflow-x: auto; max-width: 100%; min-width: 0; }
.workspace :global(.access-draft-comparison) table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--font-size-body-sm); }
.workspace :global(.access-draft-comparison) :is(th, td) { text-align: left; vertical-align: top; padding: var(--space-sm); border-bottom: var(--stroke-width) solid var(--border); overflow-wrap: anywhere; }
.workspace :global(.access-draft-comparison) caption { text-align: left; padding-bottom: var(--space-xs); color: var(--text-muted); }
.workspace :global(.form-actions) { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; min-width: 0; }
.workspace :global(.access-form-actions) { padding-top: var(--space-md); border-top: var(--stroke-width) solid var(--border); }
.list .groupButton { width: 100%; height: auto; min-height: var(--control-height); white-space: normal; }
.groupButton strong { display: block; font-size: var(--font-size-body-sm); line-height: var(--line-height-body); color: var(--text-strong); overflow-wrap: anywhere; }
.workspace .header { padding-bottom: var(--space-md); border-bottom: var(--stroke-width) solid var(--border-subtle); }
.header > div { display: grid; gap: var(--space-xs); min-width: 0; }
.header h2 { display: flex; align-items: center; gap: var(--space-xs); }
.header p { margin: 0; }
.summary strong { font-size: var(--font-size-body-sm); color: var(--text-body); overflow-wrap: anywhere; }
.summary small { font-size: var(--font-size-meta); line-height: var(--line-height-body); }
.permissions summary { padding: var(--space-xs); cursor: pointer; min-height: var(--control-height); }
.permissions :global(.permission-check) { cursor: pointer; border-radius: var(--control-radius); }
.permissions :global(.permission-check):hover { background: var(--surface-hover); }
.permissions :global(.permission-check) input { margin-top: var(--space-2xs); flex: none; }
.permissions :global(.permission-check) strong { font-size: var(--font-size-body-sm); color: var(--text-body); }
```

## src/components/management/ManagementPage.tsx

```tsx
import type { ReactNode } from "react";
import type { DashboardSession } from "@/types/auth";
import type { AdminTabKey } from "@/lib/navigation/management";
import DashboardIdentity from "@/components/DashboardIdentity";
import AdminTabs from "@/components/AdminTabs";
import PageContainer from "@/components/page/PageContainer";
import PageHeader, { type PageHeaderProps } from "@/components/page/PageHeader";

export default function ManagementPage({ user, active, header, children }: {
  user: DashboardSession;
  active: AdminTabKey;
  header: PageHeaderProps;
  children: ReactNode;
}) {
  return <PageContainer label={header.title} navigation={<DashboardIdentity user={user} activeSection="admin" />}
    sidebar={<AdminTabs active={active} user={user} />}>
    <PageHeader {...header} breadcrumbs={header.breadcrumbs || [{ label: "Керування", href: "/dashboard" }, { label: header.title }]} />
    {children}
  </PageContainer>;
}
```

## src/components/management/access/AccessPolicyForms.tsx

```tsx
import type { AuthAccessPolicy } from "@/lib/authAccessPolicy";
import type { GeoAccessPolicy } from "@/lib/geoAccessPolicy";
import type { AccessGroup } from "@/lib/accessGroupSchema";
import FormSection from "@/components/page/FormSection";
import Notice from "@/components/page/Notice";
import Button from "@/components/ui/Button";
import FormField from "@/components/ui/FormField";
import RoleMappingsEditor, { type RoleMappingRow } from "./RoleMappingsEditor";
import styles from "./access.module.css";

export function AuthAccessForm({ policy, rows, groups, canEdit, isServerOwner, rolesError, protectedMappings }: {
  policy: AuthAccessPolicy;
  rows: RoleMappingRow[];
  groups: AccessGroup[];
  canEdit: boolean;
  isServerOwner: boolean;
  rolesError: boolean;
  protectedMappings: boolean;
}) {
  return <form className={styles.stack} action="/api/dashboard/security/auth-access" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
    {rolesError ? <Notice title="Discord-ролі недоступні" tone="warning">Збереження вимкнено, щоб не втратити наявні відповідності. Онови сторінку після відновлення зʼєднання.</Notice> : null}
    {protectedMappings ? <Notice title="Потрібен власник сервера" tone="warning">Політика містить адміністративні відповідності. Їх може змінювати лише власник Discord-сервера.</Notice> : null}
    <FormSection title="Правила входу" description="Публічні рейди доступні без входу. Команда отримує доступ лише через явно зіставлені Discord-ролі.">
      <label className={styles.toggle}><input type="checkbox" name="allowServerOwner" defaultChecked={policy.allowServerOwner} disabled={!isServerOwner || !canEdit} />
        <span><strong>Власник сервера має виняток</strong><small>Змінювати цей виняток може тільки власник.</small></span></label>
    </FormSection>
    <FormSection title="Discord → група сайту" description="Без відповідності вхід заборонено. Якщо ролей кілька, обирається група з вищим рангом.">
      <RoleMappingsEditor rows={rows} groups={groups.map(group => ({ id: group.id, name: group.name }))} disabled={!canEdit} />
      <div className={styles.fields}>
        <FormField label="Discord role ID (додати вручну)" name="manualRoleId" pattern="[0-9]{16,25}" maxLength={25} inputMode="numeric" placeholder="123456789012345678" disabled={!canEdit} />
        <label className={styles.field}>Група доступу<select name="manualGroupId" defaultValue="" disabled={!canEdit}><option value="">Не додавати</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      </div>
      {!groups.length ? <Notice title="Групи недоступні" tone="warning">Спочатку перевір групи доступу. Збереження політики вимкнено.</Notice> : null}
    </FormSection>
    <Button tone="primary" type="submit" disabled={!canEdit || !groups.length}>Зберегти правила входу</Button>
  </form>;
}

export function GeoAccessForm({ policy }: { policy: GeoAccessPolicy }) {
  const options = [
    { name: "enabled", title: "Увімкнути геообмеження", hint: "Застосовувати налаштовані правила.", checked: policy.enabled },
    { name: "blockApplications", title: "Блокувати подання заявок", hint: "Для країн зі списку нижче.", checked: policy.blockApplications },
    { name: "blockAuth", title: "Блокувати авторизацію", hint: "Не починати Discord OAuth із заблокованих країн.", checked: policy.blockAuth },
    { name: "blockUnknownCountries", title: "Блокувати невідому країну", hint: "Може зачепити VPN або запити без геоданих.", checked: policy.blockUnknownCountries },
  ];
  return <form className={styles.stack} action="/api/dashboard/security/geo-access" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
    <FormSection title="Географія доступу" description="Країна визначається сервером за даними запиту. Користувач не обирає її вручну.">
      {options.map(option => <label className={styles.toggle} key={option.name}><input type="checkbox" name={option.name} defaultChecked={option.checked} />
        <span><strong>{option.title}</strong><small>{option.hint}</small></span></label>)}
      <FormField label="Заблоковані країни" name="blockedCountries" defaultValue={policy.blockedCountries.join(", ")} maxLength={512}
        hint="ISO-коди через кому, наприклад RU, BY. Регістр нормалізується сервером." placeholder="RU, BY" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
    </FormSection>
    <Button type="submit" tone="primary">Зберегти геообмеження</Button>
  </form>;
}
```

## src/components/management/access/RoleMappingsEditor.tsx

```tsx
"use client";
import { useId, useState } from "react";
import FilterToolbar from "@/components/page/FilterToolbar";
import FormField from "@/components/ui/FormField";
import styles from "./access.module.css";

export type RoleMappingRow = { roleId: string; name: string; groupId: string; missing?: boolean };
export default function RoleMappingsEditor({ rows, groups, disabled }: { rows: RoleMappingRow[]; groups: Array<{ id: string; name: string }>; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const prefix = useId();
  const needle = query.trim().toLocaleLowerCase("uk-UA");
  const match = (row: RoleMappingRow) => `${row.name} ${row.roleId}`.toLocaleLowerCase("uk-UA").includes(needle);
  return <div className={styles.stack}>
    <FilterToolbar label="Пошук Discord-ролей" search={<FormField label="Знайти роль" type="search" value={query} maxLength={120}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Назва або ID ролі" />}
      result={`Ролей: ${rows.filter(match).length} із ${rows.length}. Усі відповідності залишаються у формі.`} />
    <div className={styles.roles}>
      {rows.map(row => <div key={row.roleId} className={styles.roleRow} hidden={!match(row)}>
        <label htmlFor={`${prefix}-${row.roleId}`}><strong>{row.name}</strong><small>{row.roleId}{row.missing ? " · роль не повернута Discord" : ""}</small></label>
        <select id={`${prefix}-${row.roleId}`} name={`roleMap:${row.roleId}`} defaultValue={row.groupId} disabled={disabled} aria-label={`Група сайту для Discord-ролі ${row.name}`}>
          <option value="">Без доступу</option>
          {row.groupId && !groups.some(group => group.id === row.groupId) ? <option value={row.groupId}>Поточна група {row.groupId} (редагує власник)</option> : null}
          {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </div>)}
    </div>
    {!rows.some(match) ? <p className={styles.hint} role="status">Ролей за цим пошуком не знайдено. Відповідності не змінені.</p> : null}
  </div>;
}
```

## src/components/management/access/access.module.css

```css
.stack { display: grid; gap: var(--section-gap); min-width: 0; }
.fields { display: grid; gap: var(--space-md); grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); }
.field { display: grid; gap: var(--space-xs); color: var(--text-body); min-width: 0; }
.field :is(input, select) { width: 100%; min-width: 0; max-width: 100%; }
.hint, .field small { font-size: var(--font-size-meta); color: var(--text-muted); line-height: var(--line-height-copy); }
.toggle { display: flex; align-items: start; gap: var(--space-sm); padding: var(--space-sm); border: var(--stroke-width) solid var(--border); border-radius: var(--control-radius); background: var(--surface-sunken); }
.toggle > span { display: grid; gap: var(--space-2xs); }
.toggle small { color: var(--text-soft); line-height: var(--line-height-body); }
.toggle:has(input:checked) { border-color: var(--border-strong); background: var(--accent-soft); }
.roles { display: grid; gap: var(--space-xs); }
.roleRow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-md); align-items: center; padding: var(--space-sm); border-bottom: var(--stroke-width) solid var(--border-subtle); }
.roleRow[hidden] { display: none; }
.roleRow > label { display: grid; gap: var(--space-2xs); overflow-wrap: anywhere; }
.roleRow small { font-size: var(--font-size-meta); color: var(--text-muted); }
.roleRow select { min-width: 0; width: 100%; }
@container (max-width: 640px) { .roleRow { grid-template-columns: minmax(0, 1fr); } }
```

## src/components/management/cleanup/ProfileCleanupForms.tsx

```tsx
import type { AccountCleanupAutomationSettings } from "@/lib/accountCleanupAutomation";
import { nextAccountCleanupAt } from "@/lib/accountCleanupAutomation";
import PageSection from "@/components/page/PageSection";
import FormSection from "@/components/page/FormSection";
import Notice from "@/components/page/Notice";
import EmptyState from "@/components/page/EmptyState";
import StatusBadge from "@/components/page/StatusBadge";
import Button from "@/components/ui/Button";
import DataTable from "@/components/ui/DataTable";
import FormField from "@/components/ui/FormField";
import styles from "../access/access.module.css";

export function cleanupDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Ще не запускалось";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
export default function ProfileCleanupForms({ settings }: { settings: AccountCleanupAutomationSettings }) {
  const checkAt = nextAccountCleanupAt(settings.lastCheckAt, settings.checkIntervalHours, settings.autoCheckEnabled);
  const applyAt = nextAccountCleanupAt(settings.lastCleanupAt, settings.cleanupIntervalHours, settings.autoCleanupEnabled);
  return <>
    <Notice title="Спочатку перевірка, потім видалення" tone="warning">
      Кандидат має одночасно бути відсутнім у Discord і поточному складі гільдії. Для ручного видалення потрібна успішна попередня перевірка від того самого власника не старше 15 хвилин із тим самим лімітом. Перед застосуванням дані перевіряються повторно.
    </Notice>
    {settings.lastError ? <Notice title="Останнє попередження" tone="warning">{settings.lastError}</Notice> : null}
    <div id="account-automation"><PageSection id="cleanup-schedule-title" title="Автоматизація" description="Розклад перевірки та очищення налаштовуються окремо.">
      <DataTable caption="Поточний стан очищення" headings={["Операція", "Стан", "Останній запуск", "Наступний запуск", "Результат"]}>
        <tr><th scope="row">Перевірка</th><td><StatusBadge tone={settings.autoCheckEnabled ? "success" : "neutral"}>{settings.autoCheckEnabled ? `Кожні ${settings.checkIntervalHours} год` : "Вимкнено"}</StatusBadge></td>
          <td>{cleanupDate(settings.lastCheckAt)}</td><td>{checkAt ? cleanupDate(checkAt) : "Не заплановано"}</td><td>Кандидатів: {settings.lastCheckCandidates} · перевірено: {settings.lastCheckCheckedProfiles}</td></tr>
        <tr><th scope="row">Видалення</th><td><StatusBadge tone={settings.autoCleanupEnabled ? "warning" : "neutral"}>{settings.autoCleanupEnabled ? `Кожні ${settings.cleanupIntervalHours} год` : "Вимкнено"}</StatusBadge></td>
          <td>{cleanupDate(settings.lastCleanupAt)}</td><td>{applyAt ? cleanupDate(applyAt) : "Лише вручну"}</td><td>Видалено: {settings.lastCleanupDeletedProfiles}</td></tr>
      </DataTable>
      <form action="/api/dashboard/discord/profiles/cleanup-settings" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
        <FormSection title="Розклад" description="Налаштування перевіряються кожні 15 хвилин. Автоочищення за замовчуванням вимкнене."
          actions={<Button tone="primary" type="submit">Зберегти автоматизацію</Button>}>
          <label className={styles.toggle}><input name="autoCheckEnabled" type="checkbox" defaultChecked={settings.autoCheckEnabled} /><span><strong>Автоматично перевіряти</strong><small>Знаходить кандидатів і записує результат без видалення.</small></span></label>
          <label className={styles.toggle}><input name="autoCleanupEnabled" type="checkbox" defaultChecked={settings.autoCleanupEnabled} /><span><strong>Автоматично очищати</strong><small>Видаляє неактивні профілі після окремої успішної перевірки.</small></span></label>
          <div className={styles.fields}>
            <label className={styles.field}>Інтервал перевірки<select name="checkIntervalHours" defaultValue={String(settings.checkIntervalHours)}>{[1, 3, 6, 12, 24].map(hours => <option key={hours} value={hours}>Кожні {hours} год</option>)}</select></label>
            <label className={styles.field}>Інтервал очищення<select name="cleanupIntervalHours" defaultValue={String(settings.cleanupIntervalHours)}>{[12, 24, 48, 72, 168].map(hours => <option key={hours} value={hours}>Кожні {hours} год</option>)}</select></label>
            <FormField label="Ліміт профілів за запуск" name="profileLimit" type="number" min={0} max={50000} defaultValue={settings.profileLimit} hint="0 = усі профілі посторінково" />
          </div>
        </FormSection>
      </form>
    </PageSection></div>
    <PageSection id="profile-maintenance" title="Ручна перевірка та очищення" description="Ці дії не змінюють розклад автоматизації.">
      <form className={styles.stack} action="/api/dashboard/discord/profiles/cleanup" method="post" data-dashboard-action-form="true" data-dashboard-live-submit="true">
        <FormSection title="Межі перевірки">
          <FormField label="Скільки профілів перевірити" name="limit" type="number" min={0} max={50000} defaultValue={settings.profileLimit}
            hint="0 = усі профілі посторінково. Для видалення потрібна попередня перевірка з точно таким самим лімітом." />
          <Button name="mode" value="inspect" type="submit">Тільки перевірити</Button>
        </FormSection>
        <details><summary>Видалення після перевірки</summary>
          <FormSection title="Підтвердження видалення" description="Разом із профілем очищаються активні рейдові записи, піки складу та голоси відкритих пулів. Закриті пули залишаються історією.">
            <label className={styles.toggle}><input name="confirmDeletion" type="checkbox" value="DELETE_STALE_PROFILES" /><span>Підтверджую, що переглянув результат перевірки. Видалити лише профілі, відсутні в Discord і roster.</span></label>
            <Button tone="danger" name="mode" value="apply" type="submit" data-confirm-message="Видалити підтверджені неактуальні профілі та їхні пов’язані активні записи?">Видалити неактуальні</Button>
          </FormSection>
        </details>
      </form>
    </PageSection>
    <PageSection id="profile-cleanup-history" title="Історія запусків">
      {settings.recentRuns.length ? <DataTable caption="Останні перевірки й очищення" headings={["Операція", "Джерело / час", "Перевірено", "Кандидати", "Видалено", "Помилки", "Стан"]}>
        {settings.recentRuns.map(run => <tr key={run.id}><th scope="row">{run.mode === "apply" ? "Очищення" : "Перевірка"}</th><td>{run.source === "automatic" ? "Автоматично" : "Вручну"} · {cleanupDate(run.completedAt)}</td>
          <td>{run.checkedProfiles}</td><td>{run.candidates}</td><td>{run.deletedProfiles}</td><td>{run.errors}</td><td><StatusBadge tone={run.status === "error" ? "danger" : run.status === "warning" ? "warning" : "success"}>{run.status === "error" ? "Помилка" : run.status === "warning" ? "З попередженням" : "Успішно"}</StatusBadge></td></tr>)}
      </DataTable> : <EmptyState title="Запусків ще немає" description="Почни з ручної перевірки. Її результат зʼявиться в історії." />}
    </PageSection>
  </>;
}
```

## src/components/management/sections.module.css

```css
.sections { display: grid; gap: var(--section-gap); min-width: 0; }
.tabs { display: flex; flex-wrap: wrap; gap: var(--space-xs); padding-bottom: var(--space-sm); border-bottom: var(--stroke-width) solid var(--border); }
.tabs .tab { font-size: var(--font-size-body-sm); }
.tabs .tab[aria-selected="true"] { background: var(--accent-soft); border-color: var(--border-strong); color: var(--text-strong); }
.panel { display: grid; gap: var(--section-gap); min-width: 0; }
.panel[hidden] { display: none; }
.description { margin: 0; color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-copy); }
```

## src/components/page/FilterNavigationForm.tsx

```tsx
"use client";
import { useTransition, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./page-system.module.css";

export default function FilterNavigationForm({ action, children }: { action: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value.trim()) params.set(key, value.trim());
    }
    const suffix = params.toString();
    startTransition(() => router.push(action + (suffix ? `?${suffix}` : ""), { scroll: false }));
  }
  return <form action={action} method="get" onSubmit={submit} aria-busy={pending || undefined}>
    <fieldset className={styles.filterFields} disabled={pending}>{children}</fieldset>
    {pending ? <p className={styles.metadata} role="status">Оновлюємо список. Попередні дані залишаються на екрані.</p> : null}
  </form>;
}
```

## src/components/page/Notice.tsx

```tsx
import type { ReactNode } from "react";
import StatusBadge, { type StatusTone } from "./StatusBadge";
import styles from "./page-system.module.css";

export default function Notice({ title, children, tone = "info", actions }: {
  title: string;
  children?: ReactNode;
  tone?: StatusTone;
  actions?: ReactNode;
}) {
  return <div className={styles.notice} data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
    <strong><StatusBadge tone={tone}>{title}</StatusBadge></strong>
    {children ? <div className={styles.description}>{children}</div> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </div>;
}
```

## src/components/page/PageRouteError.tsx

```tsx
"use client";
import { useEffect } from "react";
import { sendClientErrorReport } from "@/components/ClientErrorReporter";
import PageContainer from "./PageContainer";
import ErrorState from "./ErrorState";
import Button from "@/components/ui/Button";

export default function PageRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void sendClientErrorReport(error, "react-error-boundary");
  }, [error]);
  return <PageContainer label="Помилка розділу">
    <ErrorState title="Розділ тимчасово недоступний" description="Не вдалося завантажити дані. Повтори спробу."
      digest={error.digest} actions={<Button onClick={reset}>Повторити</Button>} />
  </PageContainer>;
}
```

## src/components/page/Progress.tsx

```tsx
import styles from "./page-system.module.css";

export default function Progress({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(safeMax, value)) : 0;
  return <progress className={styles.progress} value={safeValue} max={safeMax} aria-label={label}>{Math.round(safeValue / safeMax * 100)}%</progress>;
}
```

## src/components/page/page-system.module.css

```css
.container { min-width: 0; }
.frame { display: grid; gap: var(--page-gap); min-width: 0; }
.workspace { display: grid; grid-template-columns: var(--management-sidebar-width) minmax(0, 1fr); gap: var(--page-gap); align-items: start; min-width: 0; }
.content { display: grid; gap: var(--page-gap); min-width: 0; container-type: inline-size; }
.sidebar { position: sticky; top: calc(var(--nav-space) + var(--space-md)); max-height: calc(100dvh - var(--nav-space) - var(--space-xl)); overflow-y: auto; min-width: 0; scrollbar-width: thin; }
.sidebar :global(.management-nav) { display: grid; gap: var(--space-lg); padding: var(--space-md); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--nav-surface); }
.sidebar :global(.management-nav-label) { display: block; margin-bottom: var(--space-xs); color: var(--text-muted); font-size: var(--font-size-meta); font-weight: var(--font-weight-medium); }
.sidebar :global(.management-nav-links) { display: grid; gap: var(--space-2xs); }
.sidebar :global(.management-nav-links) a { display: grid; gap: var(--space-2xs); padding: var(--space-sm); border: var(--stroke-width) solid transparent; border-radius: var(--control-radius); color: var(--text-body); text-decoration: none; overflow-wrap: anywhere; transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out); }
.sidebar :global(.management-nav-links) a small { color: var(--text-muted); font-size: var(--font-size-meta); }
.sidebar :global(.management-nav-links) a:hover { background: var(--surface-hover); }
.sidebar :global(.management-nav-links) a[aria-current="page"] { border-color: var(--border-strong); background: var(--accent-soft); }
.header, .toolbar, .dataCard, .formSection, .emptyState, .errorState { min-width: 0; border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); box-shadow: var(--shadow-sm); }
.header { display: grid; gap: var(--space-lg); padding: var(--panel-padding); }
.headerRow, .sectionHeader { display: flex; align-items: start; justify-content: space-between; flex-wrap: wrap; gap: var(--space-md); }
.headerCopy { min-width: 0; flex: 1 1 var(--toolbar-search-min); display: grid; gap: var(--space-xs); }
.header .title { margin: 0; color: var(--text-strong); font-family: var(--font-display); font-size: var(--heading-page-size); font-weight: var(--font-weight-bold); line-height: var(--line-height-tight); overflow-wrap: anywhere; }
.eyebrow { color: var(--c-accent-300); font-size: var(--font-size-meta); font-weight: var(--font-weight-semibold); }
.description { margin: 0; color: var(--text-soft); font-size: var(--font-size-body); line-height: var(--line-height-copy); overflow-wrap: anywhere; }
.breadcrumbs { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin: 0; padding: 0; list-style: none; color: var(--text-muted); font-size: var(--font-size-meta); }
.breadcrumbs li + li::before { content: "/"; margin-right: var(--space-xs); color: var(--text-faint); }
.breadcrumbs a { color: var(--text-soft); }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-xs); min-width: 0; }
.actions :global(.btn) { white-space: normal; max-width: 100%; overflow-wrap: anywhere; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-md); margin: 0; }
.metric { min-width: 0; padding-block-start: var(--space-sm); border-top: var(--stroke-width) solid var(--border-subtle); }
.metric dt, .metadata { color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-body); }
.metric dd { margin: var(--space-2xs) 0 0; color: var(--text-strong); font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); overflow-wrap: anywhere; }
.metric .metricNote { color: var(--text-muted); font-size: var(--font-size-meta); font-weight: var(--font-weight-ui); }
.toolbar { display: grid; gap: var(--space-sm); padding: var(--space-md); }
.toolbarRow { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-sm); }
.search { flex: 1 1 var(--toolbar-search-min); min-width: 0; }
.filters { display: flex; flex-wrap: wrap; gap: var(--space-sm); min-width: 0; }
.filters > label { display: grid; gap: var(--space-xs); color: var(--text-body); font-size: var(--font-size-body-sm); min-width: 0; }
.filters select, .search input { width: 100%; max-width: 100%; min-width: 0; }
.result { margin: 0; color: var(--text-muted); font-size: var(--font-size-meta); }
.section { display: grid; gap: var(--section-gap); min-width: 0; }
.section .sectionTitle { margin: 0; font-size: var(--heading-section-size); color: var(--text-strong); font-family: var(--font-display); line-height: var(--line-height-tight); overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--data-grid-min)), 1fr)); gap: var(--space-md); min-width: 0; align-items: stretch; }
.auto { grid-auto-flow: row; }
.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.dataCard { min-block-size: var(--data-card-min-height); display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--panel-padding); }
.cardHeader { display: flex; align-items: start; flex-wrap: wrap; gap: var(--space-xs); }
.cardHeader .cardTitle, .emptyState .cardTitle, .errorState .cardTitle { margin: 0; color: var(--text-strong); font-family: var(--font-display); font-size: var(--heading-card-size); font-weight: var(--font-weight-semibold); line-height: var(--line-height-compact); overflow-wrap: anywhere; }
.cardHeader .cardTitle { flex: 1 1 var(--dropdown-min); }
.cardDescription { margin: 0; color: var(--text-soft); font-size: var(--font-size-body-sm); line-height: var(--line-height-copy); overflow-wrap: anywhere; }
.cardBody { min-width: 0; }
.cardActions { margin-top: auto; padding-top: var(--space-sm); display: flex; flex-wrap: wrap; gap: var(--space-xs); }
.cardActions :global(.btn) { max-width: 100%; white-space: normal; }
.formSection { display: grid; gap: var(--section-gap); margin: 0; padding: var(--panel-padding); }
.formSection legend { padding-inline: var(--space-xs); color: var(--text-strong); font-size: var(--heading-card-size); font-weight: var(--font-weight-semibold); }
.formFields { display: grid; gap: var(--space-md); min-width: 0; }
.emptyState, .errorState { display: grid; gap: var(--space-sm); padding: var(--panel-padding); }
.errorState { border-color: var(--tint-danger-border); background: var(--tint-danger-bg); }
.badge { display: inline-flex; align-items: center; max-width: 100%; padding: var(--space-2xs) var(--space-xs); border: var(--stroke-width) solid var(--border-subtle); border-radius: var(--radius-pill); color: var(--text-soft); background: var(--surface-sunken); font-size: var(--font-size-meta); line-height: var(--line-height-compact); overflow-wrap: anywhere; }
.badge[data-tone="success"] { color: var(--text-on-success); border-color: var(--tint-success-border); background: var(--tint-success-bg); }
.badge[data-tone="warning"] { color: var(--text-on-warning); border-color: var(--tint-warning-border); background: var(--tint-warning-bg); }
.badge[data-tone="danger"] { color: var(--text-on-danger); border-color: var(--tint-danger-border); background: var(--tint-danger-bg); }
.badge[data-tone="info"] { color: var(--c-info); border-color: var(--tint-info-border); background: var(--tint-info-bg); }
.dropdown { position: relative; min-width: 0; }
.dropdownTrigger { list-style: none; gap: var(--space-xs); }
.dropdownTrigger::-webkit-details-marker { display: none; }
.dropdownPanel { position: absolute; inset-inline-end: 0; top: calc(100% + var(--space-xs)); z-index: var(--z-dropdown); display: grid; gap: var(--space-2xs); padding: var(--space-xs); width: max-content; max-width: min(var(--data-grid-min), calc(100vw - var(--page-gutter) * 2)); min-width: min(var(--dropdown-min), calc(100vw - var(--page-gutter) * 2)); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--nav-panel); box-shadow: var(--shadow-md); }
.dropdownItem { padding: var(--space-xs) var(--space-sm); border-radius: var(--control-radius); color: var(--text-body); text-decoration: none; overflow-wrap: anywhere; transition: background-color var(--dur-fast) var(--ease-out); }
.dropdownItem:hover { background: var(--surface-hover); }
.dropdownItem[data-danger="true"] { color: var(--text-on-danger); }
.dropdownItem[aria-disabled="true"] { opacity: var(--opacity-disabled); cursor: not-allowed; }
.skeleton { min-width: 0; display: grid; gap: var(--section-gap); }
.skeletonHeader, .skeletonCard, .skeletonRow { display: grid; align-content: start; gap: var(--space-md); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); padding: var(--panel-padding); }
.skeletonHeader, .skeletonCard { min-block-size: var(--skeleton-card-height); }
.skeletonRows { display: grid; gap: var(--space-xs); }
.skeletonRow { min-block-size: var(--skeleton-row-height); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.skeletonLine { display: block; height: var(--skeleton-line-height); border-radius: var(--control-radius); background: var(--surface-raised); animation: pulse var(--skeleton-duration) var(--ease-in-out) infinite alternate; }
.visuallyHidden { position: absolute; width: var(--stroke-width); height: var(--stroke-width); padding: 0; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.container :where(a, button, input, select, textarea, summary):focus-visible, .dropdownItem:focus-visible { outline: var(--focus-width) solid var(--accent-ring); outline-offset: var(--focus-offset); }
.container :global(.btn):active:not(:disabled) { transform: none; background: var(--accent-soft); }
.container :where(input, select, textarea):disabled { opacity: var(--opacity-disabled); cursor: not-allowed; }
@keyframes pulse { from { opacity: var(--opacity-skeleton-low); } to { opacity: var(--opacity-skeleton-high); } }
@media (max-width: 1000px) {
  .workspace { grid-template-columns: minmax(0, 1fr); }
  .sidebar { position: static; max-height: none; overflow: visible; }
  .sidebar :global(.management-nav) { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .sidebar :global(.management-nav) { grid-template-columns: minmax(0, 1fr); }
  .sidebar :global(.management-nav-links) { display: flex; flex-wrap: wrap; }
  .sidebar :global(.management-nav-links) a small { display: none; }
  .dropdownPanel { inset-inline-start: 0; inset-inline-end: auto; }
  .filters { width: 100%; }
  .filters > label { flex: 1 1 var(--dropdown-min); }
}
@container (max-width: 640px) { .two, .three { grid-template-columns: minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) {
  .skeletonLine { animation: none; }
  .container :where(a, button, summary) { transition: none; }
}

.container :global(.btn) { font-size: var(--font-size-body-sm); }
.container :global(.btn):hover { transform: none; }

.container:global(.app-page) { width: 100%; max-width: var(--page-max); margin-inline: auto; padding: var(--space-lg) var(--page-gutter) var(--space-3xl); }

.container :where(input, select, textarea), .search :global(.ui-field) > label { font-size: var(--font-size-body-sm); }
.notice { display: grid; gap: var(--space-sm); padding: var(--panel-padding); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); min-width: 0; }
.notice[data-tone="warning"] { border-color: var(--tint-warning-border); background: var(--tint-warning-bg); }
.notice[data-tone="danger"] { border-color: var(--tint-danger-border); background: var(--tint-danger-bg); }
.progress { display: block; width: 100%; height: var(--space-sm); border: 0; border-radius: var(--radius-pill); overflow: hidden; accent-color: var(--c-accent-400); background: var(--surface-raised); }
.progress::-webkit-progress-bar { background: var(--surface-raised); }
.progress::-webkit-progress-value { background: var(--c-accent-400); }
.progress::-moz-progress-bar { background: var(--c-accent-400); }
.filterFields { min-width: 0; margin: 0; padding: 0; border: 0; }
```

## src/components/profile/ProfileBattleNetPanel.tsx

```tsx
import type { ProfileOverviewModel } from "@/services/profileOverview";
import ProfileCharactersLiveSection from "@/components/ProfileCharactersLiveSection";
import ProfileCharacterSetup from "@/components/ProfileCharacterSetup";
import ProfileCandidateBulkActions from "@/components/ProfileCandidateBulkActions";
import ProfileCandidateExpiryTimer from "@/components/ProfileCandidateExpiryTimer";
import ProfileCandidateCharacterRow from "@/components/ProfileCandidateCharacterRow";
import PageSection from "@/components/page/PageSection";
import Notice from "@/components/page/Notice";
import FormSection from "@/components/page/FormSection";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";

export default function ProfileBattleNetPanel({ model }: { model: ProfileOverviewModel }) {
  const { profile, canManageCharacters, canViewPrivateProfileBlocks, visibleCharacters, mainCharacter, apiSettings,
    availableCandidates, availableGuildCandidates, availableOtherCandidates, hasAvailableBattleNetCandidates,
    battleNetAction, battleNetCharacterActionHref, battleNetRefreshHref, battleNetLastSyncLabel, profileRulesReturnPath,
    isRulesReturn, bulkFormId } = model;
  return <div id="profile-characters"><PageSection id="profile-characters-title" title="Персонажі Battle.net"
    description={profile.battlenet?.linked ? `Battle.net підключено · синхронізація: ${battleNetLastSyncLabel}` : "Персонажі, мейн і спеціалізації профілю."}
    actions={canManageCharacters ? <a className="btn primary" href={battleNetCharacterActionHref}>{battleNetAction.title}</a> : null}>
    <PageErrorBoundary resetKey={profile.profileId}><ProfileCharactersLiveSection profileId={profile.profileId} initialCharacters={visibleCharacters}
      initialUpdatedAt={profile.battlenet?.lastProfileViewRefreshAt || profile.battlenet?.lastCharacterRefreshAt || profile.battlenet?.lastSyncAt || profile.updatedAt || profile.lastLoginAt || mainCharacter?.lastSeenAt || null}
      canManage={canManageCharacters} showMainBadge={canViewPrivateProfileBlocks} returnTo={profileRulesReturnPath}
      candidateCount={availableCandidates.length} emptyMessage={canManageCharacters ? "Підключи Battle.net і додай персонажів." : "Учасник ще не додав персонажів."}
      refreshMinMs={apiSettings.profileViewRefreshMinSeconds * 1000} /></PageErrorBoundary>
    {canManageCharacters && !hasAvailableBattleNetCandidates && profile.battlenet?.linked ? <Notice title="Додавання нових персонажів"
      actions={<a className="btn subtle" href={battleNetRefreshHref}>Оновити список Battle.net</a>}>
      Онови список Battle.net, щоб знайти інших або оновлених персонажів. Уже додані персонажі залишаються у профілі.
    </Notice> : null}
    {canManageCharacters && !isRulesReturn && (profile.characters.length > 0 || hasAvailableBattleNetCandidates)
      ? <FormSection title="Склад персонажів"><PageErrorBoundary resetKey={profile.profileId}><ProfileCharacterSetup key={profile.profileId} profileId={profile.profileId} /></PageErrorBoundary></FormSection> : null}
    {canManageCharacters && isRulesReturn && hasAvailableBattleNetCandidates ? <div id="profile-candidates" className="profile-candidates-box" data-profile-candidates-box="true">
      <FormSection title="Додати персонажів" description="Вибери потрібних гільдійних або інших персонажів для профілю.">
        <div className="profile-candidate-counter"><span className="profile-count-pill" data-profile-candidate-count="true">{availableCandidates.length}</span>
          {profile.battlenet?.candidateExpiresAt ? <ProfileCandidateExpiryTimer expiresAt={profile.battlenet.candidateExpiresAt} /> : null}</div>
        <form id={bulkFormId} className="profile-candidate-bulk-form" action="/api/profile/characters/bulk-add" method="post">
          {profileRulesReturnPath ? <input type="hidden" name="returnTo" value={profileRulesReturnPath} /> : null}
        </form>
        <ProfileCandidateBulkActions formId={bulkFormId} count={availableCandidates.length} />
        {availableGuildCandidates.length ? <section className="profile-candidate-group" aria-label="Гільдійні кандидати"><strong>Гільдійні · {availableGuildCandidates.length}</strong>
          <ul className="profile-character-candidates">{availableGuildCandidates.map(character => <ProfileCandidateCharacterRow key={character.key} character={character} bulkFormId={bulkFormId} />)}</ul></section> : null}
        {availableOtherCandidates.length ? <section className="profile-candidate-group" aria-label="Інші кандидати"><strong>Інші · {availableOtherCandidates.length}</strong>
          <ul className="profile-character-candidates">{availableOtherCandidates.map(character => <ProfileCandidateCharacterRow key={character.key} character={character} bulkFormId={bulkFormId} />)}</ul></section> : null}
      </FormSection>
    </div> : null}
  </PageSection></div>;
}
```

## src/components/profile/ProfileOverviewView.tsx

```tsx
import Link from "next/link";
import type { ProfileOverviewModel } from "@/services/profileOverview";
import DashboardIdentity from "@/components/DashboardIdentity";
import ListReturnLink from "@/components/ListReturnLink";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { canViewGuildRoster, canViewProfiles } from "@/lib/permissions";
import { wowRoleLabel } from "@/lib/wowRoles";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import Notice from "@/components/page/Notice";
import ProfileSidebar from "./ProfileSidebar";
import ProfileBattleNetPanel from "./ProfileBattleNetPanel";
import ProfileRaidSignups from "./ProfileRaidSignups";

export default function ProfileOverviewView(model: ProfileOverviewModel) {
  const { viewer, profile, query, isOwnProfile, isRulesReturn, settingsRulesReturnPath, rulesReviewPath,
    mainCharacter, selectedRaidRole, canViewPrivateProfileBlocks, profileGuildCharacterCount, publicNamePreview,
    guildStatus, raidSignups, profileAvatarUrl, storageWarning } = model;
  const settingsHref = settingsRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}/settings`;
  return <PageContainer label={isOwnProfile ? "Мій профіль" : "Профіль учасника"} navigation={<DashboardIdentity user={viewer} activeSection="profile" />}
    sidebar={<ProfileSidebar profileId={profile.profileId} name={publicNamePreview} avatar={profileAvatarUrl} status={guildStatus} role={wowRoleLabel(selectedRaidRole)}
      characterCount={profile.characters.length} guildCharacterCount={profileGuildCharacterCount} mainName={mainCharacter?.name} linked={Boolean(profile.battlenet?.linked)}
      isOwnProfile={isOwnProfile} canViewPrivate={canViewPrivateProfileBlocks} active="overview" settingsHref={settingsHref} overviewHref={model.profileRulesReturnPath} accountLabel={model.accountStatusLabel} />}>
    {!isRulesReturn && query.from === "guild" && canViewGuildRoster(viewer) ? <ListReturnLink kind="guild" scope={listNavigationScope(viewer)} />
      : !isRulesReturn && canViewProfiles(viewer) ? <ListReturnLink kind="profiles" scope={listNavigationScope(viewer)} /> : null}
    <div id="profile-overview"><PageHeader title={isOwnProfile ? "Мій профіль" : "Профіль учасника"} eyebrow="Mistblossom Vanguard"
      description={publicNamePreview} breadcrumbs={[{ label: "Профіль" }]}
      actions={isOwnProfile ? <Link href={settingsHref} className="btn primary">Налаштування профілю</Link> : null}
      metrics={[{ label: "Мейн", value: mainCharacter?.name || "Не вибрано" }, { label: "Роль у рейді", value: wowRoleLabel(selectedRaidRole) }, { label: "Група", value: profile.groupName || guildStatus }, { label: "Персонажі", value: profile.characters.length }]} /></div>
    {storageWarning ? <Notice title="Тимчасові дані" tone="warning">{storageWarning}</Notice> : null}
    {rulesReviewPath ? <Notice title="Завершення реєстрації" actions={<Link className="btn subtle" href={rulesReviewPath}>Повернутись до правил</Link>}>
      Перевір персонажів і мейна, потім повернись до прийняття правил.
    </Notice> : null}
    {!isOwnProfile && canViewPrivateProfileBlocks ? <Notice title="Перегляд профілю">Змінювати персонажів і підключення може лише власник профілю.</Notice> : null}
    <ProfileBattleNetPanel model={model} />
    {canViewPrivateProfileBlocks ? <ProfileRaidSignups items={raidSignups} unavailable={model.raidSignupsUnavailable} /> : null}
  </PageContainer>;
}
```

## src/components/profile/ProfileRaidSignups.tsx

```tsx
import Link from "next/link";
import type { ProfileRaidSignup } from "@/lib/raids";
import { raidDisplayCapacity, raidAutoCompositionLabel, raidTitle, raidDifficultyLabel } from "@/lib/raids";
import { profileGenderedText } from "@/lib/profiles";
import { wowRoleLabel } from "@/lib/wowRoles";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import StatusBadge, { type StatusTone } from "@/components/page/StatusBadge";
import styles from "./profile-workspace.module.css";

function SignupCard({ item }: { item: ProfileRaidSignup }) {
  const status = item.signup.status;
  const label = status === "going" ? profileGenderedText(item.signup.grammaticalGender, "Підписаний", "Підписана", "Підписали")
    : status === "tentative" ? "50/50" : status === "late" ? "Затримаюсь" : "Пропускає";
  const tone: StatusTone = status === "going" ? "success" : status === "tentative" ? "warning" : status === "late" ? "info" : "neutral";
  const active = item.raid.signups.filter(signup => ["going", "tentative", "late"].includes(signup.status)).length;
  return <DataCard title={raidTitle(item.raid)} description={`${[item.raid.date, item.raid.time].filter(Boolean).join(", ") || "Дата уточнюється"} · ${raidDifficultyLabel(item.raid.difficulty)}`}
    badge={<StatusBadge tone={tone}>{label}</StatusBadge>}
    actions={<Link className="btn subtle" href={`/raids/${encodeURIComponent(item.raid.id)}`} prefetch={false}>Відкрити рейд</Link>}>
    <dl className={styles.facts}>
      <div><dt>Порядок запису</dt><dd>{item.signup.signupNumber ? `#${item.signup.signupNumber}` : "—"}</dd></div>
      <div><dt>Персонаж</dt><dd>{[item.signup.characterName || item.signup.discordName || "Без персонажа", item.signup.realmName || item.signup.realmSlug].filter(Boolean).join(" · ")}</dd></div>
      <div><dt>Роль і спеціалізація</dt><dd>{[wowRoleLabel(item.signup.role), item.signup.activeSpecName, item.signup.className].filter(Boolean).join(" · ")}</dd></div>
      <div><dt>Склад</dt><dd>{active} / {raidDisplayCapacity(item.raid)} · {raidAutoCompositionLabel(item.raid)}</dd></div>
    </dl>
  </DataCard>;
}
export default function ProfileRaidSignups({ items, unavailable = false }: { items: ProfileRaidSignup[]; unavailable?: boolean }) {
  const active = items.filter(item => ["going", "tentative", "late"].includes(item.signup.status));
  const skipped = items.filter(item => item.signup.status === "skipped");
  return <div id="profile-raids"><PageSection id="profile-raids-title" title="Рейдові записи" description="Поточні записи, роль і статус участі. Керування записом відбувається через Discord.">
    {unavailable ? <ErrorState title="Рейдові записи тимчасово недоступні" description="Не вдалося отримати записи. Спробуй оновити дані." actions={<PageRefreshButton />} />
      : active.length ? <DataGrid label="Поточні рейдові записи">{active.map(item => <SignupCard key={`${item.raid.id}-${item.signup.discordId}`} item={item} />)}</DataGrid>
      : <EmptyState title="Немає активних записів" description="Запис через Discord зʼявиться тут після збереження."
        actions={<Link href="/raids" className="btn subtle">Переглянути рейди</Link>} />}
    {skipped.length ? <details><summary>Пропущені рейди: {skipped.length}</summary><DataGrid label="Пропущені рейди">{skipped.map(item => <SignupCard key={`${item.raid.id}-${item.signup.discordId}`} item={item} />)}</DataGrid></details> : null}
  </PageSection></div>;
}
```

## src/components/profile/ProfileSidebar.tsx

```tsx
import Link from "next/link";
import ProfileAvatar from "@/components/ProfileAvatar";
import LogoutButton from "@/components/LogoutButton";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "./profile-workspace.module.css";

export type ProfileSidebarProps = {
  profileId: string;
  name: string;
  avatar?: string | null;
  status: string;
  role: string;
  accountLabel?: string;
  characterCount: number;
  guildCharacterCount?: number;
  mainName?: string;
  linked: boolean;
  isOwnProfile: boolean;
  canViewPrivate: boolean;
  active: "overview" | "settings";
  settingsHref?: string;
  overviewHref?: string;
};
export default function ProfileSidebar(props: ProfileSidebarProps) {
  const base = `/profile/${encodeURIComponent(props.profileId)}`;
  const overview = props.overviewHref || base;
  return <div className={styles.sidebar}>
    <div className={styles.identity}>
      <ProfileAvatar src={props.avatar} width={80} height={80} className={styles.avatar} fallbackClassName={styles.avatar} />
      <strong>{props.name}</strong>{props.accountLabel ? <small>{props.accountLabel}</small> : null}<div className={styles.inline}><StatusBadge>{props.status}</StatusBadge><StatusBadge>{props.role}</StatusBadge></div>
    </div>
    <dl className={styles.facts}>
      <div><dt>Персонажі</dt><dd>{props.characterCount}</dd></div>
      {props.guildCharacterCount !== undefined ? <div><dt>У гільдії</dt><dd>{props.guildCharacterCount}</dd></div> : null}
      <div><dt>Мейн</dt><dd>{props.mainName || "Не вибрано"}</dd></div>
      <div><dt>Battle.net</dt><dd>{props.linked ? "Підключено" : "Не підключено"}</dd></div>
    </dl>
    <nav className={styles.navigation} aria-label="Розділи профілю">
      <Link href={overview} aria-current={props.active === "overview" ? "page" : undefined}>Огляд</Link>
      <Link href={`${overview}#profile-characters`}>Персонажі</Link>
      {props.canViewPrivate ? <Link href={`${overview}#profile-raids`}>Рейдові записи</Link> : null}
      {props.isOwnProfile ? <Link href={props.settingsHref || `${base}/settings`} aria-current={props.active === "settings" ? "page" : undefined}>Налаштування</Link> : null}
    </nav>
    {props.isOwnProfile ? <LogoutButton className={styles.logout} buttonClassName="btn subtle" /> : null}
  </div>;
}
```

## src/components/profile/directory/DiscordRaidPreferences.tsx

```tsx
import type { listRaidDiscordPreferences } from "@/lib/raidDiscordPresets";
import { wowSpecFullName } from "@/lib/wowClassCatalog";
import DataTable from "@/components/ui/DataTable";
import EmptyState from "@/components/page/EmptyState";
import { profileDirectoryDate } from "./ProfileDirectoryTable";

export default function DiscordRaidPreferences({ items }: { items: Awaited<ReturnType<typeof listRaidDiscordPreferences>> }) {
  return <details><summary>Налаштування записів через Discord ({items.length})</summary>
    <p>Класи, спеціалізації й нагадування привʼязані до Discord ID та не є каталогом вебпрофілів.</p>
    {items.length ? <DataTable caption="Налаштування Discord-записів" headings={["Учасник", "Клас / спеціалізація", "Статус", "Нагадування", "Вибори", "Оновлено"]}>
      {items.map(item => <tr key={item.discordId}><th scope="row">{item.displayName}<small>{item.discordId}</small></th>
        <td>{item.lastClassKey ? wowSpecFullName(item.lastClassKey, item.lastSpecKey) : "Не вибрано"}</td><td>{item.lastStatus}</td>
        <td>{item.reminderEnabled ? "Увімкнено" : "Вимкнено"}</td><td>{item.presets.map(preset => `${wowSpecFullName(preset.classKey, preset.specKey)} ×${preset.count}`).join(" · ") || "—"}</td>
        <td>{profileDirectoryDate(item.updatedAt)}</td></tr>)}
    </DataTable> : <EmptyState title="Збережених налаштувань немає" description="Вони зʼявляються після першого вибору в Discord-меню рейду." />}
  </details>;
}
```

## src/components/profile/directory/ProfileDirectoryFilters.tsx

```tsx
import Link from "next/link";
import type { ProfileDirectoryFilters as Filters } from "@/lib/profileDirectoryNavigation";
import FilterNavigationForm from "@/components/page/FilterNavigationForm";
import FilterToolbar from "@/components/page/FilterToolbar";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";

export default function ProfileDirectoryFilters({ filters, total }: { filters: Filters; total: number }) {
  const active = Boolean(filters.query || filters.link !== "all" || filters.role !== "all" || filters.sort !== "activity");
  return <FilterNavigationForm action="/profiles"><FilterToolbar label="Пошук і фільтри профілів"
    search={<FormField id="profile-directory-search" label="Пошук учасника" name="q" type="search" maxLength={120} defaultValue={filters.query} placeholder="Імʼя, Discord, персонаж або реалм" />}
    filters={<>
      <label>Battle.net<select name="link" defaultValue={filters.link}><option value="all">Усі</option><option value="linked">Підключено</option><option value="unlinked">Не підключено</option></select></label>
      <label>Роль<select name="role" defaultValue={filters.role}><option value="all">Усі ролі</option><option value="admin">Адмін</option><option value="moderator">Офіцер</option><option value="mentor">Наставник</option><option value="member">Учасник</option></select></label>
      <label>Сортування<select name="sort" defaultValue={filters.sort}><option value="activity">За активністю</option><option value="name">За іменем</option><option value="characters">За персонажами</option></select></label>
    </>}
    actions={<><Button tone="primary" type="submit">Застосувати</Button>{active ? <Link className="btn subtle" href="/profiles?view=all" data-list-reset-position>Скинути</Link> : null}</>}
    result={`Знайдено профілів: ${total}`} /></FilterNavigationForm>;
}
```

## src/components/profile/directory/ProfileDirectoryTable.tsx

```tsx
import Link from "next/link";
import type { DashboardProfile } from "@/lib/profiles";
import { getMainCharacter, getProfilePublicName } from "@/lib/profiles";
import { guildStatusLabel, dashboardRoleLabel } from "@/lib/permissions";
import { listEntryId } from "@/lib/listViewState";
import ProfileAvatar from "@/components/ProfileAvatar";
import DataTable from "@/components/ui/DataTable";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "./directory.module.css";

export function profileDirectoryDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
export default function ProfileDirectoryTable({ profiles, avatars }: { profiles: DashboardProfile[]; avatars: Map<string, string> }) {
  return <DataTable caption="Список доступних профілів" headings={["Учасник", "Група / роль", "Мейн", "Персонажі", "Battle.net", "Активність"]}
    className={styles.area} tableClassName={styles.table}>
    {profiles.map(profile => {
      const name = getProfilePublicName(profile), main = getMainCharacter(profile);
      return <tr key={profile.profileId} id={listEntryId("profiles", profile.profileId)} data-list-entry="profiles">
        <th scope="row" data-label="Учасник"><Link className={styles.identity} href={`/profile/${profile.profileId}`} prefetch={false} aria-label={`Відкрити профіль: ${name}`}>
          <ProfileAvatar src={avatars.get(profile.providerUserId) || profile.avatarUrl} width={40} height={40} className={styles.avatar} fallbackClassName={styles.avatar} />
          <span><strong>{name}</strong><small>{profile.login ? `@${profile.login}` : `Discord · ${profile.providerUserId}`}</small></span>
        </Link></th>
        <td data-label="Група / роль"><strong>{profile.groupName || guildStatusLabel(profile.role)}</strong><small>{dashboardRoleLabel(profile.role)}</small></td>
        <td data-label="Мейн"><strong>{main?.name || "Не вибрано"}</strong><small>{[main?.realmName || main?.realmSlug, main?.className, main?.activeSpecName].filter(Boolean).join(" · ") || "Персонажа не призначено"}</small></td>
        <td data-label="Персонажі">{profile.characters.length}</td>
        <td data-label="Battle.net"><StatusBadge tone={profile.battlenet?.linked ? "success" : "neutral"}>{profile.battlenet?.linked ? "Підключено" : "Не підключено"}</StatusBadge>
          {profile.battlenet?.linked ? <small>Синхр. {profileDirectoryDate(profile.battlenet.lastSyncAt || profile.battlenet.lastConnectedAt)}</small> : null}</td>
        <td data-label="Активність"><time dateTime={profile.lastLoginAt || profile.updatedAt || undefined}>{profileDirectoryDate(profile.lastLoginAt || profile.updatedAt)}</time><small>{profile.lastLoginAt ? "Останній вхід" : "Оновлення профілю"}</small></td>
      </tr>;
    })}
  </DataTable>;
}
```

## src/components/profile/directory/ProfileDirectoryView.tsx

```tsx
import Link from "next/link";
import type { ProfileDirectoryModel } from "@/services/profileDirectory";
import { buildProfilesHref } from "@/lib/profileDirectoryNavigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import ListViewMemory from "@/components/ListViewMemory";
import { listNavigationScope } from "@/lib/listNavigationScope";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import ProfileDirectoryFilters from "./ProfileDirectoryFilters";
import ProfileDirectoryTable from "./ProfileDirectoryTable";
import DiscordRaidPreferences from "./DiscordRaidPreferences";
import styles from "./directory.module.css";

export default function ProfileDirectoryView(model: ProfileDirectoryModel) {
  const { user, params, filters, result, profiles, total, characterCount, linkedBattleNetCount, liveDiscordAvatars, canManageCleanup, raidPreferences, hasFilters } = model;
  const currentUrl = buildProfilesHref({ ...filters, cursor: result.cursorReset || result.unavailable ? null : params.cursor });
  return <PageContainer label="Профілі учасників" navigation={<DashboardIdentity user={user} activeSection="profiles" />}>
    <PageHeader title="Профілі учасників" description="Мейни, персонажі, Battle.net та активність учасників. Пошук охоплює весь доступний каталог."
      breadcrumbs={[{ label: "Керування", href: "/dashboard" }, { label: "Профілі" }]}
      actions={canManageCleanup ? <Link className="btn subtle" href="/dashboard/profiles">Аудит та очищення</Link> : null}
      metrics={[{ label: "Профілі", value: total }, { label: "Персонажі", value: characterCount }, { label: "Battle.net підключено", value: linkedBattleNetCount }]} />
    <ProfileDirectoryFilters key={buildProfilesHref(filters)} filters={filters} total={total} />
    <ListViewMemory key={listNavigationScope(user)} kind="profiles" scope={listNavigationScope(user)} currentUrl={currentUrl} restorePosition={!result.cursorReset && !result.unavailable} />
    <PageSection id="profile-directory-results" title="Учасники" description={total ? `${result.start}–${result.end} із ${total}` : "Доступні профілі за поточними фільтрами."}>
      {result.unavailable ? <ErrorState title="Каталог тимчасово недоступний" description="Не вдалося прочитати профілі. Фільтри збережено в адресі сторінки." actions={<PageRefreshButton />} />
        : profiles.length ? <ProfileDirectoryTable profiles={profiles} avatars={liveDiscordAvatars} />
        : <EmptyState title={hasFilters ? "Нічого не знайдено" : "Профілів ще немає"} description={hasFilters ? "Зміни пошук або скинь фільтри." : "Профіль зʼявиться після входу учасника через Discord."}
            actions={hasFilters ? <Link className="btn subtle" href="/profiles?view=all" data-list-reset-position>Очистити фільтри</Link> : null} />}
      {!result.unavailable && total > 0 ? <nav className={styles.pagination} aria-label="Навігація сторінками профілів">
        {result.previousCursor ? <Link className="btn subtle" rel="prev" href={buildProfilesHref({ ...filters, cursor: result.previousCursor })} prefetch={false}>← Назад</Link> : <span className="btn subtle is-disabled" aria-disabled="true">← Назад</span>}
        <span>{result.start}–{result.end} із {total}</span>
        {result.nextCursor ? <Link className="btn subtle" rel="next" href={buildProfilesHref({ ...filters, cursor: result.nextCursor })} prefetch={false}>Далі →</Link> : <span className="btn subtle is-disabled" aria-disabled="true">Далі →</span>}
      </nav> : null}
    </PageSection>
    <DiscordRaidPreferences items={raidPreferences} />
  </PageContainer>;
}
```

## src/components/profile/directory/directory.module.css

```css
.area { min-width: 0; container-type: inline-size; }
.table { width: 100%; table-layout: fixed; }
.table :is(th, td) { font-size: var(--font-size-body-sm); font-weight: var(--font-weight-ui); }
.table small { display: block; margin-top: var(--space-2xs); color: var(--text-muted); line-height: var(--line-height-body); font-size: var(--font-size-meta); }
.identity { display: flex; gap: var(--space-xs); color: var(--text-body); text-decoration: none; min-width: 0; align-items: start; }
.identity > span { min-width: 0; overflow-wrap: anywhere; }
.identity:hover strong { color: var(--c-accent-300); }
.avatar { border-radius: var(--control-radius); object-fit: cover; flex: none; background: var(--surface-raised); }
.pagination { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: var(--space-sm); }
@container (max-width: 800px) {
  .table { display: block; }
  .table thead { position: absolute; width: var(--stroke-width); height: var(--stroke-width); overflow: hidden; clip-path: inset(50%); }
  .table tbody { display: grid; }
  .table tr { display: grid; padding: var(--space-sm); border-bottom: var(--stroke-width) solid var(--border); }
  .table :is(th, td) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-sm); border: 0; padding: var(--space-xs); }
  .table :is(th, td)::before { content: attr(data-label); color: var(--text-muted); font-size: var(--font-size-meta); font-weight: var(--font-weight-medium); }
  .table :is(th, td) > small { grid-column: 2; }
}
```

## src/components/profile/profile-workspace.module.css

```css
.sidebar { display: grid; gap: var(--space-md); padding: var(--panel-padding); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); min-width: 0; }
.identity { display: grid; justify-items: start; gap: var(--space-sm); overflow-wrap: anywhere; }
.avatar { border-radius: var(--card-radius); object-fit: cover; background: var(--surface-raised); }
.identity > small { color: var(--text-muted); font-size: var(--font-size-meta); }
.inline { display: flex; gap: var(--space-xs); flex-wrap: wrap; align-items: center; }
.facts { display: grid; gap: var(--space-sm); margin: 0; }
.facts > div { display: grid; gap: var(--space-2xs); padding-top: var(--space-xs); border-top: var(--stroke-width) solid var(--border-subtle); }
.facts dt { color: var(--text-muted); font-size: var(--font-size-meta); }
.facts dd { margin: 0; color: var(--text-body); overflow-wrap: anywhere; }
.navigation { display: grid; gap: var(--space-2xs); }
.navigation a { padding: var(--space-sm); border: var(--stroke-width) solid transparent; border-radius: var(--control-radius); color: var(--text-body); text-decoration: none; transition: background-color var(--dur-fast) var(--ease-out); }
.navigation a:hover { background: var(--surface-hover); }
.navigation a[aria-current="page"] { background: var(--accent-soft); border-color: var(--border-strong); }
.logout :global(.btn) { width: 100%; }
.stack { display: grid; gap: var(--section-gap); min-width: 0; }
.fields { display: grid; gap: var(--space-md); grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); }
.field { display: grid; gap: var(--space-xs); min-width: 0; color: var(--text-body); font-size: var(--font-size-body-sm); }
.field :is(input, select) { max-width: 100%; min-width: 0; }
.field small, .hint { color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-copy); }
.option { display: flex; gap: var(--space-sm); align-items: start; padding: var(--space-sm); border: var(--stroke-width) solid var(--border); border-radius: var(--control-radius); background: var(--surface-sunken); }
.option:has(input:checked) { border-color: var(--border-strong); background: var(--accent-soft); }
.option > span { display: grid; gap: var(--space-2xs); min-width: 0; }
.option small { color: var(--text-soft); line-height: var(--line-height-body); }
.option input { flex: none; }
.steps { display: grid; gap: var(--space-xs); margin: 0; padding: 0; list-style: none; }
.steps a { display: grid; gap: var(--space-2xs); color: var(--text-body); padding: var(--space-sm); border: var(--stroke-width) solid var(--border); border-radius: var(--control-radius); text-decoration: none; }
.steps small { color: var(--text-soft); }
@media (max-width: 1000px) { .identity { grid-template-columns: auto minmax(0, 1fr); align-items: center; } .identity > small { grid-column: 2; } .identity > div { grid-column: 1 / -1; } .facts { grid-template-columns: repeat(2, minmax(0, 1fr)); } .navigation { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

## src/components/profile/settings/NicknameSelection.tsx

```tsx
"use client";
import { useState } from "react";
import Button from "@/components/ui/Button";
import styles from "../profile-workspace.module.css";

export type NicknameChoice = { key: string; name: string; detail: string };
export default function NicknameSelection({ choices, selected, returnTo }: { choices: NicknameChoice[]; selected: string[]; returnTo?: string }) {
  const [keys, setKeys] = useState(() => selected.filter(key => choices.some(choice => choice.key === key)).slice(0, 2));
  return <form className={styles.stack} action="/api/profile/nickname-characters" method="post">
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <p className={styles.hint} role="status" aria-live="polite">Вибрано {keys.length} із 2 альтів. Мейн додається автоматично.</p>
    {choices.map(choice => <label className={styles.option} key={choice.key}>
      <input type="checkbox" name="nicknameCharacterKeys" value={choice.key} checked={keys.includes(choice.key)}
        disabled={keys.length >= 2 && !keys.includes(choice.key)} onChange={event => setKeys(current => event.target.checked ? [...current, choice.key].slice(0, 2) : current.filter(key => key !== choice.key))} />
      <span><strong>{choice.name}</strong><small>{choice.detail}</small></span>
    </label>)}
    <Button type="submit" tone="primary">Зберегти альтів для ніку</Button>
  </form>;
}
```

## src/components/profile/settings/ProfileCompletion.tsx

```tsx
import type { profileSettingsSetupStatus } from "@/lib/profiles";
import PageSection from "@/components/page/PageSection";
import Progress from "@/components/page/Progress";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "../profile-workspace.module.css";

export default function ProfileCompletion({ status }: { status: ReturnType<typeof profileSettingsSetupStatus> }) {
  const completed = status.steps.filter(step => step.complete).length;
  return <PageSection id="profile-completion-title" title="Стан заповнення профілю" description={status.complete ? "Реєстраційні дані заповнені." : `Потрібно доповнити: ${status.missing.map(step => step.title).join(", ")}.`}>
    <Progress value={completed} max={status.steps.length} label={`Заповнено ${completed} з ${status.steps.length}`} />
    <ul className={styles.steps}>
      {status.steps.map(step => <li key={step.key}><a href={step.key === "profile_gender" ? "#profile-gender-settings" : "#profile-name-settings"}>
        <StatusBadge tone={step.complete ? "success" : "warning"}>{step.complete ? "Готово" : "Потрібна дія"}</StatusBadge>
        <strong>{step.title}</strong><small>{step.description}</small>
      </a></li>)}
    </ul>
  </PageSection>;
}
```

## src/components/profile/settings/ProfilePreferences.tsx

```tsx
import type { DashboardProfile, ProfileCharacter, ProfileGrammaticalGender } from "@/lib/profiles";
import { getMainCharacter, buildProfileDiscordNicknamePlan } from "@/lib/profiles";
import { resolveWowCharacterRole, wowRoleLabel, type WowCharacterRole } from "@/lib/wowRoles";
import FormSection from "@/components/page/FormSection";
import EmptyState from "@/components/page/EmptyState";
import Button from "@/components/ui/Button";
import NicknameSelection from "./NicknameSelection";
import styles from "../profile-workspace.module.css";

export function ProfileGenderPreferenceForm({ value, returnTo = "" }: { value?: ProfileGrammaticalGender | null; returnTo?: string }) {
  const options = [
    { value: "male", title: "Чоловіча форма", example: "Підписаний" },
    { value: "female", title: "Жіноча форма", example: "Підписана" },
    { value: "neutral", title: "Нейтральне звертання", example: "Підписали" },
    { value: "nonbinary", title: "Небінарна особа", example: "Підписали" },
  ];
  return <form action="/api/profile/gender" method="post">
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <FormSection title="Форма звертання" description="Використовується у персональних текстах, рейдах і Discord."
      actions={<Button type="submit" tone="primary">Зберегти звертання</Button>}>
      {options.map(option => <label className={styles.option} key={option.value}>
        <input type="radio" name="grammaticalGender" value={option.value} defaultChecked={value === option.value} required />
        <span><strong>{option.title}</strong><small>Приклад: {option.example}</small></span>
      </label>)}
    </FormSection>
  </form>;
}

export function RaidRolePreferenceForm({ mainCharacter, manualRole, selectedRole, returnTo = "" }: {
  mainCharacter?: ProfileCharacter | null;
  manualRole?: WowCharacterRole | null;
  selectedRole: WowCharacterRole;
  returnTo?: string;
}) {
  if (!mainCharacter) return <EmptyState title="Спочатку вибери мейна" description="Після додавання мейна можна буде уточнити роль для рейдів." />;
  const autoRole = resolveWowCharacterRole(mainCharacter);
  const options: Array<{ value: "auto" | WowCharacterRole; label: string }> = [
    { value: "auto", label: `Авто: ${wowRoleLabel(autoRole)}` }, { value: "tank", label: "Танк" },
    { value: "healer", label: "Хіл" }, { value: "dps", label: "ДД" },
  ];
  return <form action="/api/profile/raid-role" method="post">
    {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
    <FormSection title="Роль у рейді" description={`${mainCharacter.name} · поточна роль: ${wowRoleLabel(selectedRole)}. Авто бере роль зі спеціалізації мейна.`}
      actions={<Button type="submit" tone="primary">Зберегти роль</Button>}>
      {options.map(option => <label className={styles.option} key={option.value}>
        <input type="radio" name="raidRole" value={option.value} defaultChecked={option.value === "auto" ? !manualRole : manualRole === option.value} />
        <span><strong>{option.label}</strong></span>
      </label>)}
    </FormSection>
  </form>;
}

export function NicknameCharactersForm({ profile, nicknameTemplate, returnTo = "" }: { profile: DashboardProfile; nicknameTemplate: string; returnTo?: string }) {
  const main = getMainCharacter(profile);
  const choices = profile.characters.filter(character => character.key !== main?.key).sort((a, b) => Number(b.verifiedGuild) - Number(a.verifiedGuild) || a.name.localeCompare(b.name, "uk"))
    .map(character => ({ key: character.key, name: character.name, detail: [character.realmName || character.realmSlug, character.activeSpecName, character.className, character.verifiedGuild ? "Гільдійний" : "Інший"].filter(Boolean).join(" · ") }));
  const plan = buildProfileDiscordNicknamePlan(profile, nicknameTemplate);
  return <FormSection title="Альти у Discord-ніку" description={`Попередній вигляд: ${plan.value || "Спочатку вкажи імʼя"}. Формат: ${nicknameTemplate}`}>
    {choices.length ? <NicknameSelection choices={choices} selected={(profile.nicknameCharacterKeys || []).filter(key => key !== main?.key)} returnTo={returnTo} />
      : <EmptyState title="Немає альтів для вибору" description="Додай інших персонажів у профілі. Мейн додається у Discord-нік автоматично." />}
  </FormSection>;
}
```

## src/components/profile/settings/ProfileSettingsView.tsx

```tsx
import Link from "next/link";
import type { ProfileSettingsModel } from "@/services/profileSettings";
import DashboardIdentity from "@/components/DashboardIdentity";
import ProfileNameControls from "@/components/ProfileNameControls";
import RaidReminderPreferenceControls from "@/components/RaidReminderPreferenceControls";
import ListReturnLink from "@/components/ListReturnLink";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { canViewProfiles } from "@/lib/permissions";
import { wowRoleLabel } from "@/lib/wowRoles";
import { profileGenderLabel } from "@/lib/profiles";
import { formatStableUkCompactDate } from "@/lib/stableUiText";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import FormSection from "@/components/page/FormSection";
import Notice from "@/components/page/Notice";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import ProfileSidebar from "../ProfileSidebar";
import ProfileCompletion from "./ProfileCompletion";
import { ProfileGenderPreferenceForm, RaidRolePreferenceForm, NicknameCharactersForm } from "./ProfilePreferences";

export default function ProfileSettingsView(model: ProfileSettingsModel) {
  const { session, profile, isRulesReturn, settingsRulesReturnPath, profileRulesReturnPath, rulesReviewPath, mainCharacter,
    manualRaidRole, selectedRaidRole, publicNamePreview, serverStyleNamePreview, discordNicknamePreview,
    discordMemberReadable, canSyncDiscordNickname, discordOwnerLocked, currentServerNickname, liveDiscordMember,
    setupStatus, settingsPageTitle, guildStatus, storageWarning, nicknamePolicy } = model;
  const profileHref = profileRulesReturnPath || `/profile/${encodeURIComponent(profile.profileId)}`;
  return <PageContainer label={settingsPageTitle} navigation={<DashboardIdentity user={session} activeSection="profile" />}
    sidebar={<ProfileSidebar profileId={profile.profileId} name={publicNamePreview} avatar={liveDiscordMember?.avatarUrl || profile.avatarUrl}
      status={guildStatus} role={wowRoleLabel(selectedRaidRole)} characterCount={profile.characters.length} mainName={mainCharacter?.name}
      linked={Boolean(profile.battlenet?.linked)} isOwnProfile canViewPrivate active="settings" settingsHref={settingsRulesReturnPath} overviewHref={profileHref} />}>
    {!isRulesReturn && canViewProfiles(session) ? <ListReturnLink kind="profiles" scope={listNavigationScope(session)} /> : null}
    <div id="profile-settings-overview"><PageHeader title={settingsPageTitle} eyebrow="Mistblossom Vanguard"
      description="Імʼя, звертання, Discord-нік і роль у рейдах. Кожна форма зберігається окремо."
      breadcrumbs={[{ label: "Профіль", href: profileHref }, { label: "Налаштування" }]}
      actions={<Link href={profileHref} className="btn subtle">Відкрити профіль</Link>}
      metrics={[{ label: "Публічне імʼя", value: publicNamePreview }, { label: "Discord-нік", value: discordNicknamePreview || "Не сформовано" }, { label: "Звертання", value: profileGenderLabel(profile.grammaticalGender) }]} /></div>
    {storageWarning ? <Notice title="Тимчасові дані" tone="warning">{storageWarning}</Notice> : null}
    {rulesReviewPath ? <Notice title="Завершення реєстрації" actions={<Link href={rulesReviewPath} className="btn subtle">Повернутись до правил</Link>}>
      Заповни обовʼязкові поля й повернись до перевірки правил. Посилання прийняття збережено.
    </Notice> : null}
    <ProfileCompletion status={setupStatus} />
    <PageSection id="profile-personal-title" title="Особисті дані">
      <div id="profile-name-settings"><FormSection title="Імʼя та відображення">
        <PageErrorBoundary resetKey={profile.profileId}><ProfileNameControls identityProfileId={profile.profileId}
          preferredName={profile.preferredName} publicNameMode={profile.publicNameMode} discordName={profile.displayName}
          publicNamePreview={publicNamePreview} serverStyleNamePreview={serverStyleNamePreview} nicknamePreview={discordNicknamePreview}
          lastSyncedNickname={profile.discordNickname?.value} lastSyncedAt={profile.discordNickname?.syncedAt ? formatStableUkCompactDate(profile.discordNickname.syncedAt) : null}
          currentServerNickname={currentServerNickname} serverNicknameChecked={Boolean(discordMemberReadable && liveDiscordMember)} canManage
          canSyncDiscord={canSyncDiscordNickname} discordOwnerLocked={discordOwnerLocked} returnTo={settingsRulesReturnPath} /></PageErrorBoundary>
      </FormSection></div>
      <div id="profile-gender-settings"><ProfileGenderPreferenceForm value={profile.grammaticalGender} returnTo={settingsRulesReturnPath} /></div>
    </PageSection>
    <PageSection id="profile-discord-title" title="Discord та нагадування">
      <div id="profile-nickname-settings"><NicknameCharactersForm profile={profile} nicknameTemplate={nicknamePolicy.template} returnTo={settingsRulesReturnPath} /></div>
      {profile.provider === "discord" ? <div id="profile-notifications-settings"><FormSection title="Нагадування про рейди"><PageErrorBoundary><RaidReminderPreferenceControls /></PageErrorBoundary></FormSection></div> : null}
    </PageSection>
    <div id="profile-role-settings"><RaidRolePreferenceForm mainCharacter={mainCharacter} manualRole={manualRaidRole} selectedRole={selectedRaidRole} returnTo={settingsRulesReturnPath} /></div>
  </PageContainer>;
}
```

## src/components/ui/DataTable.tsx

```tsx
import type { ReactNode } from "react";

export default function DataTable({ caption, headings, children, className = "", tableClassName = "" }: {
  caption: string;
  headings: string[];
  children: ReactNode;
  className?: string;
  tableClassName?: string;
}) {
  return <div className={`ui-table-scroll ${className}`} role="region" aria-label={caption} tabIndex={0}>
    <table className={`ui-table ${tableClassName}`}><caption>{caption}</caption>
      <thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}
```

## src/components/ui/DropdownMenu.tsx

```tsx
"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Link from "next/link";
import Button from "./Button";
import styles from "../page/page-system.module.css";

type MenuBase = { id: string; label: string; disabled?: boolean; danger?: boolean };
export type DropdownMenuItem = MenuBase & (
  | { href: string; onSelect?: never }
  | { href?: never; onSelect: () => void }
);

/** Native disclosure, normal Tab order; no incomplete ARIA menu implementation. */
export default function DropdownMenu({ label = "Інші дії", items = [], children }: { label?: string; items?: readonly DropdownMenuItem[]; children?: ReactNode }) {
  const root = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const panelId = useId();
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) root.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  if (!items.length && !children) return null;
  return <details className={styles.dropdown} ref={root} onKeyDown={event => {
    if (event.key === "Escape" && root.current?.open) {
      event.preventDefault(); root.current.open = false; trigger.current?.focus();
    }
  }}>
    <summary className={`btn subtle ${styles.dropdownTrigger}`} ref={trigger} aria-controls={panelId}>{label}<span aria-hidden="true">⌄</span></summary>
    <div id={panelId} className={styles.dropdownPanel} aria-label={label} onClick={event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button:not(:disabled)") : null;
      if (button) {
        root.current?.removeAttribute("open");
        // Native form submitters retain focus ownership for useActionFocus.
        // Moving focus to summary here would suppress the mutation result.
        if (button.type !== "submit") trigger.current?.focus();
      }
    }}>
      {children}
      {items.map(item => item.href !== undefined
        ? item.disabled
          ? <span key={item.id} className={styles.dropdownItem} aria-disabled="true">{item.label}</span>
          : <Link key={item.id} href={item.href} className={styles.dropdownItem} data-danger={item.danger || undefined}
              onClick={() => root.current?.removeAttribute("open")}>{item.label}</Link>
        : <Button key={item.id} disabled={item.disabled} tone={item.danger ? "danger" : "ghost"} onClick={() => {
            root.current?.removeAttribute("open"); trigger.current?.focus(); item.onSelect();
          }}>{item.label}</Button>)}
    </div>
  </details>;
}
```

## src/lib/profileDirectoryNavigation.ts

```ts
import type { profileDirectoryFilters } from "@/lib/profileDirectory";
export type ProfileDirectoryFilters = ReturnType<typeof profileDirectoryFilters>;
export function buildProfilesHref({ query, link, role, sort, cursor }: ProfileDirectoryFilters & { cursor?: string | null }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (link !== "all") params.set("link", link);
  if (role !== "all") params.set("role", role);
  if (sort !== "activity") params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
  const suffix = params.toString();
  return suffix ? `/profiles?${suffix}` : "/profiles";
}
```

## src/services/profileDirectory.ts

```ts
import "server-only";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canManageGroups } from "@/lib/permissions";
import { listDashboardProfilePage, profileDirectoryFilters } from "@/lib/profileDirectory";
import { fetchDiscordGuildMembersCachedForUi } from "@/lib/discordAdmin";
import { listRaidDiscordPreferences } from "@/lib/raidDiscordPresets";

export async function loadProfileDirectory({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getSession({ live: true });
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageGroups(user)) redirect("/access-denied?reason=profiles&from=/profiles");

  const params = await searchParams;
  const filters = profileDirectoryFilters({ query: params.q, link: params.link, role: params.role, sort: params.sort });
  const { query, link: linkFilter, role: roleFilter, sort } = filters;
  const result = await listDashboardProfilePage({ viewer: user, ...filters, cursor: params.cursor });
  const { profiles, total, characterCount, linkedCount: linkedBattleNetCount } = result;
  const hasDiscordProfiles = profiles.some((profile) =>
    profile.provider === "discord" && /^\d{16,25}$/.test(profile.providerUserId)
  );
  const liveDiscordAvatars = new Map<string, string>();
  if (hasDiscordProfiles) {
    const members = await fetchDiscordGuildMembersCachedForUi().catch(() => []);
    for (const member of members) {
      if (member.avatarUrl) liveDiscordAvatars.set(member.userId, member.avatarUrl);
    }
  }
  const canManageCleanup = Boolean(user.isServerOwner);
  // Saved Discord raid preferences are not a member directory. Admin-only.
  const raidPreferences = await listRaidDiscordPreferences(100).catch(() => []);
  const hasFilters = Boolean(query || linkFilter !== "all" || roleFilter !== "all" || sort !== "activity");
  const paginationState = filters;

  return { user, params, filters, result, profiles, total, characterCount, linkedBattleNetCount, liveDiscordAvatars, canManageCleanup, raidPreferences, hasFilters, paginationState };
}
export type ProfileDirectoryModel = Awaited<ReturnType<typeof loadProfileDirectory>>;
```

## src/services/profileOverview.ts

```ts
import "server-only";

import { getEnabledBattleNetRegions } from "@/lib/battlenet";
import { normalizeCharacterKey } from "@/lib/wowCharacters";
import { listProfileRaidSignups } from "@/lib/raids";
import { formatStableUkCompactDate } from "@/lib/stableUiText";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { fetchDiscordGuildMemberSnapshot } from "@/lib/discordAdmin";

import { getSession, type DashboardSession } from "@/lib/auth";
import { canViewProfileAccessDetails, dashboardRoleLabel, guildStatusLabel } from "@/lib/permissions";
import { canViewProfile, getMainCharacter, getProfilePublicName, getProfileRaidRole, getProfileById, profileNeedsSettingsSetup, profileSettingsSetupPath, profileFromSession, upsertProfileFromSession, type DashboardProfile, type ProfileCharacter } from "@/lib/profiles";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { notFound, redirect } from "next/navigation";

function battleNetActionCopy(
  profile: DashboardProfile,
  hasFreshBattleNetSession: boolean,
) {
  if (hasFreshBattleNetSession) {
    return {
      eyebrow: "Готово до додавання",
      title: "Додати персонажів",
      hint: "Вибери потрібних зі свіжого списку",
    };
  }
  if (profile.battlenet?.linked) {
    return {
      eyebrow: "Battle.net підключено",
      title: "Оновити список",
      hint: "Потрібно для нових або оновлених персонажів",
    };
  }
  return {
    eyebrow: "Battle.net не підключено",
    title: "Підключити Battle.net",
    hint: "Знайде гільдійних та інших персонажів Battle.net",
  };
}

export async function loadProfileOverview({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
    throw new Error("Unauthorized");
  }
  const viewer: DashboardSession = session;

  const [{ profileId }, query, nicknamePolicy, apiSettings] = await Promise.all([
    params,
    searchParams,
    getGuildNicknamePolicy(),
    getDashboardApiSettings(),
  ]);
  const rulesReturnToken = String(
    Array.isArray(query.rt) ? query.rt[0] : query.rt || "",
  ).trim();
  const isRulesReturn =
    String(Array.isArray(query.from) ? query.from[0] : query.from || "") ===
      "rules" && Boolean(rulesReturnToken);
  const profileRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}?from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const settingsRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}/settings?setup=1&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const rulesReviewPath = isRulesReturn
    ? `/rules/accept?rt=${encodeURIComponent(rulesReturnToken)}&status=incomplete`
    : "";
  const initialProfile = await getProfileById(profileId);

  const isOwnProfile = Boolean(
    viewer.profileId && viewer.profileId === profileId,
  );
  if (initialProfile && !canViewProfile(viewer, profileId, initialProfile)) {
    notFound();
  }
  if (!initialProfile && !isOwnProfile && !canViewProfile(viewer, profileId)) {
    notFound();
  }

  let profile = initialProfile;
  let storageWarning = "";

  if (!profile && isOwnProfile) {
    const result = await upsertProfileFromSession(viewer).catch(() => null);
    profile = result?.profile || { ...profileFromSession(viewer), profileId };
    if (!result?.stored) {
      storageWarning =
        "Профіль тимчасово показано з поточної сесії. Частина даних може оновитися після повторного входу.";
    }
  }

  if (!profile) {
    notFound();
  }

  if (isOwnProfile && profileNeedsSettingsSetup(profile)) {
    const setupPath = profileSettingsSetupPath(profile.profileId);
    redirect(
      isRulesReturn
        ? `${setupPath}&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
        : setupPath,
    );
  }

  const mainCharacter = getMainCharacter(profile);
  const selectedRaidRole = getProfileRaidRole(profile);
  const enabledBattleNetRegions = getEnabledBattleNetRegions();
  const canManageCharacters = isOwnProfile;
  const canViewPrivateProfileBlocks =
    isOwnProfile || canViewProfileAccessDetails(viewer);
  const addedKeys = new Set(
    profile.characters
      .map((item) => normalizeCharacterKey(item.key))
      .filter(Boolean),
  );
  const candidateByKey = new Map<string, ProfileCharacter>();
  for (const candidate of profile.battlenet?.candidateCharacters || []) {
    const key = normalizeCharacterKey(candidate.key);
    if (key && !candidateByKey.has(key)) candidateByKey.set(key, candidate);
  }
  const availableCandidates = Array.from(candidateByKey.values()).filter(
    (item) => !addedKeys.has(normalizeCharacterKey(item.key)),
  );
  const availableGuildCandidates = availableCandidates.filter(
    (item) => item.verifiedGuild,
  );
  const availableOtherCandidates = availableCandidates.filter(
    (item) => !item.verifiedGuild,
  );
  const profileGuildCharacterCount = profile.characters.filter(
    (item) => item.verifiedGuild,
  ).length;
  const hasAvailableBattleNetCandidates = Boolean(
    availableCandidates.length && profile.battlenet?.candidateExpiresAt,
  );
  const hasFreshBattleNetSession = hasAvailableBattleNetCandidates;
  const primaryBattleNetRegion = enabledBattleNetRegions[0] || "eu";
  const battleNetAction = battleNetActionCopy(
    profile,
    hasFreshBattleNetSession,
  );
  const battleNetRefreshHref = `/api/auth/battlenet/start?region=${primaryBattleNetRegion}${profileRulesReturnPath ? `&next=${encodeURIComponent(profileRulesReturnPath)}` : ""}`;
  const battleNetCharacterActionHref = hasAvailableBattleNetCandidates
    ? "#profile-candidates"
    : battleNetRefreshHref;
  const battleNetLastSyncAt =
    profile.battlenet?.lastProfileViewRefreshAt ||
    profile.battlenet?.lastCharacterRefreshAt ||
    profile.battlenet?.lastSyncAt ||
    null;
  const battleNetLastSyncLabel = formatStableUkCompactDate(battleNetLastSyncAt);
  const bulkFormId = "profile-candidate-bulk-add";
  const publicNamePreview = getProfilePublicName(
    profile,
    nicknamePolicy.template,
  );
  const guildStatus = guildStatusLabel(profile.role);
  const [raidResult, discordMember] = await Promise.all([
    canViewPrivateProfileBlocks
      ? listProfileRaidSignups(profile).then(items => ({ items, unavailable: false })).catch(() => ({ items: [], unavailable: true }))
      : Promise.resolve({ items: [], unavailable: false }),
    profile.provider === "discord" && /^\d{16,25}$/.test(profile.providerUserId)
      ? fetchDiscordGuildMemberSnapshot(profile.providerUserId).catch(() => null)
      : Promise.resolve(null),
  ]);
  const raidSignups = raidResult.items;
  const raidSignupsUnavailable = raidResult.unavailable;
  const accountStatusLabel = dashboardRoleLabel(profile.role);
  const liveDiscordAvatarUrl = discordMember?.avatarUrl || null;
  const profileAvatarUrl = liveDiscordAvatarUrl || profile.avatarUrl || null;
  const visibleCharacters = [...profile.characters].sort((a, b) => {
    if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
    if (a.verifiedGuild !== b.verifiedGuild) return a.verifiedGuild ? -1 : 1;
    return a.name.localeCompare(b.name, "uk");
  });
  return { viewer, profile, query, isOwnProfile, isRulesReturn, profileRulesReturnPath, settingsRulesReturnPath, rulesReviewPath, mainCharacter, selectedRaidRole, canManageCharacters, canViewPrivateProfileBlocks, availableCandidates, availableGuildCandidates, availableOtherCandidates, profileGuildCharacterCount, hasAvailableBattleNetCandidates, battleNetAction, battleNetRefreshHref, battleNetCharacterActionHref, battleNetLastSyncLabel, bulkFormId, publicNamePreview, guildStatus, raidSignups, raidSignupsUnavailable, accountStatusLabel, profileAvatarUrl, visibleCharacters, storageWarning, apiSettings };
}

export type ProfileOverviewModel = Awaited<ReturnType<typeof loadProfileOverview>>;
```

## src/services/profileSettings.ts

```ts
import "server-only";

import { getSession } from "@/lib/auth";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";
import { withTimeout } from "@/lib/runtimeResilience";
import { fetchDiscordGuildMemberSnapshot, fetchDiscordGuildSnapshot, hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { getGuildNicknamePolicy } from "@/lib/guildNicknamePolicy";

import { guildStatusLabel } from "@/lib/permissions";
import { buildProfileDiscordNickname, getMainCharacter, getProfileById, getProfilePublicName, getProfileRaidRole, getProfileServerStyleName, profileFromSession, profileSettingsSetupStatus, upsertProfileFromSession } from "@/lib/profiles";
import { notFound, redirect } from "next/navigation";

export async function loadProfileSettings({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
    throw new Error("Unauthorized");
  }

  const [nicknamePolicy, query] = await Promise.all([
    getGuildNicknamePolicy().catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.profile_settings.nickname_policy_unavailable",
        {
          summary:
            "Шаблон Discord-ніку тимчасово недоступний, використано стандартний.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return {
        template: "{name} [{main}, {alt}, {alt}]",
        nicknameCleanupConcurrency: 0,
        nicknameCleanupMaxConcurrency: 4,
        nicknameReminderEnabled: false,
        nicknameReminderIntervalHours: 24,
        nicknameInvalidRecheckHours: 6,
        nicknameValidRecheckHours: 72,
        nicknameReminderCooldownHours: 72,
        nicknameReminderBatchLimit: 100,
        nicknameReminderChannelId: "",
        nicknameNewcomerGateEnabled: false,
        nicknameNewcomerRoleId: "",
        updatedAt: null,
        updatedBy: null,
      };
    }),
    searchParams,
  ]);

  const { profileId } = await params;
  const rulesReturnToken = String(
    Array.isArray(query.rt) ? query.rt[0] : query.rt || "",
  ).trim();
  const isRulesReturn =
    String(Array.isArray(query.from) ? query.from[0] : query.from || "") ===
      "rules" && Boolean(rulesReturnToken);
  const settingsRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}/settings?setup=1&from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const profileRulesReturnPath = isRulesReturn
    ? `/profile/${profileId}?from=rules&rt=${encodeURIComponent(rulesReturnToken)}`
    : "";
  const rulesReviewPath = isRulesReturn
    ? `/rules/accept?rt=${encodeURIComponent(rulesReturnToken)}&status=incomplete`
    : "";
  const isOwnProfile = Boolean(
    session.profileId && session.profileId === profileId,
  );
  if (!isOwnProfile) notFound();

  let profile = await getProfileById(profileId);
  let storageWarning = "";

  if (!profile) {
    const result = await upsertProfileFromSession(session).catch(() => null);
    profile = result?.profile || { ...profileFromSession(session), profileId };
    if (!result?.stored) {
      storageWarning =
        "Профіль тимчасово показано з поточної сесії. Частина даних може оновитися після повторного входу.";
    }
  }

  if (!profile) notFound();

  const mainCharacter = getMainCharacter(profile);
  const raidRolePreference = profile.raidRolePreference || null;
  const manualRaidRole =
    raidRolePreference &&
    mainCharacter &&
    raidRolePreference.characterKey === mainCharacter.key
      ? raidRolePreference.role
      : null;
  const selectedRaidRole = getProfileRaidRole(profile);
  const publicNamePreview = getProfilePublicName(
    profile,
    nicknamePolicy.template,
  );
  const serverStyleNamePreview = getProfileServerStyleName(
    profile,
    80,
    nicknamePolicy.template,
  );
  const discordNicknamePreview = buildProfileDiscordNickname(
    profile,
    nicknamePolicy.template,
  );
  const discordMemberReadable =
    profile.provider === "discord" &&
    /^\d{16,25}$/.test(profile.providerUserId) &&
    hasDiscordEmbedConfig();
  const canSyncDiscordNickname = discordMemberReadable;
  let discordOwnerLocked = false;
  let currentServerNickname: string | null = null;
  let liveDiscordMember: Awaited<
    ReturnType<typeof fetchDiscordGuildMemberSnapshot>
  > | null = null;

  if (discordMemberReadable) {
    const [guild, member] = await withTimeout(
      Promise.all([
        fetchDiscordGuildSnapshot().catch(() => null),
        fetchDiscordGuildMemberSnapshot(profile.providerUserId).catch(
          () => null,
        ),
      ]),
      1_800,
      "profile settings discord member read",
    ).catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.profile_settings.discord_live_read_failed",
        {
          summary:
            "Discord-нік не перевірено наживо, показано збережені дані профілю.",
          profileId,
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return [null, null] as const;
    });
    liveDiscordMember = member;
    discordOwnerLocked = Boolean(
      guild?.ownerId && guild.ownerId === profile.providerUserId,
    );
    currentServerNickname = member?.nick || null;
  }

  const setupStatus = profileSettingsSetupStatus(profile);
  const isSetupEntry =
    String(Array.isArray(query.setup) ? query.setup[0] : query.setup || "") ===
      "1" || setupStatus.missing.length > 0;
  const settingsPageTitle = isSetupEntry
    ? "Реєстрація профілю"
    : "Налаштування профілю";
  const guildStatus = guildStatusLabel(profile.role);
  const accountStatusLabel = guildStatus;
  return { session, profile, query, isOwnProfile, isRulesReturn, settingsRulesReturnPath, profileRulesReturnPath, rulesReviewPath, mainCharacter, manualRaidRole, selectedRaidRole, publicNamePreview, serverStyleNamePreview, discordNicknamePreview, discordMemberReadable, canSyncDiscordNickname, discordOwnerLocked, currentServerNickname, liveDiscordMember, setupStatus, isSetupEntry, settingsPageTitle, guildStatus, accountStatusLabel, storageWarning, nicknamePolicy };
}

export type ProfileSettingsModel = Awaited<ReturnType<typeof loadProfileSettings>>;
```

