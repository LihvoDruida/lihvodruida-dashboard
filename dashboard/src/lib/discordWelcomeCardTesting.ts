import "server-only";

import { fetchDiscordGuildMemberSnapshot, type DiscordGuildMemberModerationItem } from "@/lib/discordAdmin";


const TEST_MEMBER_CACHE_TTL_MS = 60_000;
const TEST_MEMBER_CACHE_MAX = 32;

type TestMemberCacheEntry = {
  expiresAt: number;
  promise: Promise<DiscordGuildMemberModerationItem>;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomWelcomeTestMemberCache: Map<string, TestMemberCacheEntry> | undefined;
}

function testMemberCache() {
  const cache = globalThis.__mistblossomWelcomeTestMemberCache || new Map<string, TestMemberCacheEntry>();
  globalThis.__mistblossomWelcomeTestMemberCache = cache;
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  while (cache.size > TEST_MEMBER_CACHE_MAX) {
    const first = cache.keys().next().value as string | undefined;
    if (!first) break;
    cache.delete(first);
  }
  return cache;
}

async function fetchCachedTestMember(userId: string) {
  const cache = testMemberCache();
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = fetchDiscordGuildMemberSnapshot(userId).catch((error) => {
    cache.delete(userId);
    throw error;
  });
  cache.set(userId, { expiresAt: Date.now() + TEST_MEMBER_CACHE_TTL_MS, promise });
  return promise;
}

export type DiscordWelcomeCardTestInput = {
  userId: string;
  displayName: string;
  username: string;
  greeting: string;
  number: string;
  nickname: string;
};

function cleanText(value: unknown, max: number) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, Math.max(0, max))
    .join("");
}

export function cleanWelcomeTestUserId(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

export function normalizeDiscordWelcomeCardTestInput(input: Record<string, unknown>): DiscordWelcomeCardTestInput {
  return {
    userId: cleanWelcomeTestUserId(input.userId || input.testUserId),
    displayName: cleanText(input.displayName || input.testDisplayName, 40),
    username: cleanText(input.username || input.testUsername, 32),
    greeting: cleanText(input.greeting || input.testGreeting, 80),
    number: cleanText(input.number || input.testNumber, 8).replace(/[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ-]/g, "").slice(0, 8),
    nickname: cleanText(input.nickname || input.testNickname, 96),
  };
}

export function buildDiscordWelcomeCardTestMember(input: DiscordWelcomeCardTestInput): DiscordGuildMemberModerationItem {
  const fallbackId = input.userId || "1000000000004086";
  const displayName = input.displayName || input.username || "Новий мандрівник";
  const username = input.username || "mistblossom.recruit";
  return {
    userId: fallbackId,
    username,
    globalName: displayName,
    displayName,
    nick: displayName,
    avatarUrl: null,
    defaultAvatarUrl: null,
    joinedAt: new Date().toISOString(),
    roleIds: [],
  };
}

export async function resolveDiscordWelcomeCardTestMember(input: DiscordWelcomeCardTestInput): Promise<{
  member: DiscordGuildMemberModerationItem;
  liveMember: boolean;
  lookupError: string | null;
}> {
  const fallback = buildDiscordWelcomeCardTestMember(input);
  if (!input.userId) return { member: fallback, liveMember: false, lookupError: null };

  try {
    const live = await fetchCachedTestMember(input.userId);
    const manualDisplayName = input.displayName === "Новий мандрівник" ? "" : input.displayName;
    const manualUsername = input.username === "mistblossom.recruit" ? "" : input.username;
    return {
      member: {
        ...live,
        username: manualUsername || live.username || fallback.username,
        globalName: live.globalName || manualDisplayName || fallback.globalName,
        displayName: manualDisplayName || live.displayName || fallback.displayName,
        nick: manualDisplayName || live.nick || fallback.nick,
      },
      liveMember: true,
      lookupError: null,
    };
  } catch (error) {
    return {
      member: fallback,
      liveMember: false,
      lookupError: error instanceof Error ? error.message : String(error || "Не вдалося прочитати Discord-учасника."),
    };
  }
}
