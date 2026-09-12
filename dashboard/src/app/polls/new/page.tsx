import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { fetchDiscordRoles, fetchDiscordTextChannels, hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { hasRaidPollStorage } from "@/lib/raidPolls";
import { RaidPollCreateForm, RaidPollPageShell } from "@/components/RaidPollViews";
import { buildPageMetadata } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Створення рейд-пулу",
  description: "Створення Discord-голосування за доступність учасників рейду через сайт Mistblossom Vanguard.",
  path: "/polls/new",
  keywords: ["створити рейд-пул", "Discord голосування", "рейдовий пул"],
});

export default async function NewPollPage() {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canManageRaids(user)) redirect(await getOwnProfilePath(user));

  const discordEnabled = hasDiscordEmbedConfig();
  const [channelResult, roles] = discordEnabled
    ? await Promise.all([
        fetchDiscordTextChannels().catch(() => null),
        fetchDiscordRoles().catch(() => []),
      ])
    : [null, []];
  const suggestedChannelId = channelResult?.suggestedChannelId || "";
  const rawChannels = channelResult?.channels || [];
  const channels = suggestedChannelId
    ? [
        ...rawChannels.filter((channel) => channel.id === suggestedChannelId),
        ...rawChannels.filter((channel) => channel.id !== suggestedChannelId),
      ]
    : rawChannels;

  return (
    <RaidPollPageShell
      user={user}
      title="Створення рейд-пулу"
      description="Заповни параметри голосування й обери: опублікувати Discord-повідомлення зараз або запланувати його на конкретний день і час."
    >
      {!hasRaidPollStorage() ? <div className="notice panel error-note raid-notice">Сховище рейд-пулів не налаштоване.</div> : null}
      {!discordEnabled ? <div className="notice panel error-note raid-notice">Discord-публікація недоступна: не налаштований DISCORD_BOT_TOKEN.</div> : null}
      {channelResult?.warning ? <div className="notice panel warning-note raid-notice">Список каналів прочитано з попередженням: {channelResult.warning}</div> : null}
      <section className="raid-poll-create-layout" aria-label="Створення рейд-пулу">
        <RaidPollCreateForm channels={channels} roles={roles} discordEnabled={discordEnabled && hasRaidPollStorage()} />
        <aside className="panel raid-poll-help-card">
          <div className="raid-poll-help-card__head">
            <span className="eyebrow">Логіка роботи</span>
            <h2>Сайт планує, Discord збирає голоси</h2>
          </div>
          <p>Команди Discord для створення немає. Ця сторінка зберігає пул, а бот публікує embed одразу або автоматично в запланований час.</p>
          <ol className="raid-poll-help-steps">
            <li>Обери «Опублікувати зараз» або «Запланувати». У другому режимі до заданого часу Discord-повідомлення не створюється.</li>
            <li>Після фактичної публікації стартує таймер закриття; перезапуск VPS не скидає заплановану дату.</li>
            <li>Гравець тисне кнопку й обирає роль: танк, хіл або ДД.</li>
            <li>Швидкий вибір ставить один час на всі дні; далі можна поправити окремі дні або позначити «Не можу».</li>
            <li>Підпис береться з ніку на сервері — персонаж Battle.net не потрібен.</li>
            <li>Кожна дія редагує попередній голос, а сайт підтягує зміни через live sync.</li>
          </ol>
          <div className="raid-poll-help-actions">
            <a className="btn subtle" href="/discord">Discord Hub</a>
            <a className="btn subtle" href="/polls">Усі пули</a>
          </div>
        </aside>
      </section>
    </RaidPollPageShell>
  );
}
