import "server-only";

import {
  buildRulesAcceptCustomId,
  fetchDiscordGuildMembers,
  fetchDiscordGuildSnapshot,
  listRulesEmbedMessages,
  sendDiscordDirectMessage,
  type DiscordGuildMemberModerationItem,
} from "@/lib/discordAdmin";
import { MISTBLOSSOM_DISCORD_CHANNELS, discordGuildChannelUrl } from "@/lib/discordGuildLinks";
import { firebaseWrite } from "@/lib/firebaseAccess";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { getGuildNicknamePolicy, nicknameMatchesTemplate, VALID_NICKNAME_STRUCTURES } from "@/lib/guildNicknamePolicy";
import { logDashboardEvent, safeErrorMessage } from "@/lib/security";
import { timestampToIso } from "@/lib/values";

const STATE_COLLECTION = "dashboardSettings";
const STATE_DOC_ID = "discordNewcomerOnboardingAutomation";
const MEMBER_COLLECTION = "discordNewcomerOnboardingMembers";
const RULES_CHANNEL_ID = String(process.env.DISCORD_GUILD_RULES_CHANNEL_ID || MISTBLOSSOM_DISCORD_CHANNELS.rules.id).trim();
const MAX_SENDS_PER_RUN = 25;

type OnboardingMemberRecord = {
  userId: string;
  joinedAt: string | null;
  displayName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  baseline: boolean;
  welcomeSentAt: string | null;
  welcomeMessageId: string | null;
  welcomeChannelId: string | null;
  nicknameCheckedAt: string | null;
  nicknameValid: boolean | null;
  nicknameAtCheck: string | null;
  rulesAcceptedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export type DiscordNewcomerOnboardingResult = {
  initialized: boolean;
  checked: number;
  newcomers: number;
  sent: number;
  failed: number;
  deferred: number;
  roleIds: string[];
};

function cleanNickname(value: unknown) {
  return Array.from(String(value || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 32).join("");
}

function normalizeRecord(doc: any): OnboardingMemberRecord | null {
  const data = doc?.data?.() || {};
  const userId = String(data.userId || doc?.id || "").trim();
  if (!/^\d{16,25}$/.test(userId)) return null;
  return {
    userId,
    joinedAt: timestampToIso(data.joinedAt),
    displayName: String(data.displayName || `Discord ${userId.slice(-6)}`).slice(0, 120),
    firstSeenAt: timestampToIso(data.firstSeenAt) || new Date(0).toISOString(),
    lastSeenAt: timestampToIso(data.lastSeenAt) || new Date(0).toISOString(),
    baseline: Boolean(data.baseline),
    welcomeSentAt: timestampToIso(data.welcomeSentAt),
    welcomeMessageId: data.welcomeMessageId ? String(data.welcomeMessageId).slice(0, 25) : null,
    welcomeChannelId: data.welcomeChannelId ? String(data.welcomeChannelId).slice(0, 25) : null,
    nicknameCheckedAt: timestampToIso(data.nicknameCheckedAt),
    nicknameValid: typeof data.nicknameValid === "boolean" ? data.nicknameValid : null,
    nicknameAtCheck: data.nicknameAtCheck === null || data.nicknameAtCheck === undefined ? null : cleanNickname(data.nicknameAtCheck) || null,
    rulesAcceptedAt: timestampToIso(data.rulesAcceptedAt),
    lastError: data.lastError ? String(data.lastError).slice(0, 500) : null,
    lastErrorAt: timestampToIso(data.lastErrorAt),
  };
}

async function loadState() {
  if (!hasFirebaseProfileConfig()) return { initializedAt: null as string | null };
  const snapshot = await getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).get().catch(() => null);
  const data = snapshot?.exists ? snapshot.data() || {} : {};
  return { initializedAt: timestampToIso(data.initializedAt) };
}

async function loadRecords() {
  const map = new Map<string, OnboardingMemberRecord>();
  if (!hasFirebaseProfileConfig()) return map;
  const snapshot = await getFirebaseAdminDb().collection(MEMBER_COLLECTION).limit(5000).get().catch(() => null);
  for (const doc of snapshot?.docs || []) {
    const record = normalizeRecord(doc);
    if (record) map.set(record.userId, record);
  }
  return map;
}

async function writeRecords(records: OnboardingMemberRecord[]) {
  if (!hasFirebaseProfileConfig() || !records.length) return;
  const db = getFirebaseAdminDb();
  await firebaseWrite(
    "settings",
    "discord-newcomer-onboarding:members",
    async () => {
      for (let index = 0; index < records.length; index += 400) {
        const batch = db.batch();
        for (const record of records.slice(index, index + 400)) {
          batch.set(db.collection(MEMBER_COLLECTION).doc(record.userId), { ...record, updatedAt: record.lastSeenAt }, { merge: true });
        }
        await batch.commit();
      }
    },
    { timeoutMs: 12_000, logEvent: "discord.newcomer_onboarding.member_write_failed" },
  );
}

async function markInitialized(at: string, memberCount: number) {
  if (!hasFirebaseProfileConfig()) return;
  await firebaseWrite(
    "settings",
    "discord-newcomer-onboarding:initialize",
    () => getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).set({
      initializedAt: at,
      lastScanAt: at,
      lastMemberCount: memberCount,
      updatedAt: at,
    }, { merge: true }),
    { timeoutMs: 4_000, logEvent: "discord.newcomer_onboarding.state_write_failed" },
  );
}

