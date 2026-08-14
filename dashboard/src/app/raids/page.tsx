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
  const visibleTotal = canManage
    ? raids.length
    : activeRaids.length + closedRaids.length;

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

      <section className="panel raid-list-page-panel dashboard-list-panel">
        <div className="raid-list-page-head dashboard-list-head">
          <div>
            <h2>{canManage ? "Поточні рейди" : "Доступні рейди"}</h2>
            <p>
              {canManage
                ? "Активні рейди та чернетки. Закриті рейди винесені в окремий архів нижче."
                : "Тут видно рейди, на які можна записатися або переглянути свій статус."}
            </p>
            <div
              className="raid-list-summary dashboard-list-summary"
              aria-label="Коротка статистика рейдів"
            >
              <span>Усього: {visibleTotal}</span>
              <span>Активні: {activeRaids.length}</span>
              {canManage ? <span>Чернетки: {draftRaids.length}</span> : null}
              <span>Архів: {closedRaids.length}</span>
            </div>
          </div>
          {canManage ? (
            <div className="raid-list-head-actions">
              <a className="btn subtle" href="/raids/bench-priority">
                🩶 Сірий список
              </a>
              <a className="btn primary" href="/raids/new">
                ＋ Створити рейд
              </a>
            </div>
          ) : null}
        </div>
        <div className="raid-manager-list dashboard-list">
          {currentRaids.length ? (
            currentRaids.map((raid) => (
              <RaidListCard key={raid.id} raid={raid} canManage={canManage} />
            ))
          ) : (
            <p className="raid-empty">Активних рейдів поки немає.</p>
          )}
        </div>
      </section>

      <section className="panel raid-list-page-panel raid-list-page-panel--archive dashboard-list-panel dashboard-list-panel--archive">
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
              <span>Закрито: {closedRaids.length}</span>
            </div>
          </div>
        </div>
        {closedRaids.length ? (
          <RaidArchiveLoadMore step={6} total={closedRaids.length}>
            {closedRaids.map((raid) => (
              <RaidListCard key={raid.id} raid={raid} canManage={canManage} />
            ))}
          </RaidArchiveLoadMore>
        ) : (
          <div className="raid-manager-list raid-manager-list--archive dashboard-list dashboard-list--archive">
            <p className="raid-empty">
              Минулі рейди з’являться тут після завершення.
            </p>
          </div>
        )}
      </section>
    </RaidPageShell>
  );
}
