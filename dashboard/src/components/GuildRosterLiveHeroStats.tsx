"use client";

import { useMemo } from "react";
import GuildRosterRefreshButton, {
  type GuildRosterRefreshSettings,
} from "@/components/GuildRosterRefreshButton";
import type { GuildRosterMember, GuildRosterStats } from "@/lib/guildRoster";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import PageHeader from "@/components/page/PageHeader";
import styles from "./community/workspace.module.css";

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

  const unavailable = Boolean(rosterResource.data.error && !liveMembers.length);
  return <PageHeader title="Склад гільдії" eyebrow={liveStats.guildName} description={`${liveStats.guildRealm} · ${liveStats.guildFaction}. Персонажі, спорядження та прогрес гільдії.`}
    breadcrumbs={[{label: "Склад гільдії"}]}
    actions={allowManualRefresh && refreshSettings ? <GuildRosterRefreshButton settings={refreshSettings} /> : undefined}
    metrics={[{label: "Персонажі",value: unavailable ? "—" : liveStats.memberCount.toLocaleString("uk-UA")},{label: "Середній RIO",value: unavailable ? "—" : round(liveStats.averageRioAll)},
      {label: "Середній ilvl",value: unavailable ? "—" : round(liveStats.averageItemLevel)},{label: "RIO-профілі",value: unavailable ? "—" : rioProfiles},{label: "Рейдові дані",value: unavailable ? "—" : raidProfiles},
      {label: "Оновлено",value: <span className={styles.metadata}>{formatDate(liveStats.updatedAt)}</span>}]} />;
}