async function patchState(patch: Record<string, unknown>) {
  if (!hasFirebaseProfileConfig()) return;
  const now = new Date().toISOString();
  await firebaseWrite(
    "settings",
    "discord-newcomer-onboarding:state",
    () => getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).set({ ...patch, updatedAt: now }, { merge: true }),
    { timeoutMs: 4_000, logEvent: "discord.newcomer_onboarding.state_write_failed" },
  );
}

async function resolveRulesRoleIds() {
  const messages = await listRulesEmbedMessages(RULES_CHANNEL_ID, 50).catch(() => []);
  const rulesMessage = messages.find((message) => message.rulesType === "guild" && message.roleIds.length > 0);
  if (rulesMessage?.roleIds.length) return rulesMessage.roleIds;

  // Fallback preserves the existing newcomer-role contract when the public
  // rules message is temporarily unavailable from Discord REST.
  const policy = await getGuildNicknamePolicy({ bypassCache: true });
  if (policy.nicknameNewcomerRoleId) return [policy.nicknameNewcomerRoleId];
  return [];
}

function nicknameStatus(member: DiscordGuildMemberModerationItem, template: string) {
  const nickname = cleanNickname(member.nick) || null;
  return {
    nickname,
    valid: Boolean(nickname && nicknameMatchesTemplate(nickname, template)),
  };
}

function welcomeDeliveryPermanentlyBlocked(record: OnboardingMemberRecord) {
  return Boolean(record.lastError && /Discord API 403|\b50007\b|cannot send messages to this user/i.test(record.lastError));
}

function failedWelcomeRetryDue(record: OnboardingMemberRecord, nowMs = Date.now()) {
  if (record.baseline || record.welcomeSentAt || record.rulesAcceptedAt || welcomeDeliveryPermanentlyBlocked(record)) return false;
  const failedAt = record.lastErrorAt ? Date.parse(record.lastErrorAt) : Number.NaN;
  return !Number.isFinite(failedAt) || nowMs - failedAt >= 15 * 60_000;
}

