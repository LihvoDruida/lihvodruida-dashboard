import "server-only";
import {getSession} from "@/lib/auth";
import {canManageRaids, canViewRaidRoster, canViewRaidDirectory} from "@/lib/permissions";
import {getRaid, hasRaidStorage} from "@/lib/raids";
export async function loadRaidDetailsWorkspace({params}: {params: Promise<{raidId: string}>}) {
  const user = await getSession(), canManage = canManageRaids(user), canSeeRoster = !user || canViewRaidRoster(user);
  const {raidId} = await params;
  let unavailable = !hasRaidStorage();
  const raid = await getRaid(raidId).catch(() => {unavailable = true; return null;});
  const visibleRaid = raid && (raid.status === "published" || raid.status === "closed" || canManage) ? raid : null;
  return {user,canManage,canSeeRoster,raid: visibleRaid,unavailable,canReturnToList: Boolean(user && canViewRaidDirectory(user))};
}
export type RaidDetailsWorkspaceModel = Awaited<ReturnType<typeof loadRaidDetailsWorkspace>>;
