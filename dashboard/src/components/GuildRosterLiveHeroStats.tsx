"use client";

import { useMemo } from "react";
import GuildRosterRefreshButton, {
  type GuildRosterRefreshSettings,
} from "@/components/GuildRosterRefreshButton";
import type { GuildRosterMember, GuildRosterStats } from "@/lib/guildRoster";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import styles from "./GuildRoster.module.css";

type Props = {
  members: GuildRosterMember[];
  stats: GuildRosterStats;
  source: string;
  error?: string | null;
  refreshSettings?: GuildRosterRefreshSettings;
  allowManualRefresh?: boolean;
};

type GuildRosterLivePayload = Props & {
  ok?: boolean;
  memberCount?: number;
  updatedAt?: string | null;
  refresh?: unknown;
};

function formatDate(value?: string | null) {
  if (!value) return "очікується";
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
  refreshSettings,
  allowManualRefresh = false,
}: Props) {
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

  const liveMembers = rosterResource.data.members;
  const liveStats = rosterResource.data.stats || stats;
  const rioProfiles = liveMembers.filter((member) => member.hasRaiderIo).length;
  const raidProfiles = liveMembers.filter((member) => member.raidProgression?.length).length;

  return (
    <div className={styles.summary} aria-label="Стан синхронізації складу">
      <div className={styles.summaryTop}>
        <div className={styles.summaryBrand}>
          <img src="/mistblossom-icon.png" alt="" loading="lazy" />
          <div>
            <strong>{liveStats.guildName}</strong>
            <small>{liveStats.guildRealm} · {liveStats.guildFaction}</small>
          </div>
        </div>
        <div className={styles.summaryFreshness}>
          <strong>{liveStats.memberCount.toLocaleString("uk-UA")} персонажів</strong>
          <small>База: {formatDate(liveStats.updatedAt)}</small>
        </div>
      </div>

      <div className={styles.summaryMetrics}>
        <div className={styles.summaryMetric}><span>Сер. RIO</span><strong>{round(liveStats.averageRioAll)}</strong></div>
        <div className={styles.summaryMetric}><span>Сер. ILVL</span><strong>{round(liveStats.averageItemLevel)}</strong></div>
        <div className={styles.summaryMetric}><span>RIO профілі</span><strong>{rioProfiles}</strong></div>
        <div className={styles.summaryMetric}><span>Рейд дані</span><strong>{raidProfiles}</strong></div>
      </div>

      <div className={styles.summaryBottom}>
        <span className={styles.autoStatus}>
          <span className={styles.autoDot} aria-hidden="true" />
          Автосинхронізація на VPS · Battle.net → Raider.IO → PostgreSQL
        </span>
        {allowManualRefresh && refreshSettings ? (
          <GuildRosterRefreshButton settings={refreshSettings} />
        ) : null}
      </div>
    </div>
  );
}