export function buildNewcomerWelcomeMessage(input: {
  guildName: string;
  displayName: string;
  nickname: string | null;
  nicknameValid: boolean;
}) {
  const safeGuild = String(input.guildName || "Mistblossom Vanguard").replace(/[*_~`|]/g, "").trim() || "Mistblossom Vanguard";
  const safeName = String(input.displayName || "мандрівнику").replace(/[*_~`|]/g, "").trim() || "мандрівнику";
  const nicknameLine = input.nicknameValid
    ? `✅ Твій серверний нік уже відповідає формату: \`${String(input.nickname).replace(/`/g, "ˋ")}\`.`
    : `⚠️ Твій серверний нік ${input.nickname ? `\`${String(input.nickname).replace(/`/g, "ˋ")}\`` : "ще не встановлено"} не відповідає формату гільдії.`;

  const formats = VALID_NICKNAME_STRUCTURES.map((item) => `• \`${item.replace(/\{name\}/g, "Імʼя").replace(/\{main\}/g, "Мейн").replace(/\{alt\}/g, "Альт")}\``).join("\n");

  return [
    `👋 **Вітаємо, ${safeName}, у ${safeGuild}!**`,
    "",
    "Перед повним доступом до гільдійних каналів потрібно ознайомитися з правилами та підтвердити їх кнопкою нижче.",
    "",
    "### Серверний нік — первинна перевірка",
    nicknameLine,
    "Допустимі структури:",
    formats,
    "",
    "**Як змінити нік:** відкрий свій профіль на сервері Discord → **Редагувати профіль сервера / Edit Server Profile** → зміни **серверний нік**. Якщо користуєшся телефоном — натисни на свій профіль у сервері й відкрий редагування профілю сервера.",
    "",
    "Ця первинна перевірка виконується **один раз після вступу**. Після прийняття правил тебе підхопить чинна система гільдії: ролі, профіль і подальші перевірки ніку працюватимуть за вже налаштованими правилами.",
    "",
    `📜 **Правила:** ${discordGuildChannelUrl(MISTBLOSSOM_DISCORD_CHANNELS.rules.id)}`,
    `📣 **Оголошення:** ${discordGuildChannelUrl(MISTBLOSSOM_DISCORD_CHANNELS.announcements.id)}`,
    `🐉 **Рейди:** ${discordGuildChannelUrl(MISTBLOSSOM_DISCORD_CHANNELS.raids.id)}`,
    `💬 **Основний чат після прийняття правил:** ${discordGuildChannelUrl(MISTBLOSSOM_DISCORD_CHANNELS.general.id)}`,
    "",
    "Натисни **«Прийняти правила»** нижче, щоб завершити вступ.",
  ].join("\n").slice(0, 1900);
}

function acceptButton(roleIds: string[]) {
  return [{
    type: 1,
    components: [{
      type: 2,
      style: 3,
      label: "Прийняти правила",
      custom_id: buildRulesAcceptCustomId(roleIds),
    }],
  }];
}

async function sendWelcome(member: DiscordGuildMemberModerationItem, roleIds: string[], guildName: string) {
  const policy = await getGuildNicknamePolicy();
  const check = nicknameStatus(member, policy.template);
  const content = buildNewcomerWelcomeMessage({
    guildName,
    displayName: member.displayName,
    nickname: check.nickname,
    nicknameValid: check.valid,
  });
  const sent = await sendDiscordDirectMessage({ userId: member.userId, content, components: acceptButton(roleIds) });
  return { ...sent, ...check };
}

