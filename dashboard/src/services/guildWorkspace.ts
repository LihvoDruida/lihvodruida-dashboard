import "server-only";
import { getSessionUser } from "@/lib/auth";
import { loadGuildRosterData } from "@/lib/guildRoster";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";

export async function loadGuildWorkspace() {
  const user = await getSessionUser();
  // Public, read-only roster: Discord login is not required for viewing.

  const [roster, apiSettings] = await Promise.all([
    loadGuildRosterData().catch((error) => {
      void recordDashboardSystemLog(
        "error",
        "page.guild.roster_read_failed",
        {
          summary:
            "Сторінка складу відкрилась без даних зі сховища: читання roster не спрацювало.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: true },
      );
      return {
        members: [],
        stats: {
          guildName: "Mistblossom Vanguard",
          guildRealm: "Terokkar",
          guildFaction: "Alliance",
          profileUrl: null,
          memberCount: 0,
          averageItemLevel: 0,
          averageRioAll: 0,
          maxItemLevel: 0,
          maxRioAll: 0,
          raidProgression: [],
          raidRankings: [],
          raidSeasonSnapshot: null,
          updatedAt: null,
        },
        source: "fallback",
        error:
          "Склад тимчасово недоступний. Сторінку відкрито без live-збору; синхронізація відновить записи в базі даних покроково.",
      };
    }),
    getDashboardApiSettings().catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.guild.settings_read_failed",
        {
          summary:
            "Налаштування синхронізації складу тимчасово недоступні, використано безпечні значення.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return {
        guildRosterClientDrivenSyncEnabled: false,
        guildRosterClientStepDelayMs: 500,
        guildRosterClientRequestTimeoutMs: 25_000,
        guildRosterClientMaxSteps: 500,
      };
    }),
  ]);
  const members = roster.members;
  const storageLimited = roster.source === "storage-temporary-unavailable" && members.length === 0;

  return {user, roster, apiSettings, storageLimited};
}
