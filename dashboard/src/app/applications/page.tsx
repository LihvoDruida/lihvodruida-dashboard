import ApplicationStatusActions from "@/components/ApplicationStatusActions";
import ApplicationFilters from "@/components/ApplicationFilters";
import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import { buildPageMetadata } from "@/lib/seo";
export const metadata = buildPageMetadata({
  title: "Заявки до гільдії",
  description: "Перегляд заявок до Mistblossom Vanguard, статусів кандидатів, персонажів і коротких підказок для офіцерів.",
  path: "/applications",
  keywords: ["заявки до гільдії", "кандидати WoW", "офіцерська панель"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;
import { getSessionUser, isAuthenticated } from "@/lib/auth";
import { canManageApplications, canViewApplicationBattleTag, canViewApplications } from "@/lib/permissions";
import { ApplicationItem, listApplicationFilterOptions, listApplications, sanitizeApplicationsForMentorViewer } from "@/lib/github";
import { getOwnProfilePath } from "@/lib/profiles";

function formatDate(value?: string | null) {
  if (!value) return "Дата невідома";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Дата невідома";
  return new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatScore(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "—";
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}


function MiniMetric({ label, value }: { label: string; value: string }) {
  return <span className="mini-metric"><strong>{value}</strong><small>{label}</small></span>;
}

function formatRaidName(raid: unknown): string | null {
  if (typeof raid === "string") {
    const value = raid.trim();
    return value || null;
  }

  if (raid && typeof raid === "object") {
    const item = raid as {
      name?: string;
      key?: string;
      summary?: string;
      mythic_bosses_killed?: number;
      heroic_bosses_killed?: number;
      normal_bosses_killed?: number;
      total_bosses?: number;
    };

    const baseName = item.name || item.key || "Raid";
    if (item.summary && item.summary.trim()) return `${baseName}: ${item.summary.trim()}`;

    const total = Number(item.total_bosses || 0) > 0 ? item.total_bosses : "?";
    const progress = [
      Number(item.mythic_bosses_killed || 0) > 0 ? `${item.mythic_bosses_killed}/${total} M` : "",
      Number(item.heroic_bosses_killed || 0) > 0 ? `${item.heroic_bosses_killed}/${total} H` : "",
      Number(item.normal_bosses_killed || 0) > 0 ? `${item.normal_bosses_killed}/${total} N` : "",
    ].filter(Boolean).join(" • ");

    return progress ? `${baseName}: ${progress}` : null;
  }

  return null;
}

function getRaidLines(raids: unknown[] | undefined): string[] {
  return (Array.isArray(raids) ? raids : [])
    .map(formatRaidName)
    .filter((value): value is string => Boolean(value));
}

function raidKey(raid: unknown, index: number): string {
  if (typeof raid === "string") return `${raid}-${index}`;

  if (raid && typeof raid === "object") {
    const item = raid as { key?: string; name?: string; summary?: string };
    return `${item.key || item.name || item.summary || "raid"}-${index}`;
  }

  return `raid-${index}`;
}

function getCharacterAvatarUrl(item: ApplicationItem): string | undefined {
  return item.avatar_url || item.raider_io?.thumbnail_url || undefined;
}

function getInitial(value?: string | null): string {
  return (value || "?").trim().charAt(0).toUpperCase() || "?";
}

function CharacterAvatar({ item }: { item: ApplicationItem }) {
  const avatarUrl = getCharacterAvatarUrl(item);

  if (avatarUrl) {
    return <img className="character-avatar" src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />;
  }

  return (
    <div className="character-avatar placeholder">
      {getInitial(item.character_name || item.title)}
    </div>
  );
}

function RaiderIoPanel({ item }: { item: ApplicationItem }) {
  const rio = item.raider_io ?? null;
  const current = rio?.mythic_plus?.current || {};
  const previous = rio?.mythic_plus?.previous || {};
  const currentRaids = getRaidLines(rio?.raids?.current);
  const previousRaids = getRaidLines(rio?.raids?.previous);

  return (
    <div className="rio-panel">
      <div className="section-title">Raider.IO</div>
      {(item.raider_io_error ?? null) ? <p className="hint warning">Raider.IO тимчасово не відповів для цього персонажа.</p> : null}
      <div className="metric-grid">
        <MiniMetric label="M+ зараз" value={formatScore(current.all)} />
        <MiniMetric label="Хіл" value={formatScore(current.healer)} />
        <MiniMetric label="DPS" value={formatScore(current.dps)} />
        <MiniMetric label="Танк" value={formatScore(current.tank)} />
        <MiniMetric label="M+ попередній" value={formatScore(previous.all)} />
      </div>
      <div className="raid-grid">
        <div>
          <strong>Рейди зараз</strong>
          {currentRaids.length ? currentRaids.map((raid, index) => <span key={raidKey(raid, index)}>{raid}</span>) : <span>Дані відсутні</span>}
        </div>
        <div>
          <strong>Рейди раніше</strong>
          {previousRaids.length ? previousRaids.map((raid, index) => <span key={raidKey(raid, index)}>{raid}</span>) : <span>Дані відсутні</span>}
        </div>
      </div>
      {rio?.profile_url ? <a className="rio-link" href={rio.profile_url} target="_blank" rel="noreferrer">Відкрити Raider.IO</a> : null}
    </div>
  );
}

export default async function DashboardPage({
  searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!(await isAuthenticated())) { redirect("/login"); throw new Error("Login required"); }
  const user = await getSessionUser();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  const mayViewApplications = canViewApplications(user);
  const mayManageApplications = canManageApplications(user);
  const mayViewSensitiveApplications = canViewApplicationBattleTag(user);
  if (!mayViewApplications) redirect(await getOwnProfilePath(user));
  const params = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) urlParams.set(key, value);
  const [rawItems, filterOptions] = await Promise.all([listApplications(urlParams), listApplicationFilterOptions()]);
  const items = mayViewSensitiveApplications ? rawItems : sanitizeApplicationsForMentorViewer(rawItems);
  const counts = {
    all: items.length,
    review: items.filter((item) => item.status_key === "review").length,
    accepted: items.filter((item) => item.status_key === "accepted").length,
    declined: items.filter((item) => item.status_key === "declined").length
  };
  const classOptions = filterOptions.classes;

  const newestReview = items.find((item) => item.status_key === "review");
  const sourceLabel = "lihvodruida.pp.ua → VPS";

  return (
    <main className="container app-page">
      <section className="dashboard-shell content-shell applications-page app-page-stack" aria-label="Панель заявок Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="applications" />

        <header className="applications-hero panel">
          <div className="applications-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Recruitment desk</div>
            <h1>Заявки до гільдії</h1>
            <p className="lead">Одна черга для сайту, PostgreSQL і Discord. Нові заявки з Main Site з’являються тут одразу після відправлення.</p>
            <div className="applications-hero__signals" aria-label="Стан інтеграції">
              <span className="applications-signal applications-signal--online"><i aria-hidden="true" />Main Site ↔ VPS</span>
              <span className="applications-signal">PostgreSQL source of truth</span>
              <span className="applications-signal">Discord sync</span>
              <span className="applications-signal">Raider.IO enrichment</span>
            </div>
          </div>

          <div className="applications-command" aria-label="Черга заявок">
            <div className="applications-command__head">
              <span>Черга модерації</span>
              <strong>{counts.review}</strong>
            </div>
            <div className="applications-command__grid">
              <div><span>Усього</span><strong>{counts.all}</strong></div>
              <div className="is-review"><span>На розгляді</span><strong>{counts.review}</strong></div>
              <div className="is-accepted"><span>Прийнято</span><strong>{counts.accepted}</strong></div>
              <div className="is-declined"><span>Відхилено</span><strong>{counts.declined}</strong></div>
            </div>
            <div className="applications-command__footer">
              <span className="applications-command__pulse" aria-hidden="true" />
              <span>{sourceLabel}</span>
              <small>{newestReview?.created_at ? `Найновіша: ${formatDate(newestReview.created_at)}` : "Черга порожня"}</small>
            </div>
          </div>
        </header>

        <section className="applications-workbench">
          <div className="applications-workbench__head">
            <div>
              <span className="section-kicker">Кандидати</span>
              <h2>Швидка обробка заявок</h2>
              <p>Пошук і фільтри працюють без окремої сторінки, рішення синхронізується з публічним статусом заявки.</p>
            </div>
            <div className="applications-access-chip" data-mode={mayManageApplications ? "manage" : "read"}>
              <span aria-hidden="true">{mayManageApplications ? "◆" : "◇"}</span>
              <div><strong>{mayManageApplications ? "Модерація" : "Перегляд"}</strong><small>{mayManageApplications ? "Статуси можна змінювати" : "Контакти приховано"}</small></div>
            </div>
          </div>

          <ApplicationFilters
            initialQuery={params.q || ""}
            initialStatus={params.status || "all"}
            initialClass={params.class || "all"}
            initialSort={params.sort || "created"}
            classOptions={classOptions}
          />
        </section>

        {!mayManageApplications ? <div className="notice panel">Режим наставника: заявки можна переглядати, але Discord і BattleTag приховано, а рішення по кандидатах недоступні.</div> : null}

        <section className="applications-list" aria-live="polite">
          {items.length ? items.map((item) => {
            const characterName = item.character_name || item.title || "Персонаж";
            const statusLabel = item.status_text || "На розгляді";
            const sourceSystem = typeof item.source_system === "string" ? item.source_system : "application-store";
            return (
              <article className={`application-card panel application-card--${item.status_key}`} key={String(item.id || item.tracking_number || item.number)}>
                <div className="application-card__statusbar" aria-hidden="true" />
                <div className="application-card__main">
                  <header className="application-card__header">
                    <CharacterAvatar item={item} />
                    <div className="application-card__identity">
                      <div className="application-card__titleline">
                        <div>
                          <span className="application-card__number">Заявка #{item.number || "—"}</span>
                          <h2>{characterName}</h2>
                        </div>
                        <span className={`application-state application-state--${item.status_key}`}>{statusLabel}</span>
                      </div>
                      <div className="application-card__meta">
                        <span>{String(item.region || "eu").toUpperCase()}-{item.realm || "Realm?"}</span>
                        <span>{item.class_name || "Клас не вказано"}</span>
                        <span>{item.faction || "Фракція не вказана"}</span>
                        <span>{formatDate(item.created_at)}</span>
                      </div>
                    </div>
                  </header>

                  <div className="application-card__content">
                    <section className="application-facts" aria-label="Дані кандидата">
                      <div className="application-fact application-fact--tracking"><span>Відстеження</span><strong>{item.tracking_number || "—"}</strong></div>
                      <div className="application-fact"><span>Джерело</span><strong>{item.source || "Не вказано"}</strong></div>
                      <div className="application-fact application-fact--wide"><span>Коли грає</span><strong>{item.availability || "Не вказано"}</strong></div>
                      {mayViewSensitiveApplications ? <div className="application-fact"><span>Discord</span><strong>{item.discord || "Не вказано"}</strong></div> : null}
                      {mayViewSensitiveApplications ? <div className="application-fact"><span>BattleTag</span><strong>{item.battle_tag || "Не вказано"}</strong></div> : null}
                    </section>

                    <RaiderIoPanel item={item} />
                  </div>

                  <footer className="application-card__footer">
                    <div className="application-card__source">
                      <span className="application-source-dot" aria-hidden="true" />
                      <span>{sourceSystem === "public-site" ? "Надіслано з Main Site" : "Синхронізовано зі сховищем"}</span>
                    </div>
                    {mayViewSensitiveApplications && item.html_url ? <a className="application-card__external" href={item.html_url} target="_blank" rel="noreferrer">Відкрити джерело ↗</a> : null}
                  </footer>
                </div>

                <aside className="application-card__decision">
                  <div className="application-card__decision-title"><span>Рішення</span><small>#{item.number}</small></div>
                  <ApplicationStatusActions issueNumber={item.number} initialStatus={item.status_key} issueState={item.state} canModerate={mayManageApplications} />
                  <div className="application-card__decision-state">{item.state === "closed" ? "Заявку закрито" : "Очікує рішення офіцера"}</div>
                </aside>
              </article>
            );
          }) : (
            <div className="applications-empty-state panel">
              <span aria-hidden="true">◇</span>
              <h2>Заявок за цими фільтрами немає</h2>
              <p>Скинь фільтри або зачекай нову заявку з lihvodruida.pp.ua.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
