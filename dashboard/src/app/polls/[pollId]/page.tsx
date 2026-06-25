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
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canViewRaidDirectory(user)) redirect(await getOwnProfilePath(user));

  const { pollId } = await params;
  const poll = await getRaidPoll(pollId).catch(() => null);
  const relatedPolls = poll ? (await listRaidPolls(120).catch(() => [poll])).filter((item) => item.channelId && item.messageId) : [];
  const canManage = canManageRaids(user);

  return (
    <RaidPollPageShell
      user={user}
      title="Результати рейд-пулу"
      description="Повний результат голосування: дні, час, список учасників і Discord-повідомлення."
    >
      {!hasRaidPollStorage() ? <div className="notice panel error-note raid-notice">Рейд-пули тимчасово недоступні: Firebase не налаштований.</div> : null}
      {poll ? <>
        <RaidPollLiveSync pollId={poll.id} initialRevision={raidPollLiveRevision(poll)} />
        <RaidPollResults poll={poll} relatedPolls={relatedPolls} canManage={canManage} />
      </> : <section className="panel raid-member-panel"><h2>Рейд-пул не знайдено</h2><p>Перевір посилання або повернись до списку.</p><a className="btn subtle" href="/polls">До списку</a></section>}
    </RaidPollPageShell>
  );
}
