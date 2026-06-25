"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type {
  GuildRosterMember,
  GuildRosterStats,
  GuildScoreSegment,
} from "@/lib/guildRoster";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { formatStableNumber, stableTextCompare } from "@/lib/stableUiText";

type SortKey =
  | "rio-desc"
  | "rio-asc"
  | "ilvl-desc"
  | "name-asc"
  | "rank-asc";

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
};

const SEGMENT_LABELS: Record<GuildScoreSegment, string> = {
  all: "ALL",
  dps: "DPS",
  healer: "HEALER",
  tank: "TANK",
};

const ROLE_LABELS: Record<string, string> = {
  all: "Усі ролі",
  tank: "Танк",
  healer: "Хіл",
  dps: "DPS",
  unknown: "Без ролі",
};

const ARMOR_LABELS = ["Тканина", "Шкіра", "Кольчуга", "Лати"] as const;
type ArmorType = (typeof ARMOR_LABELS)[number];

const ARMOR_BY_CLASS: Record<string, ArmorType> = {
  mage: "Тканина",
  маг: "Тканина",
  priest: "Тканина",
  жрець: "Тканина",
  warlock: "Тканина",
  чорнокнижник: "Тканина",
  druid: "Шкіра",
  друїд: "Шкіра",
  monk: "Шкіра",
  монах: "Шкіра",
  rogue: "Шкіра",
  розбійник: "Шкіра",
  "demon hunter": "Шкіра",
  "мисливець на демонів": "Шкіра",
  hunter: "Кольчуга",
  мисливець: "Кольчуга",
  shaman: "Кольчуга",
  шаман: "Кольчуга",
  evoker: "Кольчуга",
  пробуджувач: "Кольчуга",
  warrior: "Лати",
  воїн: "Лати",
  paladin: "Лати",
  паладин: "Лати",
  "death knight": "Лати",
  "лицар смерті": "Лати",
};

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

const ROLE_ORDER = ["tank", "healer", "dps", "unknown"];

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return formatStableNumber(value, digits);
}

function formatRosterDate(value?: string | null) {
  if (!value) return "—";
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

function getArmorType(member: GuildRosterMember): ArmorType {
  return ARMOR_BY_CLASS[member.className.trim().toLowerCase()] || "Тканина";
}

function roleShort(role: string) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  if (role === "dps") return "DPS";
  return "—";
}

function classColor(className: string) {
  return CLASS_COLOR[className.trim().toLowerCase()] || "#f6efe2";
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function buildConicSegments(items: Array<{ value: number; color: string }>) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  if (!total) return "rgba(255,255,255,0.08) 0 360deg";

  let cursor = 0;
  return items
    .map((item) => {
      const size = (Math.max(0, item.value) / total) * 360;
      const start = cursor;
      cursor += size;
      return `${item.color} ${start}deg ${cursor}deg`;
    })
    .join(", ");
}

