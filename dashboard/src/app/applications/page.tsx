import ApplicationStatusActions from "@/components/ApplicationStatusActions";
import ApplicationFilters from "@/components/ApplicationFilters";
import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
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

  return (
    <main className="container">
      <section className="dashboard-shell content-shell applications-page" aria-label="Панель заявок Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="applications" />
        <header className="hero panel dashboard-hero">
        <div className="hero-copy dashboard-hero__copy">
          <div className="eyebrow">Mistblossom Vanguard • Заявки</div>
          <h1>Заявки до гільдії</h1>
          <span className="hero-accent" aria-hidden="true" />
          <p className="lead">Переглядай заявки, оцінюй персонажів і швидко приймай рішення без зайвих переходів.</p>
          <div className="hero-secure-note">
            <span className="hero-lock" aria-hidden="true">🔒</span>
            <span>{mayManageApplications ? "Доступ відкрито ролям модерації." : "Доступ відкрито в режимі перегляду без Discord і BattleTag."}</span>
          </div>
        </div>

        <HeroSidePanel
          ariaLabel="Огляд заявок"
          summary={[
            { label: "ЗАЯВКИ", value: `${counts.all} всього`, note: "Живий список кандидатів" },
            { label: "ДОСТУП", value: mayManageApplications ? "Модерація" : "Перегляд", note: mayManageApplications ? "Можна змінювати статуси" : "Discord і BattleTag приховано" },
          ]}
          stats={[
            { label: "НА РОЗГЛЯДІ", value: counts.review.toLocaleString("uk-UA") },
            { label: "ПРИЙНЯТО", value: counts.accepted.toLocaleString("uk-UA") },
            { label: "ВІДХИЛЕНО", value: counts.declined.toLocaleString("uk-UA") },
          ]}
        />
        </header>
      <section className="stats">
        <div className="stat panel"><strong>{counts.all}</strong><span>Всього</span></div>
        <div className="stat panel review"><strong>{counts.review}</strong><span>На розгляді</span></div>
        <div className="stat panel accepted"><strong>{counts.accepted}</strong><span>Прийнято</span></div>
        <div className="stat panel declined"><strong>{counts.declined}</strong><span>Відхилено</span></div>
      </section>

      <ApplicationFilters
        initialQuery={params.q || ""}
        initialStatus={params.status || "all"}
        initialClass={params.class || "all"}
        initialSort={params.sort || "created"}
        classOptions={classOptions}
      />

      {!mayManageApplications ? <div className="notice panel">Режим наставника: заявки можна переглядати, але Discord і BattleTag приховано, а рішення по кандидатах недоступні.</div> : null}

      <section className="grid">
        {items.length ? items.map((item) => (
          <article className={`card panel ${item.status_key}`} key={String(item.id || item.tracking_number || item.number)}>
            <div className="card-main">
              <div className="character-head">
                <CharacterAvatar item={item} />
                <div>
                  <h2>Заявка #{item.number || "—"} • {item.character_name || item.title}</h2>
                  <div className="meta">
                    <span>{item.region || "Region?"}</span>
                    <span>{item.realm || "Realm не вказано"}</span>
                    <span>{item.class_name || "Клас не вказано"}</span>
                    <span>{item.faction || "Фракція не вказана"}</span>
                    <span>{formatDate(item.created_at)}</span>
                    {mayViewSensitiveApplications && item.html_url ? <a href={item.html_url} target="_blank" rel="noreferrer">Відкрити заявку</a> : null}
                  </div>
                </div>
              </div>

              <div className="details-grid">
                <div className="detail-box"><span>Номер відстеження</span><strong>{item.tracking_number || "Не вказано"}</strong></div>
                <div className="detail-box"><span>Звідки дізнався</span><strong>{item.source || "Не вказано"}</strong></div>
                {mayViewSensitiveApplications ? <div className="detail-box"><span>Discord</span><strong>{item.discord || "Не вказано"}</strong></div> : null}
                {mayViewSensitiveApplications ? <div className="detail-box"><span>BattleTag</span><strong>{item.battle_tag || "Не вказано"}</strong></div> : null}
                <div className="detail-box"><span>Коли грає</span><strong>{item.availability || "Не вказано"}</strong></div>
              </div>

              <RaiderIoPanel item={item} />
            </div>

            <aside className="actions-panel">
              <ApplicationStatusActions issueNumber={item.number} initialStatus={item.status_key} issueState={item.state} canModerate={mayManageApplications} />
              <small>{item.state === "closed" ? "Заявку закрито" : "Очікує рішення"}</small>
            </aside>
          </article>
        )) : <div className="empty panel">Заявок за цими фільтрами немає.</div>}
      </section>
      </section>
    </main>
  );
}
