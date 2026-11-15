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
