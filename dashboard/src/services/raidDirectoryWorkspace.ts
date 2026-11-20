import "server-only";
import { listViewUrl } from "@/lib/listViewState";
import { matchesRaidListSearch } from "@/lib/raidListSearch";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import { hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { hasRaidStorage, isRaidClosed, listRaids, raidDateTimeToUtcMs, type RaidItem } from "@/lib/raids";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";

export async function loadRaidDirectoryWorkspace({searchParams}: {searchParams: Promise<Record<string, string | undefined>>}) {
  const user = await getSession();

  const canManage = canManageRaids(user);
  const params = await searchParams;
  if (params.raid) redirect(`/raids/${encodeURIComponent(params.raid)}`);

  let unavailable = !hasRaidStorage();
  const raids = await listRaids(100).catch((error) => {
    unavailable = true;
    void recordDashboardSystemLog(
      "error",
      "page.raids.list_read_failed",
      {
        summary:
          "Сторінка рейдів відкрилась без списку: читання рейдів не спрацювало.",
        message:
          error instanceof Error ? error.message : String(error || "unknown"),
      },
      { persist: true },
    );
    return [];
  });
  const activeRaids = raids.filter(
    (raid) => raid.status === "published" && !isRaidClosed(raid),
  );
  const draftRaids = canManage
    ? raids.filter((raid) => raid.status === "draft")
    : [];
  const closedRaids = raids.filter((raid) => isRaidClosed(raid) && (canManage || raid.status === "published" || raid.status === "closed"));
  const currentRaids = canManage
    ? [...activeRaids, ...draftRaids]
    : activeRaids;
  let nextRaid: RaidItem | null = null;
  let nextStart = Infinity;
  const now = Date.now();
  for (const raid of activeRaids) {
    const start = raidDateTimeToUtcMs(raid);
    if (start === null || !Number.isFinite(start) || start < now || start >= nextStart) continue;
    nextRaid = raid;
    nextStart = start;
  }
  const rawQuery = new URLSearchParams();
  for (const key of ["q", "state", "archive"]) if (typeof params[key] === "string") rawQuery.set(key, params[key]!);
  const currentUrl = listViewUrl("raids", `/raids?${rawQuery}`) || "/raids";
  const filters = new URL(currentUrl, "https://list.invalid").searchParams;
  const query = filters.get("q") || "";
  const state = filters.get("state") || "all";
  const visibleCurrent = currentRaids.filter(raid => matchesRaidListSearch(raid, query) && (state === "all" || state === "active" && raid.status === "published" || state === "draft" && raid.status === "draft"));
  const visibleArchive = closedRaids.filter(raid => matchesRaidListSearch(raid, query));

  return {user, canManage, params, raids, unavailable, discordEnabled: hasDiscordEmbedConfig(), activeRaids, draftRaids, closedRaids, nextRaid, currentUrl, query, state, visibleCurrent, visibleArchive};
}
export type RaidDirectoryWorkspaceModel = Awaited<ReturnType<typeof loadRaidDirectoryWorkspace>>;
