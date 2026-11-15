"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GuildRosterMember, GuildRosterStats, GuildScoreSegment } from "@/lib/guildRoster";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { currentSeasonRaidProgress, currentSeasonRaidSlugs } from "@/lib/characterRaidProgress";
import { formatStableNumber, stableTextCompare } from "@/lib/stableUiText";
import { useSearchParams } from "next/navigation";
import ListViewMemory from "@/components/ListViewMemory";
import { listViewUrl } from "@/lib/listViewState";
import { replaceClientListLocation } from "@/lib/clientListLocation";
import { readGuildRosterView, compareGuildRosterMembers, type GuildRosterSort, type GuildRaidClearFilter, type GuildLinkFilter } from "@/lib/guildRosterViewState";
import styles from "./guild/guild-workspace.module.css";
import { normalizedRaidProgress, bestRaid, raidWeight, raidIsClear, raidHasProgress, friendlySource } from "@/lib/guildRosterPresentation";
import GuildRosterTable from "@/components/guild/GuildRosterTable";
import FilterToolbar from "@/components/page/FilterToolbar";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/page/FormSection";
import PageSection from "@/components/page/PageSection";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import StatusBadge from "@/components/page/StatusBadge";
import Button from "@/components/ui/Button";

type Props = {
  members: GuildRosterMember[];
  stats: GuildRosterStats;
  source: string;
  error?: string | null;
  navigationScope: string;
};

