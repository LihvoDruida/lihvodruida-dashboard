import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import HomeDashboardLiveSync from "@/components/HomeDashboardLiveSync";
import { HomeLocalTime } from "@/components/HomeLocalTime";
import HomeUpcomingRaidList, { type HomeUpcomingRaid } from "@/components/HomeUpcomingRaidList";
import { getSessionUser, isAuthenticated } from "@/lib/auth";
import { fetchRaiderIoRegionPeriods, type RaiderIoPeriodWindow, type RaiderIoRegionPeriods } from "@/lib/raiderIo";
import { absoluteDashboardUrl, buildPageMetadata } from "@/lib/seo";
import {
  isRaidClosed,
  listRaids,
  raidActiveRosterSize,
  raidDifficultyLabel,
  raidTitle,
  type RaidItem,
} from "@/lib/raids";
import {
  listRaidPolls,
  pollVoteCounts,
  raidPollDifficultyLabel,
  raidPollSlotSummary,
  raidPollStatusLabel,
  raidPollUniqueDayRecommendations,
} from "@/lib/raidPolls";
import { RAID_POLL_DAYS, type RaidPollDay, type RaidPollItem } from "@/lib/raidPollShared";

export const metadata = buildPageMetadata({
  title: "Головна",
  description: "КД-календар Mistblossom Vanguard з Raider.IO periods, локальним часом користувача, рейдами та live-результатами голосувань.",
  path: "/",
  keywords: ["КД календар", "Raider.IO periods", "WoW raid calendar", "рейд голосування", "Google Calendar"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAID_TIME_ZONE = process.env.RAID_TIME_ZONE || process.env.NEXT_PUBLIC_RAID_TIME_ZONE || "Europe/Kyiv";
const DATE_TIME_LABEL = new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short", timeZone: RAID_TIME_ZONE });
const DATE_LABEL = new Intl.DateTimeFormat("uk-UA", { weekday: "short", day: "2-digit", month: "short", timeZone: RAID_TIME_ZONE });

const KD_REGION = "eu";
const RAID_DURATION_MS = 4 * 60 * 60 * 1000;

type KdPeriodKind = "previous" | "current" | "next";

type KdCalendarPeriod = {
  key: string;
  kind: KdPeriodKind;
  title: string;
  period: number;
  startIso: string;
  endIso: string;
  fallbackStart: string;
  fallbackEnd: string;
  raids: RaidItem[];
};

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}

function zonedRaidDateToUtc(dateValue: string, timeValue: string, timeZone = RAID_TIME_ZONE) {
  const [year, month, day] = String(dateValue || "").split("-").map(Number);
  if (!year || !month || !day) return null;

  const [rawHour = 20, rawMinute = 0] = String(timeValue || "20:00").split(":").map(Number);
  const hour = Number.isFinite(rawHour) ? rawHour : 20;
  const minute = Number.isFinite(rawMinute) ? rawMinute : 0;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  const offset = timeZoneOffsetMs(new Date(localAsUtc), timeZone);
  let utc = localAsUtc - offset;
  const correctedOffset = timeZoneOffsetMs(new Date(utc), timeZone);
  if (correctedOffset !== offset) utc = localAsUtc - correctedOffset;

  return new Date(utc);
}

function parseRaidDate(raid: Pick<RaidItem, "date" | "time">) {
  return zonedRaidDateToUtc(String(raid.date || ""), String(raid.time || "20:00"));
}

function dashboardNowMs() {
  return Date.now();
}

function formatDateTime(value?: string | number | null) {
  if (!value) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return DATE_TIME_LABEL.format(date);
}

function formatPollDays(days: RaidPollDay[]) {
  const dayMap = new Map(RAID_POLL_DAYS.map((day) => [day.value, day.label]));
  return days.length ? days.map((day) => dayMap.get(day) || day).join(" • ") : "Усі дні";
}

function eventStatusLabel(raid: RaidItem) {
  if (raid.status === "draft") return "Чернетка";
  if (isRaidClosed(raid)) return "Закрито";
  return "Опубліковано";
}

function upcomingRaidSort(a: RaidItem, b: RaidItem) {
  const aDate = parseRaidDate(a)?.getTime() || 0;
  const bDate = parseRaidDate(b)?.getTime() || 0;
  return aDate - bDate;
}

function homeRevision(raids: RaidItem[], polls: RaidPollItem[], periods: KdCalendarPeriod[]) {
  const raidPart = raids.map((raid) => `${raid.id}:${raid.status}:${raid.updatedAt || raid.closedAt || raid.publishedAt || ""}:${raid.signups.length}`).join("|");
  const pollPart = polls.map((poll) => `${poll.id}:${poll.status}:${poll.updatedAt || poll.closedAt || ""}:${poll.votes.length}`).join("|");
  const periodPart = periods.map((period) => `${period.kind}:${period.period}:${period.startIso}:${period.endIso}:${period.raids.length}`).join("|");
  return `${raidPart}::${pollPart}::${periodPart}`;
}

function googleCalendarUrl() {
  const feedUrl = absoluteDashboardUrl("/api/calendar/raids.ics");
  const webcalUrl = feedUrl.replace(/^https:/i, "webcal:").replace(/^http:/i, "webcal:");
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({ cid: webcalUrl }).toString()}`;
}

function periodKindTitle(kind: KdPeriodKind) {
  if (kind === "current") return "Поточне КД";
  if (kind === "previous") return "Минуле КД";
  return "Наступне КД";
}

function buildFallbackEuPeriods(now = new Date()): RaiderIoRegionPeriods {
  const day = now.getUTCDay();
  const daysFromWednesday = (day + 4) % 7;
  const currentStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromWednesday, 4, 0, 0));
  if (now.getTime() < currentStart.getTime()) currentStart.setUTCDate(currentStart.getUTCDate() - 7);
  const previousStart = new Date(currentStart);
  previousStart.setUTCDate(currentStart.getUTCDate() - 7);
  const nextStart = new Date(currentStart);
  nextStart.setUTCDate(currentStart.getUTCDate() + 7);
  const nextEnd = new Date(nextStart);
  nextEnd.setUTCDate(nextStart.getUTCDate() + 7);
  const seedPeriod = Math.floor(currentStart.getTime() / (7 * 24 * 60 * 60 * 1000));

  return {
    region: KD_REGION,
    previous: { period: seedPeriod - 1, start: previousStart.toISOString(), end: currentStart.toISOString() },
    current: { period: seedPeriod, start: currentStart.toISOString(), end: nextStart.toISOString() },
    next: { period: seedPeriod + 1, start: nextStart.toISOString(), end: nextEnd.toISOString() },
    updatedAt: now.toISOString(),
  };
}

function raidsInPeriod(raids: RaidItem[], period: RaiderIoPeriodWindow) {
  const start = new Date(period.start).getTime();
  const end = new Date(period.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  return raids
    .filter((raid) => {
      const startsAt = parseRaidDate(raid)?.getTime();
      return startsAt ? startsAt >= start && startsAt < end : false;
    })
    .sort(upcomingRaidSort);
}

function buildKdPeriods(periods: RaiderIoRegionPeriods, raids: RaidItem[]): KdCalendarPeriod[] {
  const entries: Array<[KdPeriodKind, RaiderIoPeriodWindow]> = [
    ["previous", periods.previous],
    ["current", periods.current],
    ["next", periods.next],
  ];

  return entries.map(([kind, period]) => ({
    key: `${kind}-${period.period}`,
    kind,
    title: periodKindTitle(kind),
    period: period.period,
    startIso: period.start,
    endIso: period.end,
    fallbackStart: formatDateTime(period.start),
    fallbackEnd: formatDateTime(period.end),
    raids: raidsInPeriod(raids, period),
  }));
}

function periodProgress(period: KdCalendarPeriod, now: number) {
  const start = new Date(period.startIso).getTime();
  const end = new Date(period.endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
}

function RaidCalendarEvent({ raid }: { raid: RaidItem }) {
  const roster = raidActiveRosterSize(raid);
  const startsAt = parseRaidDate(raid);
  return (
    <a className={`home-calendar-event home-calendar-event--${raid.difficulty} home-calendar-event--${raid.status}`} href={`/raids/${encodeURIComponent(raid.id)}`}>
      <span className="home-calendar-event__time"><HomeLocalTime value={startsAt?.toISOString()} fallback={`${raid.date || "—"} ${raid.time || "20:00"}`} mode="compact" /></span>
      <span className="home-calendar-event__title">{raid.title}</span>
      <span className="home-calendar-event__details">
        <b>{raidDifficultyLabel(raid.difficulty)}</b>
        <em>{eventStatusLabel(raid)}</em>
        <em>{roster} запис.</em>
      </span>
    </a>
  );
}

function KdPeriodCard({ period, now }: { period: KdCalendarPeriod; now: number }) {
  const progress = periodProgress(period, now);
  return (
    <article className={`home-kd-card home-kd-card--${period.kind}`}>
      <header className="home-kd-card__head">
        <div>
          <span className="home-kd-card__eyebrow">{period.title}</span>
          <h3>КД #{period.period}</h3>
        </div>
        <span className="home-kd-card__count">{period.raids.length} рейд.</span>
      </header>

      <div className="home-kd-card__range" aria-label="Період КД">
        <span>
          <b>Старт</b>
          <HomeLocalTime value={period.startIso} fallback={period.fallbackStart} mode="compact" />
        </span>
        <span>
          <b>Кінець</b>
          <HomeLocalTime value={period.endIso} fallback={period.fallbackEnd} mode="compact" />
        </span>
      </div>

      {period.kind === "current" ? (
        <div className="home-kd-progress" aria-label="Прогрес поточного КД">
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      <div className="home-calendar-events home-kd-card__events">
        {period.raids.length ? period.raids.map((raid) => <RaidCalendarEvent key={raid.id} raid={raid} />) : <p className="home-empty-text">Немає рейдів у цьому КД.</p>}
      </div>
    </article>
  );
}

function PollResultCard({ poll, relatedPolls }: { poll: RaidPollItem; relatedPolls: RaidPollItem[] }) {
  const counts = pollVoteCounts(poll);
  const recommendations = raidPollUniqueDayRecommendations(poll, relatedPolls, 2);
  return (
    <article className={`home-poll-card home-poll-card--${poll.status}`}>
      <div className="home-poll-card__status">
        <span>{poll.status === "open" ? "Відкрите" : "Закрите"}</span>
        <strong>{raidPollStatusLabel(poll)}</strong>
      </div>
      <div className="home-poll-card__body">
        <header>
          <span className={`home-difficulty home-difficulty--${poll.difficulty}`}>{raidPollDifficultyLabel(poll.difficulty)}</span>
          <h3>{poll.title}</h3>
          <p>{formatPollDays(poll.days)}</p>
        </header>
        <dl className="home-poll-metrics">
          <div>
            <dt>Старт</dt>
            <dd><HomeLocalTime value={poll.createdAt} fallback={formatDateTime(poll.createdAt)} mode="compact" /></dd>
          </div>
          <div>
            <dt>{poll.status === "open" ? "Закриття" : "Завершено"}</dt>
            <dd><HomeLocalTime value={poll.status === "open" ? poll.closesAtMs : poll.closedAt || poll.closesAtMs} fallback={poll.status === "open" ? formatDateTime(poll.closesAtMs) : formatDateTime(poll.closedAt || poll.closesAtMs)} mode="compact" /></dd>
          </div>
          <div>
            <dt>Голосів</dt>
            <dd>{counts.total}</dd>
          </div>
        </dl>
        <div className="home-poll-slots">
          {recommendations.length ? recommendations.map((slot, index) => (
            <span key={`${poll.id}-${slot.day}-${slot.time}`}>
              <b>{index + 1}</b>{raidPollSlotSummary(slot)}
            </span>
          )) : <em>Недостатньо голосів для розрахунку рекомендованих слотів.</em>}
        </div>
      </div>
      <footer>
        <a className="btn subtle" href={`/polls/${encodeURIComponent(poll.id)}`}>Деталі</a>
        {poll.messageUrl ? <a className="btn subtle" href={poll.messageUrl} target="_blank" rel="noreferrer">Discord</a> : null}
      </footer>
    </article>
  );
}

export default async function HomePage() {
  if (!(await isAuthenticated())) {
    redirect("/login");
    throw new Error("Login required");
  }
  const user = await getSessionUser();
  if (!user) {
    redirect("/login");
    throw new Error("Login required");
  }

  const [raids, polls, raiderIoPeriods] = await Promise.all([
    listRaids(180).catch(() => []),
    listRaidPolls(120).catch(() => []),
    fetchRaiderIoRegionPeriods(KD_REGION).catch(() => null),
  ]);

  const visibleRaids = raids.filter((raid) => raid.status !== "draft");
  const now = dashboardNowMs();
  const periods = buildKdPeriods(raiderIoPeriods || buildFallbackEuPeriods(new Date(now)), visibleRaids);
  const currentPeriod = periods.find((period) => period.kind === "current") || periods[1];
  const upcomingRaids = visibleRaids
    .filter((raid) => {
      const date = parseRaidDate(raid);
      return date ? date.getTime() >= now - RAID_DURATION_MS : false;
    })
    .sort(upcomingRaidSort)
    .slice(0, 8);
  const upcomingRaidItems: HomeUpcomingRaid[] = upcomingRaids
    .map((raid) => {
      const startsAt = parseRaidDate(raid);
      if (!startsAt) return null;
      return {
        id: raid.id,
        href: `/raids/${encodeURIComponent(raid.id)}`,
        title: raidTitle(raid),
        difficulty: raid.difficulty,
        difficultyLabel: raidDifficultyLabel(raid.difficulty),
        statusLabel: eventStatusLabel(raid),
        startsAtIso: startsAt.toISOString(),
        sourceTime: raid.time || "20:00",
        sourceDate: raid.date || "",
        roster: raidActiveRosterSize(raid),
      };
    })
    .filter(Boolean) as HomeUpcomingRaid[];
  const openPolls = polls.filter((poll) => poll.status === "open");
  const publishedPolls = polls.filter((poll) => poll.channelId && poll.messageId);
  const spotlightPolls = [...openPolls, ...polls.filter((poll) => poll.status === "closed")].slice(0, 6);
  const calendarFeedUrl = absoluteDashboardUrl("/api/calendar/raids.ics");
  const rioSourceLabel = raiderIoPeriods ? "Raider.IO EU" : "Fallback EU";

  return (
    <main className="container home-page">
      <section className="dashboard-shell content-shell home-shell" aria-label="Головна панель Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="home" />

        <header className="hero panel dashboard-hero home-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Рейдовий центр</div>
            <div className="content-hero-status-row">
              <span className="content-mode-pill content-mode-pill--library">КД #{currentPeriod?.period || "—"}</span>
              <span className="content-hero-path">{rioSourceLabel} • локальний час користувача</span>
            </div>
            <h1>КД-календар рейдів</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">Тиждень рахується як КД за EU periods з Raider.IO: старт у середу, кінець наступної середи. Усі години на сторінці автоматично показуються в локальній часовій зоні того, хто відкрив dashboard.</p>
            <div className="home-hero-actions">
              <a className="btn primary" href="/raids">Відкрити рейди</a>
              <a className="btn subtle" href="/polls">Голосування</a>
            </div>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд КД-календаря"
            summary={[
              { label: "ПОТОЧНЕ КД", value: `#${currentPeriod?.period || "—"}`, note: `${currentPeriod?.raids.length || 0} рейд. у поточному КД` },
              { label: "ГОЛОСУВАННЯ", value: `${openPolls.length} live`, note: "Автооновлення без перезавантаження" },
            ]}
            stats={[
              { label: "REGION", value: KD_REGION.toUpperCase() },
              { label: "TIME", value: "LOCAL" },
              { label: "SYNC", value: raiderIoPeriods ? "RIO" : "SAFE" },
            ]}
          />
        </header>

        <HomeDashboardLiveSync initialRevision={homeRevision(visibleRaids, polls, periods)} />

        <section className="home-calendar-toolbar panel" aria-label="Керування КД-календарем">
          <div>
            <span className="home-kicker">Raider.IO periods</span>
            <h2>КД #{currentPeriod?.period || "—"}</h2>
            <p>
              Поточне КД: <HomeLocalTime value={currentPeriod?.startIso} fallback={currentPeriod?.fallbackStart || "—"} mode="compact" /> — <HomeLocalTime value={currentPeriod?.endIso} fallback={currentPeriod?.fallbackEnd || "—"} mode="compact" />.
            </p>
          </div>
          <div className="home-calendar-actions">
            <a className="btn primary" href="/raids/new">Створити рейд</a>
            <a className="btn subtle" href="/polls/new">Нове голосування</a>
            <a className="btn subtle" href="/raids">Усі рейди</a>
          </div>
        </section>

        <section className="home-layout">
          <section className="panel home-calendar-panel home-kd-panel" aria-label="КД-календар рейдів">
            <div className="home-kd-panel__head">
              <div>
                <span className="home-kicker">КД календар</span>
                <h2>Рейди за тижнями Raider.IO</h2>
              </div>
              <p>Старт КД береться з Raider.IO, а рейди потрапляють у КД за реальним UTC-часом старту.</p>
            </div>
            <div className="home-kd-grid">
              {periods.map((period) => <KdPeriodCard key={period.key} period={period} now={now} />)}
            </div>
          </section>

          <aside className="home-side-stack">
            <section className="panel home-import-card" aria-label="Імпорт календаря">
              <span className="home-kicker">Google Calendar</span>
              <h2>Імпорт рейдів</h2>
              <p>Додай рейдовий фід у Google Calendar або відкрий `.ics` напряму. Сире посилання прибрано з екрана, щоб не забивати інтерфейс.</p>
              <div className="home-import-actions">
                <a className="btn primary" href={googleCalendarUrl()} target="_blank" rel="noreferrer">Додати в Google</a>
                <a className="btn subtle" href="/api/calendar/raids.ics" download="mistblossom-raids.ics">Завантажити .ics</a>
                <a className="btn subtle" href={calendarFeedUrl} target="_blank" rel="noreferrer">Відкрити фід</a>
              </div>
            </section>

            <section className="panel home-upcoming-card" aria-label="Найближчі рейди">
              <span className="home-kicker">Найближче</span>
              <h2>Рейди</h2>
              <HomeUpcomingRaidList raids={upcomingRaidItems} initialNow={now} />
            </section>
          </aside>
        </section>

        <section className="panel home-polls-section" aria-label="Живі результати голосувань">
          <div className="home-section-head">
            <div>
              <span className="home-kicker">Live raid polls</span>
              <h2>Динамічні результати голосувань</h2>
              <p>Показуємо назву, дати, статус, кількість голосів і рекомендовані слоти. Сторінка сама підтягує оновлення.</p>
            </div>
            <a className="btn subtle" href="/polls">Усі голосування</a>
          </div>
          <div className="home-polls-grid">
            {spotlightPolls.length ? spotlightPolls.map((poll) => <PollResultCard key={poll.id} poll={poll} relatedPolls={publishedPolls} />) : <p className="home-empty-text">Голосувань ще немає.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}
