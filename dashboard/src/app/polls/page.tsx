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
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canViewRaidDirectory(user)) redirect(await getOwnProfilePath(user));

  const canManage = canManageRaids(user);
  const polls = await listRaidPolls(120).catch(() => []);
  const publishedPolls = polls.filter((poll) => poll.channelId && poll.messageId);
  const openCount = polls.filter((poll) => raidPollStateKey(poll) === "open").length;
  const pausedCount = polls.filter((poll) => raidPollStateKey(poll) === "paused").length;

  return (
    <RaidPollPageShell
      user={user}
      title="Рейд-пули"
      description="Голосування за дні й час рейду: створення через сайт, голоси — через Discord, результати рахуються автоматично."
      stats={[
        { label: "Активні", value: openCount },
        { label: "На паузі", value: pausedCount },
        { label: "Усього", value: polls.length },
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

      <RaidPollList polls={polls} relatedPolls={publishedPolls} canManage={canManage} createHref="/polls/new" />
    </RaidPollPageShell>
  );
}
