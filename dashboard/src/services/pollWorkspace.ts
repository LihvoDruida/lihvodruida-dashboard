import "server-only";
import {redirect} from "next/navigation";
import {getSession} from "@/lib/auth";
import {canManageRaids,canViewRaidDirectory} from "@/lib/permissions";
import {getOwnProfilePath} from "@/lib/profiles";
import {hasDiscordEmbedConfig} from "@/lib/discordAdmin";
import {getRaidPoll, hasRaidPollStorage,listRaidPolls,raidPollStateKey} from "@/lib/raidPolls";
async function context() {
  const user = await getSession();
  if (user && !canViewRaidDirectory(user)) redirect(await getOwnProfilePath(user));
  return {user,canManage: canManageRaids(user)};
}
export async function loadPollDirectoryWorkspace() {
  const {user,canManage} = await context();
  let unavailable = !hasRaidPollStorage();
  const polls = await listRaidPolls(120).catch(() => {unavailable = true; return [];});
  const publishedPolls = polls.filter(poll => poll.channelId && poll.messageId);
  const visiblePolls = canManage ? polls : publishedPolls;
  const counts = {scheduled: visiblePolls.filter(poll => raidPollStateKey(poll) === "scheduled").length,open: visiblePolls.filter(poll => raidPollStateKey(poll) === "open").length,paused: visiblePolls.filter(poll => raidPollStateKey(poll) === "paused").length};
  return {user,canManage,publishedPolls,visiblePolls,counts,unavailable,discordEnabled: hasDiscordEmbedConfig()};
}
export async function loadPollDetailsWorkspace({params}: {params: Promise<{pollId: string}>}) {
  const {user,canManage} = await context(), {pollId} = await params;
  let unavailable = !hasRaidPollStorage(), relatedUnavailable = false;
  const storedPoll = await getRaidPoll(pollId).catch(() => {unavailable = true; return null;});
  const poll = storedPoll && (canManage || storedPoll.channelId && storedPoll.messageId) ? storedPoll : null;
  const relatedPolls = poll ? (await listRaidPolls(120).catch(() => {relatedUnavailable = true;return [poll];})).filter(item => item.channelId && item.messageId) : [];
  return {user,canManage,poll,relatedPolls,unavailable,relatedUnavailable};
}
export type PollDirectoryWorkspaceModel = Awaited<ReturnType<typeof loadPollDirectoryWorkspace>>;
export type PollDetailsWorkspaceModel = Awaited<ReturnType<typeof loadPollDetailsWorkspace>>;
