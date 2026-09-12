"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type {
  GuildRaidProgress,
  GuildRosterMember,
  GuildRosterStats,
  GuildScoreSegment,
} from "@/lib/guildRoster";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { formatStableNumber, stableTextCompare } from "@/lib/stableUiText";
import styles from "./GuildRoster.module.css";

type SortKey =
  | "rio-desc"
  | "rio-asc"
  | "ilvl-desc"
  | "raid-desc"
  | "name-asc"
  | "rank-asc";

type RaidClearFilter =
  | "all"
  | "progress"
  | "normal-clear"
  | "heroic-clear"
  | "mythic-clear"
  | "no-raid";

type LinkFilter = "all" | "profile" | "raiderio";

type Props = {
  members: GuildRosterMember[];
  stats: GuildRosterStats;
  source: string;
  error?: string | null;
};

type GuildRosterLivePayload = Props & {
  ok?: boolean;
  memberCount?: number;
  updatedAt?: string | null;
  refresh?: {
    sync?: {
      status?: string;
      phase?: string;
      totalMembers?: number;
      processed?: { roster?: number; battleNet?: number; raiderIo?: number };
    };
  };
};

const SEGMENT_LABELS: Record<GuildScoreSegment, string> = {
  all: "Загальний",
  dps: "DPS",
  healer: "Heal",
  tank: "Tank",
};

const ROLE_FILTERS = [
  { value: "all", label: "Всі" },
  { value: "tank", label: "Tank" },
  { value: "healer", label: "Heal" },
  { value: "dps", label: "DPS" },
] as const;

const CLASS_COLOR: Record<string, string> = {
  "death knight": "#c41e3a",
  "demon hunter": "#a330c9",
  druid: "#ff7c0a",
  evoker: "#33937f",
  hunter: "#aad372",
  mage: "#3fc7eb",
  monk: "#00ff98",
  paladin: "#f48cba",
  priest: "#ffffff",
  rogue: "#fff468",
  shaman: "#0070dd",
  warlock: "#8788ee",
  warrior: "#c69b6d",
};

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return formatStableNumber(value, digits);
}

function formatRosterDate(value?: string | null) {
  if (!value) return "ще немає";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Kyiv",
  }).format(date);
}

function uniqueSorted(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((a, b) => stableTextCompare(a, b));
}

function roleShort(role: string) {
  if (role === "tank") return "Tank";
  if (role === "healer") return "Heal";
  if (role === "dps") return "DPS";
  return "—";
}

function classColor(className: string) {
  return CLASS_COLOR[className.trim().toLowerCase()] || "#f6efe2";
}

function roleStyleClass(role: GuildRosterMember["role"]) {
  if (role === "tank") return styles.roleTank;
  if (role === "healer") return styles.roleHealer;
  if (role === "dps") return styles.roleDps;
  return "";
}

function openProfileCard(event: MouseEvent<HTMLElement>, href?: string | null) {
  if (!href) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("a,button,input,select,textarea,label")) return;
  window.location.href = href;
}

function openProfileCardWithKeyboard(
  event: KeyboardEvent<HTMLElement>,
  href?: string | null,
) {
  if (!href || (event.key !== "Enter" && event.key !== " ")) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("a,button,input,select,textarea,label")) return;
  event.preventDefault();
  window.location.href = href;
}

function normalizedRaidProgress(member: GuildRosterMember) {
  return Array.isArray(member.raidProgression) ? member.raidProgression : [];
}

function raidWeight(raid: GuildRaidProgress | null) {
  if (!raid) return 0;
  return (
    raid.mythicKills * 1_000_000 +
    raid.heroicKills * 10_000 +
    raid.normalKills * 100 +
    raid.totalBosses
  );
}

function bestRaid(member: GuildRosterMember, raidSlug = "all") {
  const raids = normalizedRaidProgress(member);
  if (raidSlug !== "all") {
    return raids.find((raid) => raid.slug === raidSlug) || null;
  }
  // Raider.IO повертає агрегат поточного tier як `tier-*`; він важливіший
  // за вже закриті старі рейди, інакше дефолтний список показував би історію.
  return raids.find((raid) => /^tier-/i.test(raid.slug)) || raids[0] || null;
}

