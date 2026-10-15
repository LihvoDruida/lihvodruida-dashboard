import type { GuildRosterMember, GuildScoreSegment } from "@/lib/guildRoster";
import { stableTextCompare } from "@/lib/stableUiText";

export type GuildRosterSort = "rio-desc" | "rio-asc" | "ilvl-desc" | "raid-desc" | "name-asc" | "rank-asc";
export type GuildRaidClearFilter = "all" | "progress" | "normal-clear" | "heroic-clear" | "mythic-clear" | "no-raid";
export type GuildLinkFilter = "all" | "profile" | "raiderio";

function text(value: string | null, limit = 80) {
  return String(value || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit);
}
function choice<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}
function number(value: string | null, ceiling: number): number | null {
  if (value === null || !/^\d{1,8}(?:\.\d{1,3})?$/.test(value)) return null;
  return Math.min(ceiling, Number(value));
}
function range(params: URLSearchParams, prefix: string, ceiling: number) {
  const min = number(params.get(`${prefix}Min`), ceiling) ?? 0;
  const max = number(params.get(`${prefix}Max`), ceiling);
  return max !== null && min > max ? { min: max, max: min } : { min, max };
}

/** null upper bounds follow new roster data; explicit upper bounds remain fixed. */
export function readGuildRosterView(params: URLSearchParams) {
  return {
    q: text(params.get("q"), 160),
    role: choice(params.get("role"), ["all", "tank", "healer", "dps"] as const, "all"),
    segment: choice<GuildScoreSegment>(params.get("segment"), ["all", "tank", "healer", "dps"], "all"),
    className: text(params.get("class")) || "all",
    spec: text(params.get("spec")) || "all",
    faction: text(params.get("faction")) || "all",
    raid: text(params.get("raid")) || "all",
    clear: choice<GuildRaidClearFilter>(params.get("clear"), ["all", "progress", "normal-clear", "heroic-clear", "mythic-clear", "no-raid"], "all"),
    link: choice<GuildLinkFilter>(params.get("link"), ["all", "profile", "raiderio"], "all"),
    sort: choice<GuildRosterSort>(params.get("sort"), ["rio-desc", "rio-asc", "ilvl-desc", "raid-desc", "name-asc", "rank-asc"], "rio-desc"),
    rio: range(params, "rio", 100000),
    ilvl: range(params, "ilvl", 10000),
    page: Math.max(1, Math.floor(number(params.get("page"), 10000) ?? 1)),
    size: choice(params.get("size"), ["25", "50", "100"] as const, "25"),
    filtersOpen: params.get("filters") === "1",
  };
}

export function guildRosterViewParams(input: URLSearchParams, includePage = true): URLSearchParams {
  const view = readGuildRosterView(input);
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  for (const [key, value] of Object.entries({ role: view.role, segment: view.segment, class: view.className,
    spec: view.spec, faction: view.faction, raid: view.raid, clear: view.clear, link: view.link })) {
    if (value !== "all") params.set(key, value);
  }
  if (view.sort !== "rio-desc") params.set("sort", view.sort);
  for (const [prefix, bounds] of [["rio", view.rio], ["ilvl", view.ilvl]] as const) {
    if (bounds.min) params.set(`${prefix}Min`, String(bounds.min));
    if (bounds.max !== null) params.set(`${prefix}Max`, String(bounds.max));
  }
  if (includePage && view.page > 1) params.set("page", String(view.page));
  if (view.size !== "25") params.set("size", view.size);
  if (view.filtersOpen) params.set("filters", "1");
  return params;
}

export function compareGuildRosterMembers(a: GuildRosterMember, b: GuildRosterMember,
  sort: GuildRosterSort, segment: GuildScoreSegment, raidWeight: (member: GuildRosterMember) => number = () => 0) {
  const rio = (b.scores[segment] || 0) - (a.scores[segment] || 0);
  const primary = sort === "rio-asc" ? -rio
    : sort === "ilvl-desc" ? b.itemLevel - a.itemLevel || rio
    : sort === "raid-desc" ? raidWeight(b) - raidWeight(a) || rio
    : sort === "name-asc" ? 0
    : sort === "rank-asc" ? (a.rank ?? 999) - (b.rank ?? 999)
    : rio || b.itemLevel - a.itemLevel;
  return primary || stableTextCompare(a.name, b.name) || stableTextCompare(a.realmSlug, b.realmSlug) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
