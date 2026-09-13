import type { NextRequest } from "next/server";
import { loadStoredGuildRosterData, type GuildRosterMember } from "@/lib/guildRoster";
import { listRaids, raidRosterCounts, raidCapacity, type RaidItem } from "@/lib/raids";
import { splitCsv } from "@/lib/security";

const DEFAULT_SITE_ORIGINS = ["https://lihvodruida.pp.ua", "https://www.lihvodruida.pp.ua"];

export function publicSiteOrigins() {
  const configured = splitCsv(process.env.PUBLIC_SITE_ORIGINS);
  return Array.from(new Set([...(configured.length ? configured : DEFAULT_SITE_ORIGINS)]));
}

export function isAllowedPublicSiteOrigin(request: Request | NextRequest) {
  const rawOrigin = String(request.headers.get("origin") || "").trim();
  if (!rawOrigin) return process.env.NODE_ENV !== "production";
  try {
    const origin = new URL(rawOrigin).origin;
    return publicSiteOrigins().includes(origin);
  } catch {
    return false;
  }
}

export function publicSiteCorsHeaders(request: Request | NextRequest, methods = "GET, POST, OPTIONS") {
  const rawOrigin = String(request.headers.get("origin") || "").trim();
  let allowOrigin = "";
  try {
    const origin = rawOrigin ? new URL(rawOrigin).origin : "";
    if (origin && publicSiteOrigins().includes(origin)) allowOrigin = origin;
  } catch {}

  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
}

function normalizeRole(role: GuildRosterMember["role"]) {
  if (role === "healer") return "HEALING";
  if (role === "tank") return "TANK";
  if (role === "dps") return "DPS";
  return "NONE";
}

function scoreBlock(member: GuildRosterMember, key: "all" | "tank" | "healer" | "dps") {
  return {
    score: Number(member.scores?.[key] || 0),
    color: member.scoreColors?.[key] || "#8b93a1",
  };
}

function publicRosterMember(member: GuildRosterMember) {
  return {
    rank: member.rank,
    character: {
      name: member.name,
      region: member.region,
      realm: { slug: member.realmSlug, name: member.realmName },
      playable_class: { name: member.className },
      playable_race: { name: member.raceName },
      faction: { type: String(member.faction || "").toUpperCase(), name: member.faction },
      gender: member.gender,
      active_spec: { name: member.specName, role: normalizeRole(member.role) },
      avatar: member.avatarUrl,
      profile_url: member.profileUrl,
      item_level_equipped: member.itemLevel,
      mythic_plus_scores: {
        all: scoreBlock(member, "all"),
        tank: scoreBlock(member, "tank"),
        healer: scoreBlock(member, "healer"),
        dps: scoreBlock(member, "dps"),
      },
      raid_progression: member.raidProgression,
    },
  };
}


function publicRaidSeasonSnapshot(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const seasons = Array.isArray(snapshot.seasons) ? snapshot.seasons : [];
  const catalog = snapshot.catalog && typeof snapshot.catalog === "object" ? snapshot.catalog : {};
  return {
    detected_at: snapshot.detectedAt || null,
    source: snapshot.source || null,
    region: snapshot.region || "eu",
    current_expansion_id: snapshot.currentExpansionId ?? null,
    current_expansion: snapshot.currentExpansion || null,
    current_season_id: snapshot.currentSeasonId || null,
    current_season_slug: snapshot.currentSeasonSlug || null,
    battle_net_expansion_id: snapshot.battleNetExpansionId ?? null,
    battle_net_expansion: snapshot.battleNetExpansion || null,
    battle_net_raid_names: Array.isArray(snapshot.battleNetRaidNames) ? snapshot.battleNetRaidNames : [],
    seasons: seasons.map((season: any) => ({
      id: season.id,
      slug: season.slug,
      name: season.name,
      label: season.label,
      short_name: season.shortName,
      expansion: season.expansion,
      expansion_id: season.expansionId,
      starts_at: season.startsAt,
      ends_at: season.endsAt,
      current: Boolean(season.current),
      raids: Array.isArray(season.raids) ? season.raids : [],
    })),
    catalog: Object.fromEntries(Object.entries(catalog).map(([slug, raw]: [string, any]) => [slug, {
      slug,
      name: raw?.name || slug,
      short_name: raw?.shortName || null,
      expansion: raw?.expansion || null,
      expansion_id: raw?.expansionId ?? null,
      bosses: Number(raw?.bosses || 0),
      starts_at: raw?.startsAt || null,
      ends_at: raw?.endsAt || null,
      active_now: Boolean(raw?.activeNow),
      current_season: Boolean(raw?.currentSeason),
    }])),
  };
}

function publicRaid(raid: RaidItem) {
  const counts = raidRosterCounts(raid);
  return {
    id: raid.id,
    title: raid.title,
    date: raid.date,
    time: raid.time,
    difficulty: raid.difficulty,
    status: raid.status,
    image_url: raid.imageUrl || raid.thumbnailUrl || null,
    raid_leader: raid.raidLeaderName || raid.createdByName || null,
    capacity: raidCapacity(raid),
    roster: counts.roster,
    going: counts.going,
    tentative: counts.tentative,
    late: counts.late,
    tanks: counts.tanks,
    healers: counts.healers,
    dps: counts.dps,
    updated_at: raid.updatedAt || raid.createdAt || null,
  };
}

export async function buildPublicGuildSnapshot() {
  const [roster, raids] = await Promise.all([
    loadStoredGuildRosterData(),
    listRaids(40).catch(() => []),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const scheduledRaids = raids
    .filter((raid) => raid.status === "published")
    .filter((raid) => !raid.date || raid.date >= today)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .slice(0, 12)
    .map(publicRaid);

  const progression = Object.fromEntries((roster.stats.raidProgression || []).map((raid) => [raid.slug, {
    name: raid.name,
    summary: raid.summary,
    total_bosses: raid.totalBosses,
    normal_bosses_killed: raid.normalKills,
    heroic_bosses_killed: raid.heroicKills,
    mythic_bosses_killed: raid.mythicKills,
  }]));
  const rankings = Object.fromEntries((roster.stats.raidRankings || []).map((ranking) => [ranking.slug, {
    normal: ranking.normal,
    heroic: ranking.heroic,
    mythic: ranking.mythic,
  }]));

  return {
    schema: "mistblossom.public-guild.v1",
    generated_at: new Date().toISOString(),
    metadata: {
      updated_at: roster.stats.updatedAt,
      roster_updated_at: roster.stats.rosterUpdatedAt || roster.stats.updatedAt,
      source: roster.source,
      region: roster.members[0]?.region || "eu",
    },
    guild: {
      name: roster.stats.guildName,
      realm: {
        name: roster.stats.guildRealm,
        slug: String(roster.stats.guildRealm || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      },
      faction: {
        type: String(roster.stats.guildFaction || "Alliance").toUpperCase(),
        name: roster.stats.guildFaction,
      },
      member_count: roster.stats.memberCount,
      profile_url: roster.stats.profileUrl,
    },
    raid_progression: progression,
    raid_rankings: rankings,
    raid_seasons: publicRaidSeasonSnapshot(roster.stats.raidSeasonSnapshot),
    members: roster.members.map(publicRosterMember),
    scheduled_raids: scheduledRaids,
  };
}
