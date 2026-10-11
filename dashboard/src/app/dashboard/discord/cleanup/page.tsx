import Link from "next/link";
import { redirect } from "next/navigation";
import AdminPageHeader from "@/components/AdminPageHeader";
import AdminTabs from "@/components/AdminTabs";
import DashboardIdentity from "@/components/DashboardIdentity";
import DiscordMemberCleanupPanel from "@/components/DiscordMemberCleanupPanel";
import { getSession } from "@/lib/auth";
import { canManageDiscordMembers } from "@/lib/permissions";
import { fetchDiscordCleanupControl } from "@/lib/discordAdmin";
import { cleanupRoleBlockedReason } from "@/lib/discordCleanupPolicy";
import { getDiscordCleanupOverview, listDiscordCleanupMembers } from "@/lib/discordMemberCleanup";
import { buildPageMetadata } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = buildPageMetadata({ title: "Очищення Discord", description: "Автоматичне виключення Discord-учасників за роллю та строком від вступу.", path: "/dashboard/discord/cleanup" });
export default async function DiscordCleanupPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!canManageDiscordMembers(user)) redirect("/access-denied?reason=discord&from=/dashboard/discord/cleanup");
  const [data, control] = await Promise.all([
    Promise.all([getDiscordCleanupOverview(), listDiscordCleanupMembers("candidates")]).then(([overview, page]) => ({ initial: { ...overview, page }, error: null as string | null })).catch((error) => ({ initial: null, error: error instanceof Error ? error.message : "Сховище тимчасово недоступне." })),
    fetchDiscordCleanupControl().then((value) => ({ value, error: null as string | null })).catch((error) => ({ value: null, error: error instanceof Error ? error.message : "Discord тимчасово недоступний." })),
  ]);
  const roles = control.value ? control.value.roles.filter((role) => role.id !== control.value!.guildId).map((role) => ({ id: role.id, name: role.name, blockedReason: cleanupRoleBlockedReason(role, control.value!) })).sort((a, b) => a.name.localeCompare(b.name, "uk")) : [];
  return <main className="container app-page admin-container"><section className="dashboard-shell content-shell admin-page discord-cleanup-page app-page-stack"><DashboardIdentity user={user} activeSection="admin" /><AdminPageHeader eyebrow="Mistblossom Vanguard • Discord" title="Очищення Discord" description="Єдина роль, строк від вступу та прозора історія кожного виключення." /><AdminTabs active="discord" user={user} /><Link className="btn subtle discord-cleanup-back" href="/dashboard/discord">← Керування Discord</Link>{data.initial ? <DiscordMemberCleanupPanel initial={data.initial} roles={roles} canConfigure={Boolean(user.isServerOwner)} warning={control.error} /> : <section className="panel discord-cleanup-alert" role="alert"><h2>Очищення тимчасово недоступне</h2><p>{data.error}</p><p>Автоматичне виключення потребує доступного сховища налаштувань та історії.</p></section>}</section></main>;
}
