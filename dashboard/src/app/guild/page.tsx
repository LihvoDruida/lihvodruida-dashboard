import DashboardIdentity from "@/components/DashboardIdentity";
import GuildRosterExplorer from "@/components/GuildRosterExplorer";
import GuildRosterLiveHeroStats from "@/components/GuildRosterLiveHeroStats";
import PageContainer from "@/components/page/PageContainer";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import GuildDiscordGuide from "@/components/guild/GuildDiscordGuide";
import { loadGuildWorkspace } from "@/services/guildWorkspace";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { buildPageMetadata } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Склад гільдії",
  description:
    "Огляд складу Mistblossom Vanguard: ролі, класи, типи броні, item level, Mythic+ рейтинг і зручні фільтри для учасників.",
  path: "/guild",
  keywords: ["склад гільдії", "рейдери WoW", "Raider.IO", "item level"],
});

export default async function GuildRosterPage() {
  const {user, roster, apiSettings} = await loadGuildWorkspace();
  return <PageContainer label="Склад гільдії" navigation={<DashboardIdentity user={user} activeSection="guild" />}>
    <GuildRosterLiveHeroStats members={roster.members} stats={roster.stats} source={roster.source} error={roster.error} allowManualRefresh={Boolean(user?.isServerOwner)}
      refreshSettings={{clientDrivenSyncEnabled: apiSettings.guildRosterClientDrivenSyncEnabled,clientStepDelayMs: apiSettings.guildRosterClientStepDelayMs,clientRequestTimeoutMs: apiSettings.guildRosterClientRequestTimeoutMs,clientMaxSteps: apiSettings.guildRosterClientMaxSteps}} />
    <PageErrorBoundary><GuildRosterExplorer navigationScope={listNavigationScope(user)} members={roster.members} stats={roster.stats} source={roster.source} error={roster.error} /></PageErrorBoundary>
    <GuildDiscordGuide />
  </PageContainer>;
}
