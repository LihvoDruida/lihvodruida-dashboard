import ListViewMemory from "@/components/ListViewMemory";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { listViewUrl } from "@/lib/listViewState";
import { matchesRaidListSearch } from "@/lib/raidListSearch";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids, canViewRaidDirectory } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { hasRaidStorage, isRaidClosed, listRaids } from "@/lib/raids";
import {
  RaidListCard,
  RaidPageShell,
  StatusNotice,
  formatRaidDateTime,
} from "@/components/RaidViews";
import { buildPageMetadata } from "@/lib/seo";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";
import RaidArchiveLoadMore from "@/components/RaidArchiveLoadMore";

export const runtime = "nodejs";
export const metadata = buildPageMetadata({
  title: "Рейди",
  description:
    "Список активних і минулих рейдів Mistblossom Vanguard із записом, складом, правилами та архівом.",
  path: "/raids",
  keywords: ["рейди WoW", "запис на рейд", "архів рейдів"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RaidsListPage({
    searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getSession();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }
  if (!canViewRaidDirectory(user)) redirect(await getOwnProfilePath(user));

  const canManage = canManageRaids(user);
  const params = await searchParams;
  if (params.raid) redirect(`/raids/${encodeURIComponent(params.raid)}`);

  const raids = await listRaids(100).catch((error) => {
    void recordDashboardSystemLog(
      "error",
      "page.raids.list_read_failed",
      {
        summary:
          "Сторінка рейдів відкрилась без списку: читання рейдів не спрацювало.",
        message:
          error instanceof Error ? error.message : String(error || "unknown"),
      },
      { persist: true },
    );
    return [];
  });
  const activeRaids = raids.filter(
    (raid) => raid.status === "published" && !isRaidClosed(raid),
  );
  const draftRaids = canManage
    ? raids.filter((raid) => raid.status === "draft")
    : [];
  const closedRaids = raids.filter((raid) => isRaidClosed(raid));
  const currentRaids = canManage
    ? [...activeRaids, ...draftRaids]
    : activeRaids;
  const nextRaid = activeRaids[0] || null;
  const rawQuery = new URLSearchParams();
  for (const key of ["q", "state", "archive"]) if (typeof params[key] === "string") rawQuery.set(key, params[key]!);
  const currentUrl = listViewUrl("raids", `/raids?${rawQuery}`) || "/raids";
  const filters = new URL(currentUrl, "https://list.invalid").searchParams;
  const query = filters.get("q") || "";
  const state = filters.get("state") || "all";
  const visibleCurrent = currentRaids.filter(raid => matchesRaidListSearch(raid, query) && (state === "all" || state === "active" && raid.status === "published" || state === "draft" && raid.status === "draft"));
  const visibleArchive = closedRaids.filter(raid => matchesRaidListSearch(raid, query));


  return (
    <RaidPageShell
      user={user}
      title={canManage ? "Рейди" : "Мої рейди"}
      description={
        canManage
          ? "Керування рейдами, оголошеннями, складом, лімітами та записами. Минулі рейди залишаються в архіві до ручного видалення."
          : "Опубліковані рейди, запис на участь і посилання на правила без зайвих адмінських блоків."
      }
    >
      <StatusNotice params={params} />
      {!hasRaidStorage() ? (
        <div className="notice panel error-note raid-notice">
          Рейди тимчасово недоступні. Спробуй пізніше або звернись до офіцера.
        </div>
      ) : null}
      {hasRaidStorage() && raids.length === 0 ? (
        <div className="notice panel raid-notice">
          Якщо рейди були створені раніше, зараз база могла не відповісти.
          Сторінка відкрита без падіння — повтори оновлення трохи пізніше.
        </div>
      ) : null}
      {canManage && !hasDiscordEmbedConfig() ? (
        <div className="notice panel error-note raid-notice">
          Публікація в Discord тимчасово недоступна. Чернетки можна підготувати
          й опублікувати пізніше.
        </div>
      ) : null}

      <section className="panel raid-list-navigation" aria-label="Перегляд рейдів">
        <ListViewMemory key={listNavigationScope(user)} kind="raids" scope={listNavigationScope(user)} currentUrl={currentUrl} clientLocation />
          {canManage ? (
            <div className="raid-list-head-actions">
              <a className="btn subtle" href="/roster">Збір рейдового складу на сезон</a>
              <a className="btn subtle" href="/polls">Рейд-пули</a>
              <a className="btn subtle" href="/raids/bench-priority">
                🩶 Сірий список
              </a>
              <a className="btn primary" href="/raids/new">
                ＋ Створити рейд
              </a>
            </div>
          ) : null}
        <form key={`${query}:${state}`} action="/raids" method="get" data-list-filter="raids" className="raid-list-filters">
          <label>Пошук рейду<input name="q" type="search" maxLength={160} defaultValue={query} placeholder="Назва, дата або ID" /></label>
          <label>Стан рейдів<select name="state" defaultValue={state}>
            <option value="all">Усі</option><option value="active">Активні</option>
            {canManage ? <option value="draft">Чернетки</option> : null}<option value="closed">Архів</option>
          </select></label>
          <button type="submit" className="btn primary">Застосувати</button>
          <a href="/raids?view=all" data-list-reset-position className="btn subtle">Скинути</a>
        </form>
      </section>

      {state !== "closed" ? <section className="panel raid-list-page-panel dashboard-list-panel">
        <div className="raid-list-page-head dashboard-list-head">
          <div>
            <h2>{canManage ? "Поточні рейди" : "Доступні рейди"}</h2>
            <p>
              {canManage
                ? "Активні рейди та чернетки. Закриті рейди винесені в окремий архів нижче."
                : "Тут видно рейди, на які можна записатися або переглянути свій статус."}
            </p>
            <div className="raid-list-kpis" aria-label="Коротка статистика рейдів">
              <span>
                <small>Активні</small>
                <strong>{activeRaids.length}</strong>
              </span>
              {canManage ? (
                <span>
                  <small>Чернетки</small>
                  <strong>{draftRaids.length}</strong>
                </span>
              ) : null}
              <span>
                <small>Архів</small>
                <strong>{closedRaids.length}</strong>
              </span>
              <span className="raid-list-kpi-next">
                <small>Найближчий рейд</small>
                <strong>{nextRaid ? formatRaidDateTime(nextRaid.date, nextRaid.time) : "Немає"}</strong>
              </span>
            </div>
          </div>

        </div>
        <div className="raid-manager-list dashboard-list">
          {visibleCurrent.length ? (
            visibleCurrent.map((raid) => (
              <RaidListCard key={raid.id} raid={raid} canManage={canManage} />
            ))
          ) : (
            <p className="raid-empty">Рейдів за цими фільтрами немає.</p>
          )}
        </div>
      </section> : null}

      {state === "all" || state === "closed" ? <section className="panel raid-list-page-panel raid-list-page-panel--archive dashboard-list-panel dashboard-list-panel--archive">
        <div className="raid-list-page-head raid-list-page-head--archive dashboard-list-head">
          <div>
            <h2>Минулі рейди</h2>
            <p>
              {canManage
                ? "Архів для перегляду складу, записів, середнього item level і посилань на Discord-повідомлення."
                : "Завершені рейди залишаються доступними для перегляду."}
            </p>
            <div
              className="raid-list-summary dashboard-list-summary"
              aria-label="Статистика архіву рейдів"
            >
              <span>Знайдено: {visibleArchive.length}</span>
            </div>
          </div>
        </div>
        {visibleArchive.length ? (
          <RaidArchiveLoadMore step={6} total={visibleArchive.length}>
            {visibleArchive.map((raid) => (
              <RaidListCard key={raid.id} raid={raid} canManage={canManage} />
            ))}
          </RaidArchiveLoadMore>
        ) : (
          <div className="raid-manager-list raid-manager-list--archive dashboard-list dashboard-list--archive">
            <p className="raid-empty">
              Минулі рейди за цими фільтрами не знайдені.
            </p>
          </div>
        )}
      </section> : null}
    </RaidPageShell>
  );
}