function raidIsClear(raid: GuildRaidProgress | null, difficulty: "normal" | "heroic" | "mythic") {
  if (!raid || raid.totalBosses <= 0) return false;
  if (difficulty === "mythic") return raid.mythicKills >= raid.totalBosses;
  if (difficulty === "heroic") return raid.heroicKills >= raid.totalBosses;
  return raid.normalKills >= raid.totalBosses;
}

function raidHasProgress(raid: GuildRaidProgress | null) {
  return Boolean(raid && (raid.normalKills > 0 || raid.heroicKills > 0 || raid.mythicKills > 0));
}

function raidSummary(raid: GuildRaidProgress | null) {
  if (!raid) return { main: "—", detail: "Немає даних" };
  const total = raid.totalBosses || 0;
  if (!total) return { main: raid.summary || "—", detail: raid.name };

  const highest = raid.mythicKills > 0
    ? `M ${raid.mythicKills}/${total}`
    : raid.heroicKills > 0
      ? `H ${raid.heroicKills}/${total}`
      : `N ${raid.normalKills}/${total}`;
  const detail = [
    raid.mythicKills > 0 ? `M ${raid.mythicKills}/${total}` : null,
    raid.heroicKills > 0 ? `H ${raid.heroicKills}/${total}` : null,
    raid.normalKills > 0 ? `N ${raid.normalKills}/${total}` : null,
  ].filter(Boolean).join(" · ") || raid.summary || "Без убивств";

  return { main: highest, detail };
}

function compactRaidName(name: string) {
  return name.length > 30 ? `${name.slice(0, 29)}…` : name;
}

function friendlySource(value: string) {
  const source = String(value || "").toLowerCase();
  if (source.includes("raider")) return "Raider.IO → PostgreSQL";
  if (source.includes("battle")) return "Battle.net → PostgreSQL";
  if (source.includes("firebase") || source.includes("database") || source.includes("records")) return "PostgreSQL";
  if (source.includes("live-sync")) return "Battle.net + Raider.IO";
  return value || "PostgreSQL";
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterField} htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompactRange({
  id,
  label,
  minValue,
  maxValue,
  absoluteMax,
  onMinChange,
  onMaxChange,
}: {
  id: string;
  label: string;
  minValue: number;
  maxValue: number;
  absoluteMax: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
}) {
  const safeMax = Math.max(0, absoluteMax);
  return (
    <fieldset className={styles.rangeField}>
      <legend>{label}</legend>
      <label>
        <span>від</span>
        <input
          id={`${id}-min`}
          type="number"
          inputMode="numeric"
          min={0}
          max={safeMax}
          value={minValue}
          onChange={(event) => onMinChange(Math.max(0, Math.min(safeMax, Number(event.target.value) || 0)))}
        />
      </label>
      <span className={styles.rangeDash}>—</span>
      <label>
        <span>до</span>
        <input
          id={`${id}-max`}
          type="number"
          inputMode="numeric"
          min={0}
          max={safeMax}
          value={maxValue}
          onChange={(event) => onMaxChange(Math.max(0, Math.min(safeMax, Number(event.target.value) || 0)))}
        />
      </label>
    </fieldset>
  );
}