function FilterSelect({
  id,
  name,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="guild-filter-field" htmlFor={id}>
      <span>{label}</span>
      <select
        id={id}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function clampValue(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function parseNumberInput(
  event: ChangeEvent<HTMLInputElement>,
  fallback: number,
) {
  const raw = event.target.value.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

const RANGE_THUMB_HALF_PX = 10;

function rangePosition(percentValue: number) {
  const safePercent = Math.min(100, Math.max(0, percentValue));
  const insetCompensation = RANGE_THUMB_HALF_PX * (1 - safePercent / 50);
  const roundedPercent = Number(safePercent.toFixed(4));
  const roundedCompensation = Number(insetCompensation.toFixed(4));

  return `calc(${roundedPercent}% + ${roundedCompensation}px)`;
}

function RangeFilter({
  idBase,
  nameBase,
  label,
  minValue,
  maxValue,
  absoluteMin,
  absoluteMax,
  onMinChange,
  onMaxChange,
}: {
  idBase: string;
  nameBase: string;
  label: string;
  minValue: number;
  maxValue: number;
  absoluteMin: number;
  absoluteMax: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
}) {
  const safeAbsoluteMax = Math.max(absoluteMin, absoluteMax);
  const safeMin = clampValue(minValue, absoluteMin, safeAbsoluteMax);
  const safeMax = clampValue(maxValue, absoluteMin, safeAbsoluteMax);
  const low = Math.min(safeMin, safeMax);
  const high = Math.max(safeMin, safeMax);
  const span = Math.max(1, safeAbsoluteMax - absoluteMin);
  const startPercent = ((low - absoluteMin) / span) * 100;
  const endPercent = 100 - ((high - absoluteMin) / span) * 100;

  return (
    <div className="guild-range-group">
      <div className="guild-range-head">
        <span>{label}</span>
        <strong>
          {formatNumber(low)} — {formatNumber(high)}
        </strong>
      </div>

      <div className="guild-range-inputs">
        <label className="guild-range-value" htmlFor={`${idBase}-min`}>
          <span>від</span>
          <input
            id={`${idBase}-min`}
            name={`${nameBase}_min`}
            type="number"
            inputMode="numeric"
            min={absoluteMin}
            max={safeAbsoluteMax}
            value={safeMin}
            onChange={(event) =>
              onMinChange(
                clampValue(
                  parseNumberInput(event, safeMin),
                  absoluteMin,
                  safeAbsoluteMax,
                ),
              )
            }
          />
        </label>
        <label className="guild-range-value" htmlFor={`${idBase}-max`}>
          <span>до</span>
          <input
            id={`${idBase}-max`}
            name={`${nameBase}_max`}
            type="number"
            inputMode="numeric"
            min={absoluteMin}
            max={safeAbsoluteMax}
            value={safeMax}
            onChange={(event) =>
              onMaxChange(
                clampValue(
                  parseNumberInput(event, safeMax),
                  absoluteMin,
                  safeAbsoluteMax,
                ),
              )
            }
          />
        </label>
      </div>

      <div
        className="guild-dual-range"
        style={
          {
            "--range-start": rangePosition(startPercent),
            "--range-end": rangePosition(endPercent),
          } as CSSProperties
        }
      >
        <div className="guild-dual-range__line" aria-hidden="true" />
        <div className="guild-dual-range__active" aria-hidden="true" />
        <input
          id={`${idBase}-min-slider`}
          name={`${nameBase}_min_slider`}
          className="guild-dual-range__input"
          type="range"
          min={absoluteMin}
          max={safeAbsoluteMax}
          value={safeMin}
          onChange={(event) =>
            onMinChange(
              clampValue(
                Number(event.target.value),
                absoluteMin,
                safeAbsoluteMax,
              ),
            )
          }
        />
        <input
          id={`${idBase}-max-slider`}
          name={`${nameBase}_max_slider`}
          className="guild-dual-range__input"
          type="range"
          min={absoluteMin}
          max={safeAbsoluteMax}
          value={safeMax}
          onChange={(event) =>
            onMaxChange(
              clampValue(
                Number(event.target.value),
                absoluteMin,
                safeAbsoluteMax,
              ),
            )
          }
        />
      </div>
    </div>
  );
}

function StatDonut({
  title,
  subtitle,
  center,
  caption,
  segments,
  legend,
}: {
  title: string;
  subtitle: string;
  center: string;
  caption: string;
  segments: Array<{ value: number; color: string }>;
  legend: Array<{
    label: string;
    value: string;
    detail: string;
    color: string;
  }>;
}) {
  return (
    <article className="guild-stat-card panel dashboard-list-panel">
      <div className="guild-stat-card__head">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="guild-donut-layout">
        <div
          className="guild-donut"
          style={
            { "--guild-donut": buildConicSegments(segments) } as CSSProperties
          }
        >
          <div>
            <strong>{center}</strong>
            <span>{caption}</span>
          </div>
        </div>
        <div className="guild-stat-legend">
          {legend.map((item) => (
            <div className="guild-stat-legend__item" key={item.label}>
              <span
                className="guild-stat-dot"
                style={{ background: item.color }}
              />
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
              <b>{item.value}</b>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function CharacterAvatar({ member }: { member: GuildRosterMember }) {
  if (member.avatarUrl) {
    return (
      <img
        className="guild-member-avatar"
        src={member.avatarUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span className="guild-member-avatar guild-member-avatar--empty">
      {member.name.charAt(0).toUpperCase()}
    </span>
  );
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
  if (!href) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("a,button,input,select,textarea,label")) return;
  event.preventDefault();
  window.location.href = href;
}

function SegmentBadges({
  member,
  activeSegment,
}: {
  member: GuildRosterMember;
  activeSegment: GuildScoreSegment;
}) {
  return (
    <div className="guild-score-badges" aria-label="Raider.IO сегменти">
      {(["all", "dps", "healer", "tank"] as GuildScoreSegment[]).map(
        (segment) => {
          const value = member.scores[segment];
          if (!value && segment !== activeSegment) return null;
          return (
            <span
              className={segment === activeSegment ? "is-active" : undefined}
              key={segment}
            >
              <small>{SEGMENT_LABELS[segment]}</small>
              <strong>{formatNumber(value, 1)}</strong>
            </span>
          );
        },
      )}
    </div>
  );
}

export default function GuildRosterExplorer({
  members,
  stats,
  source,
  error,
}: Props) {
  const initialRoster = useMemo<GuildRosterLivePayload>(
    () => ({ members, stats, source, error: error || null }),
    [members, stats, source, error],
  );
  const rosterResource = useDashboardApiResource<GuildRosterLivePayload>({
    key: "guild-roster",
    scope: "guild",
    initialData: initialRoster,
    minIntervalMs: 10 * 60 * 1000,
    request: () => ({
      url: "/api/guild/refresh",
      method: "POST",
      headers: { "X-Dashboard-Action": "guild-roster-cache-sync" },
      json: { cacheOnly: true, includeMembers: true, bypassCache: true },
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
        };
      },
    }),
  });

  const liveMembers = rosterResource.data.members.length
    ? rosterResource.data.members
    : members;
  const liveStats = rosterResource.data.stats || stats;
  const liveSource = rosterResource.data.source || source;
  const liveError =
    rosterResource.data.error || error || rosterResource.error || null;

  const [segment, setSegment] = useState<GuildScoreSegment>("all");
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("Усі класи");
  const [specFilter, setSpecFilter] = useState("Усі спеки");
  const [roleFilter, setRoleFilter] = useState("Усі ролі");
  const [factionFilter, setFactionFilter] = useState("Усі фракції");
  const [rioMin, setRioMin] = useState(0);
  const [rioMax, setRioMax] = useState(Math.ceil(liveStats.maxRioAll || 0));
  const [itemLevelMin, setItemLevelMin] = useState(0);
  const [itemLevelMax, setItemLevelMax] = useState(
    Math.ceil(liveStats.maxItemLevel || 0),
  );
  const [sort, setSort] = useState<SortKey>("rio-desc");
  const [filtersOpen, setFiltersOpen] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 720px)");
    const applyState = () => {
      setFiltersOpen(!media.matches);
    };

    applyState();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", applyState);
      return () => media.removeEventListener("change", applyState);
    }

    media.addListener(applyState);
    return () => media.removeListener(applyState);
  }, []);

  const maxRio = Math.max(0, Math.ceil(liveStats.maxRioAll || 0));
  const maxItemLevel = Math.max(0, Math.ceil(liveStats.maxItemLevel || 0));

  useEffect(() => {
    setRioMax((value) => (value <= 0 || value < maxRio ? maxRio : Math.min(value, maxRio)));
  }, [maxRio]);

  useEffect(() => {
    setItemLevelMax((value) =>
      value <= 0 || value < maxItemLevel ? maxItemLevel : Math.min(value, maxItemLevel),
    );
  }, [maxItemLevel]);

  const options = useMemo(
    () => ({
      classes: [
        "Усі класи",
        ...uniqueSorted(liveMembers.map((member) => member.className)),
      ],
      specs: [
        "Усі спеки",
        ...uniqueSorted(liveMembers.map((member) => member.specName)),
      ],
      factions: [
        "Усі фракції",
        ...uniqueSorted(liveMembers.map((member) => member.faction)),
      ],
    }),
    [liveMembers],
  );

  const filteredMembers = useMemo(() => {
    const search = query.trim().toLowerCase();
    const minRio = Math.min(rioMin, rioMax);
    const maxRioValue = Math.max(rioMin, rioMax);
    const minItemLevel = Math.min(itemLevelMin, itemLevelMax);
    const maxItemLevelValue = Math.max(itemLevelMin, itemLevelMax);

    return liveMembers
      .filter((member) => {
        const score = member.scores[segment] || 0;
        if (score < minRio || score > maxRioValue) return false;
        if (
          member.itemLevel < minItemLevel ||
          member.itemLevel > maxItemLevelValue
        )
          return false;
        if (classFilter !== "Усі класи" && member.className !== classFilter)
          return false;
        if (specFilter !== "Усі спеки" && member.specName !== specFilter)
          return false;
        if (
          roleFilter !== "Усі ролі" &&
          ROLE_LABELS[member.role] !== roleFilter
        )
          return false;
        if (factionFilter !== "Усі фракції" && member.faction !== factionFilter)
          return false;
        if (!search) return true;

        return [
          member.name,
          member.realmName,
          member.realmSlug,
          member.className,
          member.specName,
          member.raceName,
          member.faction,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);
      })
      .sort((a, b) => {
        if (sort === "rio-asc")
          return (
            (a.scores[segment] || 0) - (b.scores[segment] || 0) ||
            stableTextCompare(a.name, b.name)
          );
        if (sort === "ilvl-desc")
          return (
            b.itemLevel - a.itemLevel ||
            (b.scores[segment] || 0) - (a.scores[segment] || 0)
          );
        if (sort === "name-asc") return stableTextCompare(a.name, b.name);
        if (sort === "rank-asc")
          return (
            (a.rank ?? 999) - (b.rank ?? 999) ||
            stableTextCompare(a.name, b.name)
          );
        return (
          (b.scores[segment] || 0) - (a.scores[segment] || 0) ||
          b.itemLevel - a.itemLevel ||
          stableTextCompare(a.name, b.name)
        );
      });
  }, [
    liveMembers,
    segment,
    query,
    classFilter,
    specFilter,
    roleFilter,
    factionFilter,
    rioMin,
    rioMax,
    itemLevelMin,
    itemLevelMax,
    sort,
  ]);

  const statData = useMemo(() => {
    const armorColors: Record<ArmorType, string> = {
      Тканина: "#8a5cff",
      Шкіра: "#ffad22",
      Кольчуга: "#45c7f4",
      Лати: "#ff4d59",
    };
    const armorCounts = ARMOR_LABELS.map((label) => ({
      label,
      count: liveMembers.filter((member) => getArmorType(member) === label)
        .length,
      color: armorColors[label],
    }));

    const roleColors: Record<string, string> = {
      dps: "#ff737d",
      healer: "#4eff63",
      tank: "#65b7ff",
      unknown: "#9aa3b2",
    };
    const roleCounts = ROLE_ORDER.map((role) => ({
      role,
      count: liveMembers.filter((member) => member.role === role).length,
      averageRio: liveMembers
        .filter((member) => member.role === role)
        .reduce(
          (sum, member, _, arr) =>
            sum + member.scores.all / Math.max(1, arr.length),
          0,
        ),
      color: roleColors[role],
    })).filter((item) => item.count > 0 || item.role !== "unknown");

    return { armorCounts, roleCounts };
  }, [liveMembers]);

  const segmentCounts = useMemo(() => {
    return (["all", "dps", "healer", "tank"] as GuildScoreSegment[]).reduce(
      (acc, item) => {
        acc[item] = liveMembers.filter(
          (member) => (member.scores[item] || 0) > 0,
        ).length;
        return acc;
      },
      {} as Record<GuildScoreSegment, number>,
    );
  }, [liveMembers]);

  const rosterPageSize = 20;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / rosterPageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * rosterPageSize;
  const pagedMembers = filteredMembers.slice(pageStart, pageStart + rosterPageSize);

  useEffect(() => {
    setPage(1);
  }, [segment, query, classFilter, specFilter, roleFilter, factionFilter, rioMin, rioMax, itemLevelMin, itemLevelMax, sort]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  function resetFilters() {
    setQuery("");
    setClassFilter("Усі класи");
    setSpecFilter("Усі спеки");
    setRoleFilter("Усі ролі");
    setFactionFilter("Усі фракції");
    setRioMin(0);
    setRioMax(maxRio);
    setItemLevelMin(0);
    setItemLevelMax(maxItemLevel);
    setSort("rio-desc");
  }

  if (!liveMembers.length) {
    const isStorageLimited =
      liveSource === "firebase-temporary-unavailable" ||
      /ліміт|quota|resource|firebase.*недоступ/i.test(liveError || "");

    if (isStorageLimited) {
      return (
        <section className="guild-roster-empty panel app-error-panel" aria-live="polite">
          <span className="eyebrow">Тимчасовий захист</span>
          <h2>Склад тимчасово недоступний</h2>
          <p>
            Сторінка не може безпечно отримати склад зараз. Ми не запускаємо
            додаткові важкі запити, щоб не погіршити ситуацію.
          </p>
          {liveError ? <small>{liveError}</small> : null}
          <div className="form-actions">
            <button
              className="btn subtle"
              type="button"
              onClick={() => window.location.reload()}
            >
              Оновити сторінку
            </button>
          </div>
        </section>
      );
    }

    return (
      <section className="guild-roster-empty panel">
        <h2>Дані складу ще готуються</h2>
        <p>
          Склад формується з офіційного списку гільдії та оновлюється
          покроково. Запусти оновлення або зачекай, поки фонова синхронізація
          завершить підготовку.
        </p>
        {liveError ? <small>{liveError}</small> : null}
      </section>
    );
  }

  return (
    <>
      <section className="dashboard-table-card dashboard-list-panel dashboard-table-card--roster panel" aria-label="Компактний склад гільдії">
        <div className="dashboard-table-titlebar dashboard-list-head">
          <div>
            <span className="eyebrow">Склад</span>
            <h2>Ростер гільдії</h2>
          </div>
          <div className="dashboard-table-controls" aria-label="Пошук і швидкі фільтри складу">
            <label className="dashboard-table-search" htmlFor="guild-roster-search">
              <span className="sr-only">Пошук персонажа</span>
              <input
                id="guild-roster-search"
                name="guild_roster_search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Пошук персонажа"
                autoComplete="off"
              />
            </label>
            {(["all", "dps", "healer", "tank"] as GuildScoreSegment[]).map((item) => (
              <button
                type="button"
                key={item}
                className={`dashboard-table-filter${segment === item ? " is-active" : ""}`}
                onClick={() => setSegment(item)}
                title={`${SEGMENT_LABELS[item]}: ${segmentCounts[item]} персонажів з RIO`}
              >
                {SEGMENT_LABELS[item] === "ALL" ? "Всі" : SEGMENT_LABELS[item]}
              </button>
            ))}
            <button
              type="button"
              className={`dashboard-table-filter dashboard-table-filter--muted${filtersOpen ? " is-active" : ""}`}
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
            >
              Фільтри
            </button>
          </div>
        </div>

        <div className="dashboard-table-stats" aria-label="Показники складу">
          <div>
            <span>Учасників</span>
            <strong>{formatNumber(liveStats.memberCount || liveMembers.length)}</strong>
          </div>
          <div>
            <span>Показано</span>
            <strong>{formatNumber(filteredMembers.length)}</strong>
          </div>
          <div>
            <span>M+ профілів</span>
            <strong>{formatNumber(segmentCounts.all)}</strong>
          </div>
          <div>
            <span>Сер. ilvl</span>
            <strong>{formatNumber(liveStats.averageItemLevel)}</strong>
          </div>
          <div>
            <span>Топ M+</span>
            <strong>{formatNumber(liveStats.maxRioAll, 1)}</strong>
          </div>
          <div>
            <span>Макс. ilvl</span>
            <strong>{formatNumber(liveStats.maxItemLevel)}</strong>
          </div>
        </div>

        {filtersOpen ? (
          <div className="dashboard-table-advanced panel" aria-label="Розширені фільтри складу">
            <RangeFilter
              idBase="guild-roster-rio"
              nameBase="guild_roster_rio"
              label="RIO"
              minValue={rioMin}
              maxValue={rioMax}
              absoluteMin={0}
              absoluteMax={maxRio}
              onMinChange={setRioMin}
              onMaxChange={setRioMax}
            />
            <RangeFilter
              idBase="guild-roster-item-level"
              nameBase="guild_roster_item_level"
              label="Item level"
              minValue={itemLevelMin}
              maxValue={itemLevelMax}
              absoluteMin={0}
              absoluteMax={maxItemLevel}
              onMinChange={setItemLevelMin}
              onMaxChange={setItemLevelMax}
            />
            <FilterSelect
              id="guild-roster-class"
              name="guild_roster_class"
              label="Клас"
              value={classFilter}
              options={options.classes}
              onChange={setClassFilter}
            />
            <FilterSelect
              id="guild-roster-spec"
              name="guild_roster_spec"
              label="Спек"
              value={specFilter}
              options={options.specs}
              onChange={setSpecFilter}
            />
            <FilterSelect
              id="guild-roster-role"
              name="guild_roster_role"
              label="Роль"
              value={roleFilter}
              options={["Усі ролі", "Танк", "Хіл", "DPS", "Без ролі"]}
              onChange={setRoleFilter}
            />
            <FilterSelect
              id="guild-roster-faction"
              name="guild_roster_faction"
              label="Фракція"
              value={factionFilter}
              options={options.factions}
              onChange={setFactionFilter}
            />
            <label className="guild-filter-field" htmlFor="guild-roster-sort">
              <span>Сортування</span>
              <select
                id="guild-roster-sort"
                name="guild_roster_sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                <option value="rio-desc">RIO: від більшого</option>
                <option value="rio-asc">RIO: від меншого</option>
                <option value="ilvl-desc">Item level: від більшого</option>
                <option value="name-asc">Ім’я: А–Я</option>
                <option value="rank-asc">Гільдійний ранг</option>
              </select>
            </label>
            <div className="dashboard-table-advanced__actions">
              <button type="button" className="btn subtle" onClick={resetFilters}>
                Скинути
              </button>
              <small>
                {liveStats.updatedAt ? `Оновлено: ${formatRosterDate(liveStats.updatedAt)}` : "Дані складу оновлюються фоново"}
              </small>
            </div>
          </div>
        ) : null}

        <div className="dashboard-table-scroll">
          <div className="dashboard-table dashboard-list dashboard-table--guild" role="table" aria-label="Список персонажів гільдії">
            <div className="dashboard-table-head" role="row">
              <span role="columnheader">Персонаж</span>
              <span role="columnheader">Клас / спек</span>
              <span role="columnheader">Роль</span>
              <span role="columnheader">ILVL</span>
              <span role="columnheader">M+ ↓</span>
              <span role="columnheader">ГІ ранг</span>
              <span role="columnheader">Профіль</span>
              <span role="columnheader">Raider.IO</span>
            </div>
            {pagedMembers.length ? (
              pagedMembers.map((member, index) => {
                const score = member.scores[segment] || 0;
                const ownerProfileHref = member.ownerProfileId
                  ? `/profile/${encodeURIComponent(member.ownerProfileId)}`
                  : null;
                return (
                  <article
                    className={`dashboard-table-row dashboard-list-row dashboard-table-row--clickable guild-table-row guild-table-row--${member.role}`}
                    key={member.key}
                    role="row"
                    tabIndex={ownerProfileHref ? 0 : undefined}
                    data-profile-href={ownerProfileHref || undefined}
                    title={ownerProfileHref ? `Відкрити профіль: ${member.ownerDisplayName || member.name}` : undefined}
                    onClick={(event) => openProfileCard(event, ownerProfileHref)}
                    onKeyDown={(event) => openProfileCardWithKeyboard(event, ownerProfileHref)}
                  >
                    <div className="dashboard-table-primary" role="cell">
                      <strong style={{ color: classColor(member.className) }}>{member.name}</strong>
                      <small>{member.realmName || member.realmSlug}</small>
                    </div>
                    <div role="cell">
                      <strong>{member.className || "—"}</strong>
                      <small>{member.specName || "—"}</small>
                    </div>
                    <div role="cell"><span className={`dashboard-table-pill dashboard-table-pill--${member.role}`}>{roleShort(member.role)}</span></div>
                    <div role="cell">{member.itemLevel || "—"}</div>
                    <div role="cell" className="dashboard-table-score"><strong>{formatNumber(score, 1)}</strong><small>{SEGMENT_LABELS[segment]}</small></div>
                    <div role="cell">{member.rank === null || member.rank === undefined ? "—" : `#${member.rank}`}</div>
                    <div role="cell">
                      {ownerProfileHref ? (
                        <a href={ownerProfileHref} onClick={(event) => event.stopPropagation()}>
                          Профіль
                        </a>
                      ) : (
                        <span className="dashboard-table-muted">—</span>
                      )}
                    </div>
                    <div role="cell">
                      {member.profileUrl ? (
                        <a href={member.profileUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                          RIO
                        </a>
                      ) : (
                        <span className="dashboard-table-muted">—</span>
                      )}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="dashboard-table-empty" role="row">
                <strong>Нікого не знайдено</strong>
                <span>Зміни фільтри або скинь їх.</span>
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-table-footer">
          <small>
            Сторінка {safePage} / {pageCount} • {rosterPageSize} персонажів на сторінку
          </small>
          <div className="dashboard-table-pagination" aria-label="Навігація сторінками складу">
            <button type="button" className="btn subtle" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              Назад
            </button>
            <button type="button" className="btn subtle" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
              Далі
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
