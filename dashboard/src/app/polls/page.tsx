import { listNavigationScope } from "@/lib/listNavigationScope";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids, canViewRaidDirectory } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { hasRaidPollStorage, listRaidPolls, raidPollStateKey } from "@/lib/raidPolls";
import { RaidPollList, RaidPollPageShell } from "@/components/RaidPollViews";
import RaidPollRecalculateButton from "@/components/RaidPollRecalculateButton";
import { buildPageMetadata } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Рейд-пули",
  description: "Голосування за доступність гравців для рейдів Mistblossom Vanguard із Discord та сайтом.",
  path: "/polls",
  keywords: ["рейд-пул", "голосування рейдів", "Discord голосування"],
});

export default async function PollsPage() {
  const user = await getSession();
  // Public visitors can view Discord-published polls, but not unpublished drafts.
  if (user && !canViewRaidDirectory(user)) redirect(await getOwnProfilePath(user));

  const canManage = canManageRaids(user);
  const polls = await listRaidPolls(120).catch(() => []);
  const publishedPolls = polls.filter((poll) => poll.channelId && poll.messageId);
  const visiblePolls = canManage ? polls : publishedPolls;
  const scheduledCount = visiblePolls.filter((poll) => raidPollStateKey(poll) === "scheduled").length;
  const openCount = visiblePolls.filter((poll) => raidPollStateKey(poll) === "open").length;
  const pausedCount = visiblePolls.filter((poll) => raidPollStateKey(poll) === "paused").length;

  return (
    <RaidPollPageShell
      user={user}
      title="Рейд-пули"
      description="Голосування можна опублікувати одразу або запланувати на потрібний день і час; голоси збирає Discord, результати рахуються автоматично."
      stats={[
        { label: "Заплановані", value: scheduledCount },
        { label: "Активні", value: openCount },
        { label: "На паузі", value: pausedCount },
        { label: "Усього", value: visiblePolls.length },
        { label: "У Discord", value: publishedPolls.length },
      ]}
      actions={canManage ? <RaidPollRecalculateButton /> : null}
    >
      {!hasRaidPollStorage() ? (
        <div className="notice panel error-note raid-notice">Рейд-пули тимчасово недоступні: сховище не налаштоване.</div>
      ) : null}
      {canManage && !hasDiscordEmbedConfig() ? (
        <div className="notice panel error-note raid-notice">Публікація рейд-пулів у Discord недоступна: не налаштовано bot token або worker relay.</div>
      ) : null}

      <RaidPollList navigationScope={listNavigationScope(user)} polls={visiblePolls} relatedPolls={publishedPolls} canManage={canManage} createHref="/polls/new" />
    </RaidPollPageShell>
  );
}
