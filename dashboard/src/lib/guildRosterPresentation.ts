import type { GuildRosterMember, GuildRosterStats, GuildRaidProgress } from "@/lib/guildRoster";
import { primaryCurrentRaidProgress } from "@/lib/characterRaidProgress";
export function normalizedRaidProgress(member: GuildRosterMember) {
  return Array.isArray(member.raidProgression) ? member.raidProgression : [];
}

export function bestRaid(member: GuildRosterMember, snapshot: GuildRosterStats["raidSeasonSnapshot"], raidSlug = "all") {
  const raids = normalizedRaidProgress(member);
  if (raidSlug !== "all") {
    return raids.find((raid) => raid.slug === raidSlug) || null;
  }
  return primaryCurrentRaidProgress(raids, snapshot);
}

export function raidWeight(raid: GuildRaidProgress | null) {
  if (!raid) return 0;
  return raid.mythicKills * 1_000_000 + raid.heroicKills * 10_000 + raid.normalKills * 100 + raid.totalBosses;
}

export function raidIsClear(raid: GuildRaidProgress | null, difficulty: "normal" | "heroic" | "mythic") {
  if (!raid || raid.totalBosses <= 0) return false;
  if (difficulty === "mythic") return raid.mythicKills >= raid.totalBosses;
  if (difficulty === "heroic") return raid.heroicKills >= raid.totalBosses;
  return raid.normalKills >= raid.totalBosses;
}

export function raidHasProgress(raid: GuildRaidProgress | null) {
  return Boolean(raid && (raid.normalKills > 0 || raid.heroicKills > 0 || raid.mythicKills > 0));
}

export function raidSummary(raid: GuildRaidProgress | null) {
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

export function compactRaidName(name: string) {
  return name.length > 30 ? `${name.slice(0, 29)}…` : name;
}

export function friendlySource(value: string) {
  const source = String(value || "").toLowerCase();
  if (source.includes("raider")) return "Raider.IO → PostgreSQL";
  if (source.includes("battle")) return "Battle.net → PostgreSQL";
  if (source.includes("storage") || source.includes("database") || source.includes("records")) return "PostgreSQL";
  if (source.includes("live-sync")) return "Battle.net + Raider.IO";
  return value || "PostgreSQL";
}