export async function runDiscordNewcomerOnboarding(): Promise<DiscordNewcomerOnboardingResult> {
  if (!hasFirebaseProfileConfig()) throw new Error("Сховище стану onboarding не налаштоване.");

  const now = new Date().toISOString();
  const [members, state, existing, guild] = await Promise.all([
    fetchDiscordGuildMembers(0),
    loadState(),
    loadRecords(),
    fetchDiscordGuildSnapshot(),
  ]);

  if (!state.initializedAt) {
    const baseline = members.map((member): OnboardingMemberRecord => ({
      userId: member.userId,
      joinedAt: member.joinedAt || null,
      displayName: member.displayName,
      firstSeenAt: now,
      lastSeenAt: now,
      baseline: true,
      welcomeSentAt: null,
      welcomeMessageId: null,
      welcomeChannelId: null,
      nicknameCheckedAt: null,
      nicknameValid: null,
      nicknameAtCheck: null,
      rulesAcceptedAt: null,
      lastError: null,
      lastErrorAt: null,
    }));
    await writeRecords(baseline);
    await markInitialized(now, members.length);
    logDashboardEvent("info", "discord.newcomer_onboarding.initialized", undefined, { members: members.length }, { category: "action" });
    return { initialized: true, checked: members.length, newcomers: 0, sent: 0, failed: 0, deferred: 0, roleIds: [] };
  }

  const nowMs = Date.now();
  const newcomers = members.filter((member) => {
    const previous = existing.get(member.userId);
    if (!previous) return true;
    if (failedWelcomeRetryDue(previous, nowMs)) return true;
    const currentJoinedAt = member.joinedAt || null;
    return Boolean(currentJoinedAt && previous.joinedAt && currentJoinedAt !== previous.joinedAt);
  });
  const roleIds = newcomers.length ? await resolveRulesRoleIds() : [];
  if (newcomers.length && !roleIds.length) {
    throw new Error("Не знайдено роль, яка має видаватися після прийняття правил. Перевір повідомлення правил або newcomer role у Discord-налаштуваннях.");
  }

  const targets = newcomers.slice(0, MAX_SENDS_PER_RUN);
  const updates: OnboardingMemberRecord[] = [];
  let sentCount = 0;
  let failed = 0;

  for (const member of targets) {
    const previous = existing.get(member.userId);
    try {
      const result = await sendWelcome(member, roleIds, guild.name || "Mistblossom Vanguard");
      updates.push({
        userId: member.userId,
        joinedAt: member.joinedAt || null,
        displayName: member.displayName,
        firstSeenAt: previous?.firstSeenAt || now,
        lastSeenAt: now,
        baseline: false,
        welcomeSentAt: now,
        welcomeMessageId: result.messageId,
        welcomeChannelId: result.channelId,
        nicknameCheckedAt: now,
        nicknameValid: result.valid,
        nicknameAtCheck: result.nickname,
        rulesAcceptedAt: null,
        lastError: null,
        lastErrorAt: null,
      });
      sentCount += 1;
      logDashboardEvent("info", "discord.newcomer_onboarding.welcome_sent", undefined, {
        userId: member.userId,
        displayName: member.displayName,
        nickname: result.nickname,
        nicknameValid: result.valid,
        roleIds,
      }, { category: "action" });
    } catch (error) {
      failed += 1;
      const message = safeErrorMessage(error, "Welcome DM failed");
      updates.push({
        userId: member.userId,
        joinedAt: member.joinedAt || null,
        displayName: member.displayName,
        firstSeenAt: previous?.firstSeenAt || now,
        lastSeenAt: now,
        baseline: false,
        welcomeSentAt: null,
        welcomeMessageId: null,
        welcomeChannelId: null,
        nicknameCheckedAt: null,
        nicknameValid: null,
        nicknameAtCheck: null,
        rulesAcceptedAt: null,
        lastError: message,
        lastErrorAt: now,
      });
      logDashboardEvent("warn", "discord.newcomer_onboarding.welcome_failed", undefined, {
        userId: member.userId,
        displayName: member.displayName,
        message,
      }, { category: "action" });
    }
  }

  // Existing members are touched only to keep joinedAt/displayName current. We do
  // not re-check their nickname here: that belongs to the established scheduler.
  const currentIds = new Set(updates.map((record) => record.userId));
  for (const member of members) {
    if (currentIds.has(member.userId)) continue;
    const previous = existing.get(member.userId);
    if (!previous) continue;
    updates.push({ ...previous, displayName: member.displayName, joinedAt: member.joinedAt || previous.joinedAt, lastSeenAt: now });
  }

  await writeRecords(updates);
  await patchState({
    lastScanAt: now,
    lastMemberCount: members.length,
    lastNewcomers: newcomers.length,
    lastSent: sentCount,
    lastFailed: failed,
  });

  return {
    initialized: false,
    checked: members.length,
    newcomers: newcomers.length,
    sent: sentCount,
    failed,
    deferred: Math.max(0, newcomers.length - targets.length),
    roleIds,
  };
}

export async function markDiscordNewcomerRulesAccepted(userIdInput: string) {
  const userId = String(userIdInput || "").trim();
  if (!hasFirebaseProfileConfig() || !/^\d{16,25}$/.test(userId)) return;
  const now = new Date().toISOString();
  await firebaseWrite(
    "rules",
    `discord-newcomer-onboarding:accepted:${userId}`,
    () => getFirebaseAdminDb().collection(MEMBER_COLLECTION).doc(userId).set({
      userId,
      rulesAcceptedAt: now,
      updatedAt: now,
    }, { merge: true }),
    { timeoutMs: 3_500, logEvent: "discord.newcomer_onboarding.accept_write_failed" },
  );
}
