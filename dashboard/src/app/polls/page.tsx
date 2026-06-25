import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids, canViewRaidDirectory } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { hasRaidPollStorage, listRaidPolls } from "@/lib/raidPolls";
import { RaidPollListCard, RaidPollPageShell } from "@/components/RaidPollViews";
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
  const openPolls = polls.filter((poll) => poll.status === "open");
  const closedPolls = polls.filter((poll) => poll.status === "closed");
  const publishedPolls = polls.filter((poll) => poll.channelId && poll.messageId);

  return (
    <RaidPollPageShell
      user={user}
      title="Рейд-пули"
      description="Активні та архівні голосування за дні й час рейду. Створення тільки через сайт, голосування — через Discord."
    >
      {!hasRaidPollStorage() ? <div className="notice panel error-note raid-notice">Рейд-пули тимчасово недоступні: Firebase не налаштований.</div> : null}
      {canManage && !hasDiscordEmbedConfig() ? <div className="notice panel error-note raid-notice">Публікація рейд-пулів у Discord недоступна: не налаштовано bot token або worker relay.</div> : null}

      <section className="panel raid-poll-command-strip" aria-label="Стан синхронізації рейд-пулів">
        <div className="raid-poll-sync-node" aria-hidden="true">↻</div>
        <div>
          <strong>Вузол синхронізації Discord Live Active</strong>
          <p>Worker готовий приймати interactions, Firebase зберігає голоси, сайт показує актуальні результати без ручного оновлення.</p>
        </div>
        <div className="raid-poll-command-actions">
          {canManage ? <RaidPollRecalculateButton /> : null}
          <div className="raid-poll-command-log" aria-label="Системний статус">Discord • Firebase • Web</div>
        </div>
      </section>

      <section className="panel raid-list-page-panel raid-poll-list-section raid-poll-list-section--active dashboard-list-panel">
        <div className="raid-list-page-head raid-poll-list-head dashboard-list-head">
          <div>
            <span className="raid-poll-section-kicker">Активні</span>
            <h2>Активні голосування</h2>
            <p>Відкриті рейд-пули, де учасники ще можуть змінювати день, час, персонажа або поставити «Не можу».</p>
            <div className="raid-list-summary raid-poll-list-summary dashboard-list-summary" aria-label="Статистика рейд-пулів">
              <span>Активні: {openPolls.length}</span>
              <span>Архів: {closedPolls.length}</span>
              <span>Усього: {polls.length}</span>
            </div>
          </div>
          {canManage ? <a className="btn primary raid-poll-create-button" href="/polls/new">＋ Створити рейд-пул</a> : null}
        </div>
        <div className="raid-manager-list raid-poll-card-grid dashboard-list">
          {openPolls.length ? openPolls.map((poll) => <RaidPollListCard key={poll.id} poll={poll} relatedPolls={publishedPolls} canManage={canManage} />) : <p className="raid-empty raid-poll-empty">Активних рейд-пулів поки немає.</p>}
        </div>
      </section>

      <section className="panel raid-list-page-panel raid-list-page-panel--archive raid-poll-list-section raid-poll-list-section--archive dashboard-list-panel dashboard-list-panel--archive">
        <div className="raid-list-page-head raid-list-page-head--archive raid-poll-list-head dashboard-list-head">
          <div>
            <span className="raid-poll-section-kicker">Архів</span>
            <h2>Архівні голосування</h2>
            <p>Закриті рейд-пули з фінальними результатами, персонажами та історією відповідей.</p>
          </div>
        </div>
        <div className="raid-manager-list raid-manager-list--archive raid-poll-card-grid raid-poll-card-grid--archive dashboard-list dashboard-list--archive">
          {closedPolls.length ? closedPolls.map((poll) => <RaidPollListCard key={poll.id} poll={poll} relatedPolls={publishedPolls} canManage={canManage} />) : <p className="raid-empty raid-poll-empty">Архів порожній.</p>}
        </div>
      </section>
    </RaidPollPageShell>
  );
}