type GuildRosterLivePayload = Omit<Props, "navigationScope"> & {
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
  { value: "all", label: "Усі" },
  { value: "tank", label: "Танк" },
  { value: "healer", label: "Хіл" },
  { value: "dps", label: "ДД" },
] as const;

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
        {(options.some((option) => option.value === value) ? options : [...options, { value, label: `${value} (немає в поточному складі)` }]).map((option) => (
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

export default function GuildRosterExplorer({ members, stats, source, error, navigationScope }: Props) {
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
    refreshOnMount: false,
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

  const searchParams = useSearchParams();
  const currentUrl = listViewUrl("guild", `/guild?${searchParams}`) || "/guild";
  const view = readGuildRosterView(new URL(currentUrl, "https://list.invalid").searchParams);
  const maxRio = Math.max(0, Math.ceil(liveStats.maxRioAll || 0), view.rio.min, view.rio.max ?? 0);
  const maxItemLevel = Math.max(0, Math.ceil(liveStats.maxItemLevel || 0), view.ilvl.min, view.ilvl.max ?? 0);
  const [query, setQuery] = useState(view.q);
  const ownQuery = useRef<string | null>(null);
  useEffect(() => {
    if (ownQuery.current !== view.q) setQuery(view.q);
    ownQuery.current = null;
  }, [view.q]);
  const roleFilter = view.role, segment = view.segment, classFilter = view.className, specFilter = view.spec;
  const factionFilter = view.faction, raidFilter = view.raid, raidClearFilter = view.clear, linkFilter = view.link;
  const rioMin = view.rio.min, rioMax = view.rio.max ?? maxRio;
  const itemLevelMin = view.ilvl.min, itemLevelMax = view.ilvl.max ?? maxItemLevel;
  const sort = view.sort, filtersOpen = view.filtersOpen, page = view.page, pageSize = Number(view.size);
  const rioUpperBound = view.rio.max ?? Infinity, itemLevelUpperBound = view.ilvl.max ?? Infinity;

  function changeFilters(patch: Record<string, string | null>) {
    return replaceClientListLocation("guild", { ...patch, page: null });
  }
  function changeQuery(value: string) {
    setQuery(value);
    const href = changeFilters({ q: value });
    ownQuery.current = new URL(href, "https://list.invalid").searchParams.get("q") || "";
  }
  const setRoleFilter = (value: string) => changeFilters({ role: value });
  const setSegment = (value: string) => changeFilters({ segment: value });
  const setClassFilter = (value: string) => changeFilters({ class: value, spec: null });
  const setSpecFilter = (value: string) => changeFilters({ spec: value });
  const setFactionFilter = (value: string) => changeFilters({ faction: value });
  const setRaidFilter = (value: string) => changeFilters({ raid: value });
  const setRaidClearFilter = (value: string) => changeFilters({ clear: value });
  const setLinkFilter = (value: string) => changeFilters({ link: value });
  const setRioMin = (value: number) => changeFilters({ rioMin: String(value) });
  const setRioMax = (value: number) => changeFilters({ rioMax: String(value) });
  const setItemLevelMin = (value: number) => changeFilters({ ilvlMin: String(value) });
  const setItemLevelMax = (value: number) => changeFilters({ ilvlMax: String(value) });
  const setSort = (value: string) => changeFilters({ sort: value });
  const setPageSize = (value: number) => changeFilters({ size: String(value) });
  const setPage = (value: number) => replaceClientListLocation("guild", { page: String(value) });

  const options = useMemo(() => {
    const raidMap = new Map<string, string>();
    for (const slug of currentSeasonRaidSlugs(liveStats.raidSeasonSnapshot)) {
      const catalog = liveStats.raidSeasonSnapshot?.catalog?.[slug];
      raidMap.set(slug, catalog?.name || catalog?.shortName || slug);
    }
    for (const member of liveMembers) {
      for (const raid of currentSeasonRaidProgress(normalizedRaidProgress(member), liveStats.raidSeasonSnapshot)) {
        if (raid.slug && !/^tier-/i.test(raid.slug)) raidMap.set(raid.slug, raid.name || raid.slug);
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
  }, [liveMembers, liveStats.raidSeasonSnapshot, classFilter]);

  const raidStats = useMemo(() => {
    let profiles = 0;
    let heroicClears = 0;
    let mythicClears = 0;
    for (const member of liveMembers) {
      const raids = currentSeasonRaidProgress(normalizedRaidProgress(member), liveStats.raidSeasonSnapshot);
      if (raids.length) profiles += 1;
      const raid = bestRaid(member, liveStats.raidSeasonSnapshot);
      if (raidIsClear(raid, "heroic")) heroicClears += 1;
      if (raidIsClear(raid, "mythic")) mythicClears += 1;
    }
    return { profiles, heroicClears, mythicClears };
  }, [liveMembers, liveStats.raidSeasonSnapshot]);

  const filteredMembers = useMemo(() => {
    const search = query.trim().toLowerCase();
    const lowRio = rioMin, highRio = rioUpperBound;
    const lowIlvl = itemLevelMin, highIlvl = itemLevelUpperBound;

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

        const raid = bestRaid(member, liveStats.raidSeasonSnapshot, raidFilter);
        if (raidFilter !== "all" && !raid) return false;
        if (raidClearFilter === "progress" && !raidHasProgress(raid)) return false;
        if (raidClearFilter === "normal-clear" && !raidIsClear(raid, "normal")) return false;
        if (raidClearFilter === "heroic-clear" && !raidIsClear(raid, "heroic")) return false;
        if (raidClearFilter === "mythic-clear" && !raidIsClear(raid, "mythic")) return false;
        if (raidClearFilter === "no-raid" && currentSeasonRaidProgress(normalizedRaidProgress(member), liveStats.raidSeasonSnapshot).length > 0) return false;

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
      .sort((a, b) => compareGuildRosterMembers(a, b, sort, segment,
        (member) => raidWeight(bestRaid(member, liveStats.raidSeasonSnapshot, raidFilter))));
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
    rioUpperBound,
    itemLevelMin,
    itemLevelUpperBound,
    sort,
    liveStats.raidSeasonSnapshot,
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
    rioMin > 0 || Number.isFinite(rioUpperBound) ? 1 : 0,
    itemLevelMin > 0 || Number.isFinite(itemLevelUpperBound) ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0), [
    query, roleFilter, segment, classFilter, specFilter, factionFilter,
    raidFilter, raidClearFilter, linkFilter, rioMin, rioUpperBound, itemLevelMin,
    itemLevelUpperBound,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedMembers = filteredMembers.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    if (liveMembers.length && page > pageCount) replaceClientListLocation("guild", { page: String(pageCount) });
  }, [page, pageCount, liveMembers.length]);

  function resetFilters() {
    changeFilters(Object.fromEntries(["q", "role", "segment", "class", "spec", "faction", "raid", "clear", "link", "rioMin", "rioMax", "ilvlMin", "ilvlMax", "sort"].map((key) => [key, null])));
    setQuery("");
    ownQuery.current = "";
  }
  const listMemory = <div className={styles.viewMemory}><ListViewMemory key={navigationScope} kind="guild" scope={navigationScope} currentUrl={currentUrl} clientLocation /></div>;

  if (!liveMembers.length) {
    const actions = <Button onClick={() => void rosterResource.refresh("guild-empty-retry", {force: true})}>Повторити</Button>;
    return <>{listMemory}{liveError || rosterResource.status === "error"
      ? <ErrorState title="Склад тимчасово недоступний" description="Не вдалося отримати склад гільдії. Спробуй оновити дані." actions={actions} />
      : <EmptyState title="Склад ще готується" description="Персонажі зʼявляться після завершення синхронізації." actions={actions} />}</>;
  }
  return <PageSection id="guild-roster-title" title="Персонажі гільдії" description="Пошук, ролі, спорядження та прогрес поточного сезону.">
    {listMemory}
    <FilterToolbar label="Пошук і фільтри складу" search={<FormField id="guild-roster-search" label="Пошук персонажа" type="search" maxLength={160} value={query} onChange={event => changeQuery(event.target.value)} placeholder="Імʼя, клас, спек або рейд" autoComplete="off" />}
      filters={<div className={styles.actions} aria-label="Швидкий фільтр ролі">{ROLE_FILTERS.map(item => <Button key={item.value} aria-pressed={roleFilter === item.value} onClick={() => setRoleFilter(item.value)}>{item.label}</Button>)}</div>}
      actions={<><Button onClick={() => replaceClientListLocation("guild", {filters: filtersOpen ? null : "1"})} aria-expanded={filtersOpen}>Фільтри{activeFilterCount ? ` · ${activeFilterCount}` : ""}</Button><Button onClick={resetFilters} disabled={!activeFilterCount}>Скинути</Button></>}
      result={`Знайдено ${filteredMembers.length} із ${liveMembers.length}`} />
    <dl className={styles.metrics} aria-label="Показники складу">
      <div><dt>Персонажів</dt><dd>{liveStats.memberCount || liveMembers.length}</dd></div>
      <div><dt>Показано</dt><dd>{filteredMembers.length}</dd></div>
      <div><dt>Сер. ilvl</dt><dd>{formatNumber(liveStats.averageItemLevel)}</dd></div>
      <div><dt>Топ M+</dt><dd>{formatNumber(liveStats.maxRioAll, 1)}</dd></div>
      <div><dt>Рейд-профілі</dt><dd>{raidStats.profiles}</dd></div>
      <div><dt>Heroic clear</dt><dd>{raidStats.heroicClears}</dd></div>
      <div><dt>Mythic clear</dt><dd>{raidStats.mythicClears}</dd></div>
    </dl>
      {filtersOpen ? (
        <FormSection title="Розширені фільтри"><div className={styles.filtersPanel}>
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
            label="Рейд поточного сезону"
            value={raidFilter}
            options={[{ value: "all", label: "Основний рейд поточного сезону" }, ...options.raids.map(([value, label]) => ({ value, label }))]}
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
            onChange={(value) => setRaidClearFilter(value as GuildRaidClearFilter)}
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
            onChange={(value) => setLinkFilter(value as GuildLinkFilter)}
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
            onChange={(value) => setSort(value as GuildRosterSort)}
          />
          <CompactRange id="guild-rio" label="RIO" minValue={rioMin} maxValue={rioMax} absoluteMax={maxRio} onMinChange={setRioMin} onMaxChange={setRioMax} />
          <CompactRange id="guild-ilvl" label="Item level" minValue={itemLevelMin} maxValue={itemLevelMax} absoluteMax={maxItemLevel} onMinChange={setItemLevelMin} onMaxChange={setItemLevelMax} />
          <div className={styles.filterActions}>
            <button type="button" className="btn subtle" onClick={resetFilters}>Скинути все</button>
            <small>База: {formatRosterDate(liveStats.updatedAt)}</small>
          </div>
        </div></FormSection>
      ) : null}


    <div className={styles.actions} role="status" aria-live="polite"><StatusBadge tone={rosterResource.status === "error" ? "warning" : "neutral"}>{rosterResource.status === "checking" ? "Оновлюємо дані" : rosterResource.status === "error" ? "Показано останні доступні дані" : "Дані синхронізовано"}</StatusBadge><small className={styles.metadata}>{liveSyncLabel || `Оновлено ${formatRosterDate(liveStats.updatedAt)}`} · {friendlySource(liveSource)}</small></div>
    {pagedMembers.length ? <GuildRosterTable members={pagedMembers} segment={segment} raidFilter={raidFilter} snapshot={liveStats.raidSeasonSnapshot} /> : <EmptyState title="Нікого не знайдено" description="Зміни пошук або скинь фільтри." actions={<Button onClick={resetFilters}>Скинути фільтри</Button>} />}
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
          <button type="button" className="btn subtle" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))}>Назад</button>
          <button type="button" className="btn subtle" disabled={safePage >= pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))}>Далі</button>
        </div>
      </footer>
  </PageSection>;
}
