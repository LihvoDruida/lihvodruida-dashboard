import ListReturnLink from "@/components/ListReturnLink";
import { listNavigationScope } from "@/lib/listNavigationScope";
import DiscordPublicationWorkbench from "@/components/DiscordPublicationWorkbench";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids, canViewRaidDirectory } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { getRaidPoll, hasRaidPollStorage, listRaidPolls, raidPollLiveRevision } from "@/lib/raidPolls";
import { RaidPollPageShell, RaidPollResults } from "@/components/RaidPollViews";
import RaidPollLiveSync from "@/components/RaidPollLiveSync";
import { buildPageMetadata } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ pollId: string }> }) {
  const { pollId } = await params;
  return buildPageMetadata({
    title: "Рейд-пул",
    description: "Детальні результати рейд-пулу Mistblossom Vanguard.",
    path: `/polls/${encodeURIComponent(pollId)}`,
    keywords: ["рейд-пул", "результати голосування", "Discord poll"],
  });
}

export default async function PollDetailsPage({ params }: { params: Promise<{ pollId: string }> }) {
  const user = await getSession();
  if (user && !canViewRaidDirectory(user)) redirect(await getOwnProfilePath(user));

  const { pollId } = await params;
  const canManage = canManageRaids(user);
  const storedPoll = await getRaidPoll(pollId).catch(() => null);
  // Unpublished polls and draft preferences remain invisible to guests.
  const poll = storedPoll && (canManage || (storedPoll.channelId && storedPoll.messageId)) ? storedPoll : null;
  const relatedPolls = poll ? (await listRaidPolls(120).catch(() => [poll])).filter((item) => item.channelId && item.messageId) : [];

  return (
    <RaidPollPageShell
      user={user}
      title={poll ? poll.title : "Рейд-пул"}
      description="Повний результат голосування: дні, час, список учасників і стан Discord-синхронізації."
      eyebrow="Mistblossom Vanguard • Результати"
    >
      <ListReturnLink kind="polls" scope={listNavigationScope(user)} />
      {!hasRaidPollStorage() ? <div className="notice panel error-note raid-notice">Рейд-пули тимчасово недоступні: сховище не налаштоване.</div> : null}
      {poll ? <>
        {canManage ? <DiscordPublicationWorkbench kind="poll" id={poll.id} /> : null}
        {canManage ? <RaidPollLiveSync pollId={poll.id} initialRevision={raidPollLiveRevision(poll)} /> : null}
        <RaidPollResults poll={poll} relatedPolls={relatedPolls} canManage={canManage} />
      </> : <section className="panel raid-member-panel"><h2>Рейд-пул не знайдено</h2><p>Перевір посилання або повернись до списку.</p><a className="btn subtle" href="/polls">До списку</a></section>}
    </RaidPollPageShell>
  );
}
