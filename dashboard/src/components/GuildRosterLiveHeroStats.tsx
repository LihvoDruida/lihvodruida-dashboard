"use client";

import { useMemo } from "react";
import type { GuildRosterMember, GuildRosterStats } from "@/lib/guildRoster";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";

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

function formatDate(value?: string | null) {
  if (!value) return "оновлення очікується";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Kyiv",
  }).format(date);
}

function round(value: number) {
  return Math.round(value || 0).toLocaleString("uk-UA");
}

export default function GuildRosterLiveHeroStats({
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
    refreshOnMount: false,
  });

  const liveMembers = rosterResource.data.members.length
    ? rosterResource.data.members
    : members;
  const liveStats = rosterResource.data.stats || stats;

  return (
    <>
      <div className="guild-hero-summary">
        <section className="guild-hero-summary__block">
          <span className="guild-hero-summary__label">ГІЛЬДІЯ</span>
          <strong>{liveStats.guildName}</strong>
          <p>{liveStats.guildRealm}</p>
        </section>

        <section className="guild-hero-summary__block">
          <span className="guild-hero-summary__label">СКЛАД</span>
          <strong>{liveStats.memberCount.toLocaleString("uk-UA")} персонажів</strong>
          <p>Оновлено: {formatDate(liveStats.updatedAt)}</p>
        </section>
      </div>

      <div className="guild-hero-stats" aria-label="Коротка статистика складу">
        <div className="guild-hero-stat-card">
          <span>СЕР. RIO</span>
          <strong>{round(liveStats.averageRioAll)}</strong>
        </div>
        <div className="guild-hero-stat-card">
          <span>СЕР. ILVL</span>
          <strong>{round(liveStats.averageItemLevel)}</strong>
        </div>
        <div className="guild-hero-stat-card">
          <span>МАКС. RIO</span>
          <strong>{round(liveStats.maxRioAll)}</strong>
        </div>
      </div>

      {rosterResource.status === "checking" ? (
        <p className="guild-refresh-action__status guild-refresh-action__status--loading">
          Зчитую актуальний Firebase-запис складу…
        </p>
      ) : null}
      {!liveMembers.length && (rosterResource.error || error) ? (
        <p className="guild-refresh-action__status guild-refresh-action__status--error">
          {rosterResource.error || error}
        </p>
      ) : null}
    </>
  );
}
