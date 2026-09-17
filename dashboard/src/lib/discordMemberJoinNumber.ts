import "server-only";

import { discordApi, getDiscordGuildId } from "@/lib/discordAdmin";
import { cleanSnowflake } from "@/lib/values";

/**
 * "Номер учасника" on the welcome card is the member's position in the
 * server's join order: 1 = the earliest current member, N = the newest one.
 * For a fresh join this equals the server member count Discord shows, so bots
 * are counted too, exactly like Discord's own member counter.
 *
 * Members who left are no longer in the list, so numbers of later members can
 * shift down over time; the number printed on an already published card never
 * changes because the card is a static PNG.
 */

const TIMELINE_TTL_MS = 60_000;
const TIMELINE_MIN_REFRESH_MS = 5_000;
const TIMELINE_MAX_MEMBERS = 50_000;
const PAGE_SIZE = 1000;

type JoinTimelineEntry = {
  userId: string;
  joinedAtMs: number;
};

type JoinTimeline = {
  guildId: string;
  fetchedAt: number;
  entries: Map<string, JoinTimelineEntry>;
};

type JoinTimelineCache = {
  value: JoinTimeline | null;
  promise: Promise<JoinTimeline> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomMemberJoinTimeline: JoinTimelineCache | undefined;
}

function timelineCache(): JoinTimelineCache {
  globalThis.__mistblossomMemberJoinTimeline ||= { value: null, promise: null };
  return globalThis.__mistblossomMemberJoinTimeline;
}

function parseJoinedAt(value: unknown) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

/** Snowflakes are decimal strings without leading zeros: compare by length first. */
function compareSnowflakes(a: string, b: string) {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function joinedBefore(candidate: JoinTimelineEntry, target: JoinTimelineEntry) {
  if (candidate.joinedAtMs !== target.joinedAtMs) return candidate.joinedAtMs < target.joinedAtMs;
  return compareSnowflakes(candidate.userId, target.userId) < 0;
}

async function fetchJoinTimeline(guildId: string): Promise<JoinTimeline> {
  const entries = new Map<string, JoinTimelineEntry>();
  let after = "0";

  // Raw member pages (bots included) — the moderation list helper drops bots,
  // which would make the number disagree with Discord's member counter.
  while (entries.size < TIMELINE_MAX_MEMBERS) {
    const page = await discordApi<any[]>(`/guilds/${guildId}/members?limit=${PAGE_SIZE}&after=${after}`);
    if (!Array.isArray(page) || page.length === 0) break;
    for (const member of page) {
      const userId = cleanSnowflake(member?.user?.id);
      const joinedAtMs = parseJoinedAt(member?.joined_at);
      if (!userId || joinedAtMs === null) continue;
      entries.set(userId, { userId, joinedAtMs });
    }
    const lastUserId = cleanSnowflake(page[page.length - 1]?.user?.id);
    if (!lastUserId || lastUserId === after || page.length < PAGE_SIZE) break;
    after = lastUserId;
  }

  return { guildId, fetchedAt: Date.now(), entries };
}

async function loadJoinTimeline(options: { mustContainUserId?: string } = {}): Promise<JoinTimeline> {
  const guildId = getDiscordGuildId();
  if (!guildId) throw new Error("Discord-сервер не підключений до панелі.");

  const cache = timelineCache();
  const now = Date.now();
  const current = cache.value && cache.value.guildId === guildId ? cache.value : null;
  const fresh = Boolean(current && now - current.fetchedAt < TIMELINE_TTL_MS);
  const missingTarget = Boolean(current && options.mustContainUserId && !current.entries.has(options.mustContainUserId));
  // A newcomer who joined after the cached snapshot forces one refresh, but a
  // burst of joins shares that refresh instead of re-listing the whole server.
  const canRefreshForTarget = Boolean(current && now - current.fetchedAt >= TIMELINE_MIN_REFRESH_MS);

  if (current && fresh && (!missingTarget || !canRefreshForTarget)) return current;
  if (cache.promise) return cache.promise;

  cache.promise = fetchJoinTimeline(guildId)
    .then((timeline) => {
      cache.value = timeline;
      return timeline;
    })
    .finally(() => {
      cache.promise = null;
    });
  return cache.promise;
}

export async function resolveDiscordMemberJoinNumber(member: { userId: string; joinedAt?: string | null }): Promise<number> {
  const userId = cleanSnowflake(member.userId);
  const timeline = await loadJoinTimeline({ mustContainUserId: userId || undefined });

  const listed = userId ? timeline.entries.get(userId) : undefined;
  const fallbackJoinedAtMs = parseJoinedAt(member.joinedAt) ?? Date.now();
  // If Discord's cached member page predates this join, remember the newcomer
  // provisionally in the shared timeline. This makes burst joins unique and
  // correctly ordered without forcing a full member-list refresh for every
  // GUILD_MEMBER_ADD. The next real refresh replaces provisional data.
  const target: JoinTimelineEntry = listed || { userId: userId || "9".repeat(25), joinedAtMs: fallbackJoinedAtMs };
  if (userId && !listed) timeline.entries.set(userId, target);

  let before = 0;
  for (const entry of timeline.entries.values()) {
    if (entry.userId !== target.userId && joinedBefore(entry, target)) before += 1;
  }
  const position = before + 1;

  return position;
}

export function formatDiscordMemberJoinNumber(position: number) {
  return Number.isFinite(position) && position > 0 ? String(Math.floor(position)) : "";
}