export default function GuildRosterExplorer({ members, stats, source, error }: Props) {
  const initialRoster = useMemo<GuildRosterLivePayload>(
    () => ({ members, stats, source, error: error || null }),
    [members, stats, source, error],
  );
  const rosterResource = useDashboardApiResource<GuildRosterLivePayload>({
    key: "guild-roster",
    scope: "guild",
    initialData: initialRoster,
    minIntervalMs: 60_000,
    request: () => ({
      url: "/api/guild/refresh",
      method: "POST",
      headers: { "X-Dashboard-Action": "guild-roster-cache-sync" },
      json: { cacheOnly: true, includeMembers: true, includeStats: true, bypassCache: true },
      select: (payload) => {
        const data = payload as Partial<GuildRosterLivePayload> | null;
        return {
          members: Array.isArray(data?.members) ? data.members : members,
          stats: data?.stats || stats,
          source: typeof data?.source === "string" ? data.source : source,
          error: typeof data?.error === "string" ? data.error : null,
          ok: data?.ok,
          memberCount: data?.memberCount,
          updatedAt: data?.updatedAt,
          refresh: data?.refresh,
        };
      },
    }),
    refreshOnMount: true,
  });

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!document.hidden) void rosterResource.refresh("guild-roster-poll");
        schedule();
      }, 60_000);
    };
    const onVisibility = () => {
      if (!document.hidden) void rosterResource.refresh("guild-roster-visible", { force: true });
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rosterResource.refresh]);

  const liveMembers = rosterResource.data.members;
  const liveStats = rosterResource.data.stats || stats;
  const liveSource = rosterResource.data.source || source;
  const liveError = rosterResource.data.error || error || rosterResource.error || null;
  const liveSync = rosterResource.data.refresh?.sync;
  const syncProcessed = liveSync?.phase === "raiderio"
    ? Number(liveSync.processed?.raiderIo || 0)
    : liveSync?.phase === "battlenet"
      ? Number(liveSync.processed?.battleNet || 0)
      : Number(liveSync?.processed?.roster || 0);
  const syncTotal = Math.max(0, Number(liveSync?.totalMembers || 0));
  const liveSyncLabel = liveSync?.status === "running"
    ? `Фонова синхронізація · ${liveSync.phase === "raiderio" ? "Raider.IO" : liveSync.phase === "battlenet" ? "Battle.net профілі" : "склад Battle.net"}${syncTotal ? ` · ${Math.min(syncProcessed, syncTotal)}/${syncTotal}` : ""}`
    : null;

  const maxRio = Math.max(0, Math.ceil(liveStats.maxRioAll || 0));
  const maxItemLevel = Math.max(0, Math.ceil(liveStats.maxItemLevel || 0));

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [segment, setSegment] = useState<GuildScoreSegment>("all");
  const [classFilter, setClassFilter] = useState("all");
  const [specFilter, setSpecFilter] = useState("all");
  const [factionFilter, setFactionFilter] = useState("all");
  const [raidFilter, setRaidFilter] = useState("all");
  const [raidClearFilter, setRaidClearFilter] = useState<RaidClearFilter>("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [rioMin, setRioMin] = useState(0);
  const [rioMax, setRioMax] = useState(maxRio);
  const [itemLevelMin, setItemLevelMin] = useState(0);
  const [itemLevelMax, setItemLevelMax] = useState(maxItemLevel);
  const [sort, setSort] = useState<SortKey>("rio-desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => {
    setRioMax((value) => (value <= 0 || value < maxRio ? maxRio : Math.min(value, maxRio)));
  }, [maxRio]);

  useEffect(() => {
    setItemLevelMax((value) =>
      value <= 0 || value < maxItemLevel ? maxItemLevel : Math.min(value, maxItemLevel),
    );
  }, [maxItemLevel]);

  const options = useMemo(() => {
    const raidMap = new Map<string, string>();
    for (const member of liveMembers) {
      for (const raid of normalizedRaidProgress(member)) {
        if (raid.slug) raidMap.set(raid.slug, raid.name || raid.slug);
      }
    }
    return {
      classes: uniqueSorted(liveMembers.map((member) => member.className)),
      specs: uniqueSorted(
        liveMembers
          .filter((member) => classFilter === "all" || member.className === classFilter)
          .map((member) => member.specName),
      ),
      factions: uniqueSorted(liveMembers.map((member) => member.faction)),
      raids: Array.from(raidMap.entries()).sort((a, b) => stableTextCompare(a[1], b[1])),
    };
  }, [liveMembers, classFilter]);

  useEffect(() => {
    if (specFilter !== "all" && !options.specs.includes(specFilter)) setSpecFilter("all");
  }, [options.specs, specFilter]);

  const raidStats = useMemo(() => {
    let profiles = 0;
    let heroicClears = 0;
    let mythicClears = 0;
    for (const member of liveMembers) {
      const raids = normalizedRaidProgress(member);
      if (raids.length) profiles += 1;
      const raid = bestRaid(member);
      if (raidIsClear(raid, "heroic")) heroicClears += 1;
      if (raidIsClear(raid, "mythic")) mythicClears += 1;
    }
    return { profiles, heroicClears, mythicClears };
  }, [liveMembers]);

  const filteredMembers = useMemo(() => {
    const search = query.trim().toLowerCase();
    const lowRio = Math.min(rioMin, rioMax);
    const highRio = Math.max(rioMin, rioMax);
    const lowIlvl = Math.min(itemLevelMin, itemLevelMax);
    const highIlvl = Math.max(itemLevelMin, itemLevelMax);

    return liveMembers
      .filter((member) => {
        const score = member.scores[segment] || 0;
        if (score < lowRio || score > highRio) return false;
        if (member.itemLevel < lowIlvl || member.itemLevel > highIlvl) return false;
        if (roleFilter !== "all" && member.role !== roleFilter) return false;
        if (classFilter !== "all" && member.className !== classFilter) return false;
        if (specFilter !== "all" && member.specName !== specFilter) return false;
        if (factionFilter !== "all" && member.faction !== factionFilter) return false;
        if (linkFilter === "profile" && !member.ownerProfileId) return false;
        if (linkFilter === "raiderio" && !member.profileUrl) return false;

        const raid = bestRaid(member, raidFilter);
        if (raidFilter !== "all" && !raid) return false;
        if (raidClearFilter === "progress" && !raidHasProgress(raid)) return false;
        if (raidClearFilter === "normal-clear" && !raidIsClear(raid, "normal")) return false;
        if (raidClearFilter === "heroic-clear" && !raidIsClear(raid, "heroic")) return false;
        if (raidClearFilter === "mythic-clear" && !raidIsClear(raid, "mythic")) return false;
        if (raidClearFilter === "no-raid" && normalizedRaidProgress(member).length > 0) return false;

        if (!search) return true;
        const raidText = normalizedRaidProgress(member)
          .map((item) => `${item.name} ${item.summary || ""}`)
          .join(" ");
        return [
          member.name,
          member.realmName,
          member.realmSlug,
          member.className,
          member.specName,
          member.raceName,
          member.faction,
          member.ownerDisplayName || "",
          raidText,
        ].join(" ").toLowerCase().includes(search);
      })
      .sort((a, b) => {
        if (sort === "rio-asc") return (a.scores[segment] || 0) - (b.scores[segment] || 0) || stableTextCompare(a.name, b.name);
        if (sort === "ilvl-desc") return b.itemLevel - a.itemLevel || (b.scores[segment] || 0) - (a.scores[segment] || 0);
        if (sort === "raid-desc") return raidWeight(bestRaid(b, raidFilter)) - raidWeight(bestRaid(a, raidFilter)) || (b.scores[segment] || 0) - (a.scores[segment] || 0);
        if (sort === "name-asc") return stableTextCompare(a.name, b.name);
        if (sort === "rank-asc") return (a.rank ?? 999) - (b.rank ?? 999) || stableTextCompare(a.name, b.name);
        return (b.scores[segment] || 0) - (a.scores[segment] || 0) || b.itemLevel - a.itemLevel || stableTextCompare(a.name, b.name);
      });
  }, [
    liveMembers,
    query,
    roleFilter,
    segment,
    classFilter,
    specFilter,
    factionFilter,
    raidFilter,
    raidClearFilter,
    linkFilter,
    rioMin,
    rioMax,
    itemLevelMin,
    itemLevelMax,
    sort,
  ]);

  const activeFilterCount = useMemo(() => [
    query.trim() ? 1 : 0,
    roleFilter !== "all" ? 1 : 0,
    segment !== "all" ? 1 : 0,
    classFilter !== "all" ? 1 : 0,
    specFilter !== "all" ? 1 : 0,
    factionFilter !== "all" ? 1 : 0,
    raidFilter !== "all" ? 1 : 0,
    raidClearFilter !== "all" ? 1 : 0,
    linkFilter !== "all" ? 1 : 0,
    rioMin > 0 || rioMax < maxRio ? 1 : 0,
    itemLevelMin > 0 || itemLevelMax < maxItemLevel ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0), [
    query, roleFilter, segment, classFilter, specFilter, factionFilter,
    raidFilter, raidClearFilter, linkFilter, rioMin, rioMax, itemLevelMin,
    itemLevelMax, maxRio, maxItemLevel,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedMembers = filteredMembers.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, roleFilter, segment, classFilter, specFilter, factionFilter, raidFilter, raidClearFilter, linkFilter, rioMin, rioMax, itemLevelMin, itemLevelMax, sort, pageSize]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function resetFilters() {
    setQuery("");
    setRoleFilter("all");
    setSegment("all");
    setClassFilter("all");
    setSpecFilter("all");
    setFactionFilter("all");
    setRaidFilter("all");
    setRaidClearFilter("all");
    setLinkFilter("all");
    setRioMin(0);
    setRioMax(maxRio);
    setItemLevelMin(0);
    setItemLevelMax(maxItemLevel);
    setSort("rio-desc");
  }

  if (!liveMembers.length) {
    return (
      <section className={`${styles.emptyState} panel`} aria-live="polite">
        <span className="eyebrow">Склад гільдії</span>
        <h2>Дані складу ще готуються</h2>
        <p>
          Сервер синхронізує Battle.net і Raider.IO у фоні. Сторінка більше не запускає
          масові зовнішні запити з браузера.
        </p>
        {liveError ? <small>{liveError}</small> : null}
        <button className="btn subtle" type="button" onClick={() => void rosterResource.refresh("guild-empty-retry", { force: true })}>
          Перевірити базу
        </button>
      </section>
    );
  }

  return (
    <section className={`${styles.rosterPanel} panel`} aria-label="Склад гільдії">
      <div className={styles.toolbar}>
        <div className={styles.toolbarTitle}>
          <div>
            <span className="eyebrow">Склад</span>
            <h2>Персонажі гільдії</h2>
          </div>
          <span className={styles.resultCount}>{filteredMembers.length} з {liveMembers.length}</span>
        </div>

        <div className={styles.searchRow}>
          <label className={styles.searchBox} htmlFor="guild-roster-search">
            <span aria-hidden="true">⌕</span>
            <input
              id="guild-roster-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ім’я, клас, спек, рейд…"
              autoComplete="off"
            />
            {query ? (
              <button className="btn" type="button" onClick={() => setQuery("")} aria-label="Очистити пошук">×</button>
            ) : null}
          </label>

          <div className={styles.quickRoles} aria-label="Швидкий фільтр ролі">
            {ROLE_FILTERS.map((item) => (
              <button
                type="button"
                key={item.value}
                className="btn"
                aria-pressed={roleFilter === item.value}
                onClick={() => setRoleFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`btn ${styles.filtersButton}`}
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
          >
            Фільтри{activeFilterCount ? ` · ${activeFilterCount}` : ""}
          </button>
        </div>
      </div>

      <div className={styles.metrics} aria-label="Показники складу">
        <div><span>Персонажів</span><strong>{liveStats.memberCount || liveMembers.length}</strong></div>
        <div><span>Показано</span><strong>{filteredMembers.length}</strong></div>
        <div><span>Сер. ilvl</span><strong>{formatNumber(liveStats.averageItemLevel)}</strong></div>
        <div><span>Топ M+</span><strong>{formatNumber(liveStats.maxRioAll, 1)}</strong></div>
        <div><span>Рейд-профілі</span><strong>{raidStats.profiles}</strong></div>
        <div><span>Heroic clear</span><strong>{raidStats.heroicClears}</strong></div>
        <div><span>Mythic clear</span><strong>{raidStats.mythicClears}</strong></div>
      </div>

      {filtersOpen ? (
        <div className={styles.filtersPanel} aria-label="Розширені фільтри">
          <FilterSelect
            id="guild-rio-segment"
            label="RIO показник"
            value={segment}
            options={Object.entries(SEGMENT_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(value) => setSegment(value as GuildScoreSegment)}
          />
          <FilterSelect
            id="guild-class"
            label="Клас"
            value={classFilter}
            options={[{ value: "all", label: "Усі класи" }, ...options.classes.map((value) => ({ value, label: value }))]}
            onChange={setClassFilter}
          />
          <FilterSelect
            id="guild-spec"
            label="Спек"
            value={specFilter}
            options={[{ value: "all", label: "Усі спеки" }, ...options.specs.map((value) => ({ value, label: value }))]}
            onChange={setSpecFilter}
          />
          <FilterSelect
            id="guild-faction"
            label="Фракція"
            value={factionFilter}
            options={[{ value: "all", label: "Усі фракції" }, ...options.factions.map((value) => ({ value, label: value }))]}
            onChange={setFactionFilter}
          />
          <FilterSelect
            id="guild-raid"
            label="Рейд"
            value={raidFilter}
            options={[{ value: "all", label: "Усі актуальні рейди" }, ...options.raids.map(([value, label]) => ({ value, label }))]}
            onChange={setRaidFilter}
          />
          <FilterSelect
            id="guild-raid-clear"
            label="Закриття рейду"
            value={raidClearFilter}
            options={[
              { value: "all", label: "Будь-який прогрес" },
              { value: "progress", label: "Є прогрес" },
              { value: "normal-clear", label: "Normal закрито" },
              { value: "heroic-clear", label: "Heroic закрито" },
              { value: "mythic-clear", label: "Mythic закрито" },
              { value: "no-raid", label: "Без даних рейду" },
            ]}
            onChange={(value) => setRaidClearFilter(value as RaidClearFilter)}
          />
          <FilterSelect
            id="guild-links"
            label="Зв’язок"
            value={linkFilter}
            options={[
              { value: "all", label: "Усі персонажі" },
              { value: "profile", label: "Є профіль сайту" },
              { value: "raiderio", label: "Є Raider.IO" },
            ]}
            onChange={(value) => setLinkFilter(value as LinkFilter)}
          />
          <FilterSelect
            id="guild-sort"
            label="Сортування"
            value={sort}
            options={[
              { value: "rio-desc", label: "RIO: від більшого" },
              { value: "rio-asc", label: "RIO: від меншого" },
              { value: "ilvl-desc", label: "Item level: від більшого" },
              { value: "raid-desc", label: "Рейд-прогрес: від більшого" },
              { value: "name-asc", label: "Ім’я: А–Я" },
              { value: "rank-asc", label: "Гільдійний ранг" },
            ]}
            onChange={(value) => setSort(value as SortKey)}
          />
          <CompactRange id="guild-rio" label="RIO" minValue={rioMin} maxValue={rioMax} absoluteMax={maxRio} onMinChange={setRioMin} onMaxChange={setRioMax} />
          <CompactRange id="guild-ilvl" label="Item level" minValue={itemLevelMin} maxValue={itemLevelMax} absoluteMax={maxItemLevel} onMinChange={setItemLevelMin} onMaxChange={setItemLevelMax} />
          <div className={styles.filterActions}>
            <button type="button" className="btn subtle" onClick={resetFilters}>Скинути все</button>
            <small>База: {formatRosterDate(liveStats.updatedAt)}</small>
          </div>
        </div>
      ) : null}

      <div className={styles.syncLine}>
        <span className={rosterResource.status === "error" ? styles.syncError : styles.syncOk} aria-hidden="true" />
        <span>
          {rosterResource.status === "checking"
            ? "Перевіряю нові дані в локальній базі…"
            : liveSyncLabel || `Автооновлення з VPS · останні дані ${formatRosterDate(liveStats.updatedAt)}`}
        </span>
        <span className={styles.syncSource}>{friendlySource(liveSource)}</span>
      </div>

      <div className={styles.tableScroll}>
        <div className={styles.table} role="table" aria-label="Персонажі гільдії">
          <div className={styles.tableHead} role="row">
            <span role="columnheader">Персонаж</span>
            <span role="columnheader">Клас / спек</span>
            <span role="columnheader">Роль</span>
            <span role="columnheader">ILVL</span>
            <span role="columnheader">RIO</span>
            <span role="columnheader">Рейд</span>
            <span role="columnheader">Ранг</span>
            <span role="columnheader">Посилання</span>
          </div>

          {pagedMembers.length ? pagedMembers.map((member) => {
            const score = member.scores[segment] || 0;
            const ownerProfileHref = member.ownerProfileId
              ? `/profile/${encodeURIComponent(member.ownerProfileId)}`
              : null;
            const raid = bestRaid(member, raidFilter);
            const raidView = raidSummary(raid);
            return (
              <article
                className={styles.tableRow}
                key={member.key}
                role="row"
                tabIndex={ownerProfileHref ? 0 : undefined}
                onClick={(event) => openProfileCard(event, ownerProfileHref)}
                onKeyDown={(event) => openProfileCardWithKeyboard(event, ownerProfileHref)}
              >
                <div className={styles.characterCell} role="cell" data-label="Персонаж">
                  <span className={styles.avatarWrap}>
                    {member.avatarUrl ? <img src={member.avatarUrl} alt="" loading="lazy" /> : <span>{member.name.charAt(0).toUpperCase()}</span>}
                  </span>
                  <span className={styles.characterCopy}>
                    <strong style={{ color: classColor(member.className) }}>{member.name}</strong>
                    <small>{member.realmName || member.realmSlug}</small>
                  </span>
                </div>

                <div className={styles.classCell} role="cell" data-label="Клас / спек">
                  <span className={styles.classMark} style={{ "--guild-class-color": classColor(member.className) } as CSSProperties}>
                    {(member.className || "?").trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <span><strong>{member.className || "—"}</strong><small>{member.specName || "—"}</small></span>
                </div>

                <div role="cell" data-label="Роль"><span className={`${styles.rolePill} ${roleStyleClass(member.role)}`}>{roleShort(member.role)}</span></div>
                <div className={styles.numericCell} role="cell" data-label="ILVL"><strong>{member.itemLevel || "—"}</strong></div>
                <div className={styles.scoreCell} role="cell" data-label="RIO">
                  <strong style={member.scoreColors?.[segment] ? { color: member.scoreColors[segment] } : undefined}>{formatNumber(score, 1)}</strong>
                  <small>{SEGMENT_LABELS[segment]}</small>
                </div>
                <div className={styles.raidCell} role="cell" data-label="Рейд" title={raid ? `${raid.name}: ${raidView.detail}` : undefined}>
                  <strong>{raidView.main}</strong>
                  <small>{raid ? compactRaidName(raid.name) : raidView.detail}</small>
                </div>
                <div className={styles.numericCell} role="cell" data-label="Ранг"><strong>{member.rank === null || member.rank === undefined ? "—" : `#${member.rank}`}</strong></div>
                <div className={styles.linksCell} role="cell" data-label="Посилання">
                  {ownerProfileHref ? <a href={ownerProfileHref} onClick={(event) => event.stopPropagation()}>Профіль</a> : null}
                  {member.profileUrl ? <a href={member.profileUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>RIO ↗</a> : null}
                  {!ownerProfileHref && !member.profileUrl ? <span>—</span> : null}
                </div>
              </article>
            );
          }) : (
            <div className={styles.emptyRows} role="row">
              <strong>Нікого не знайдено</strong>
              <span>Зміни пошук або фільтри.</span>
              <button type="button" className="btn subtle" onClick={resetFilters}>Скинути фільтри</button>
            </div>
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <div className={styles.pageSize}>
          <span>На сторінці</span>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <small>Сторінка {safePage} / {pageCount} · {filteredMembers.length} результатів</small>
        <div className={styles.pagination}>
          <button type="button" className="btn subtle" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Назад</button>
          <button type="button" className="btn subtle" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Далі</button>
        </div>
      </footer>
    </section>
  );
}
