import "server-only";

import { fetchDiscordGuildMemberSnapshot, type DiscordGuildMemberModerationItem } from "@/lib/discordAdmin";

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
    number: cleanText(input.number || input.testNumber, 8).replace(/[^0-9A-Za-zА-Яа-яІіЇїЄєҐґ-]/g, "").slice(0, 8) || "4086",
    nickname: cleanText(input.nickname || input.testNickname, 96),
  };
}

export async function resolveDiscordWelcomeCardTestMember(input: DiscordWelcomeCardTestInput): Promise<{
  member: DiscordGuildMemberModerationItem;
  liveMember: boolean;
  lookupError: string | null;
}> {
  let live: DiscordGuildMemberModerationItem | null = null;
  let lookupError: string | null = null;

  if (input.userId) {
    try {
      live = await fetchDiscordGuildMemberSnapshot(input.userId);
    } catch (error) {
      lookupError = error instanceof Error ? error.message : String(error || "Не вдалося прочитати Discord-учасника.");
    }
  }

  const fallbackId = input.userId || "1000000000004086";
  const manualDisplayName = input.displayName === "Новий мандрівник" ? "" : input.displayName;
  const manualUsername = input.username === "mistblossom.recruit" ? "" : input.username;
  const fallbackDisplayName = manualDisplayName || live?.displayName || manualUsername || "Новий мандрівник";
  const fallbackUsername = manualUsername || live?.username || "mistblossom.recruit";
  const member: DiscordGuildMemberModerationItem = {
    userId: fallbackId,
    username: fallbackUsername,
    globalName: live?.globalName || fallbackDisplayName,
    displayName: manualDisplayName || live?.displayName || fallbackDisplayName,
    nick: manualDisplayName || live?.nick || fallbackDisplayName,
    avatarUrl: live?.avatarUrl || null,
    defaultAvatarUrl: live?.defaultAvatarUrl || null,
    joinedAt: live?.joinedAt || new Date().toISOString(),
    roleIds: live?.roleIds || [],
  };

  return { member, liveMember: Boolean(live), lookupError };
}
