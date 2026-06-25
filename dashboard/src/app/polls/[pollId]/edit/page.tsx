import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { fetchDiscordRoles, fetchDiscordTextChannels, hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { getRaidPoll, hasRaidPollStorage } from "@/lib/raidPolls";
import { RaidPollEditForm, RaidPollPageShell } from "@/components/RaidPollViews";
import { buildPageMetadata } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ pollId: string }> }) {
  const { pollId } = await params;
  return buildPageMetadata({
    title: "Редагування рейд-пулу",
    description: "Редагування Discord-голосування за доступність учасників рейду.",
    path: `/polls/${encodeURIComponent(pollId)}/edit`,
    keywords: ["редагувати рейд-пул", "Discord голосування", "рейдовий пул"],
  });
}

function orderChannels(channels: Array<{ id: string; name: string }>, suggestedChannelId = "", currentChannelId = "") {
  const priority = [currentChannelId, suggestedChannelId].filter(Boolean);
  return [
    ...priority.flatMap((id) => channels.filter((channel) => channel.id === id)),
    ...channels.filter((channel) => !priority.includes(channel.id)),
  ].filter((channel, index, list) => list.findIndex((item) => item.id === channel.id) === index);
}

export default async function EditPollPage({ params }: { params: Promise<{ pollId: string }> }) {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageRaids(user)) redirect(await getOwnProfilePath(user));

  const { pollId } = await params;
  const poll = await getRaidPoll(pollId, { bypassCache: true }).catch(() => null);
  if (!poll) {
    return (
      <RaidPollPageShell user={user} title="Рейд-пул не знайдено" description="Перевір посилання або повернись до списку рейд-пулів.">
        <section className="panel raid-member-panel">
          <h2>Рейд-пул не знайдено</h2>
          <p>Запис міг бути видалений або ID некоректний.</p>
          <a className="btn subtle" href="/polls">До списку</a>
        </section>
      </RaidPollPageShell>
    );
  }

  const discordEnabled = hasDiscordEmbedConfig();
  const [channelResult, roles] = discordEnabled
    ? await Promise.all([
        fetchDiscordTextChannels().catch(() => null),
        fetchDiscordRoles().catch(() => []),
      ])
    : [null, []];
  const channels = orderChannels(channelResult?.channels || [], channelResult?.suggestedChannelId || "", poll.channelId || "");

  return (
    <RaidPollPageShell
      user={user}
      title="Редагування рейд-пулу"
      description="Зміни назву, складність, дні, дедлайн або Discord-канал. Після збереження Firebase і Discord embed синхронізуються."
    >
      {!hasRaidPollStorage() ? <div className="notice panel error-note raid-notice">Firebase для рейд-пулів не налаштований.</div> : null}
      {!discordEnabled ? <div className="notice panel error-note raid-notice">Discord-публікація недоступна: перевір bot token або worker relay.</div> : null}
      {channelResult?.warning ? <div className="notice panel warning-note raid-notice">Список каналів прочитано з попередженням: {channelResult.warning}</div> : null}
      <section className="raid-poll-create-layout" aria-label="Редагування рейд-пулу">
        <RaidPollEditForm poll={poll} channels={channels} roles={roles} discordEnabled={discordEnabled && hasRaidPollStorage()} />
        <aside className="panel raid-poll-help-card">
          <div className="raid-poll-help-card__head">
            <span className="eyebrow">Синхронізація</span>
            <h2>Один запис — один Discord embed</h2>
          </div>
          <p>Якщо канал змінено, сайт створить нове повідомлення у вибраному каналі й спробує прибрати старе. Якщо канал той самий — буде PATCH існуючого повідомлення.</p>
          <div className="raid-poll-help-steps">
            <span>1. Firebase оновлює дані рейд-пулу.</span>
            <span>2. Discord embed редагується або переноситься в інший канал.</span>
            <span>3. Голоси зберігаються за Discord ID і не дублюються.</span>
            <span>4. Закритий пул лишається закритим, але фінальний embed можна поправити.</span>
          </div>
          <div className="raid-poll-help-actions">
            <a className="btn subtle" href={`/polls/${encodeURIComponent(poll.id)}`}>До результатів</a>
            {poll.messageUrl ? <a className="btn subtle" href={poll.messageUrl} target="_blank" rel="noreferrer">Discord</a> : null}
          </div>
        </aside>
      </section>
    </RaidPollPageShell>
  );
}
