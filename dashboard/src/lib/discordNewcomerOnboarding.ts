import "server-only";

import {
  buildRulesAcceptCustomId,
  fetchDiscordGuildMembers,
  fetchDiscordGuildSnapshot,
  listRulesEmbedMessages,
  sendDiscordChannelMessageWithAttachment,
  sendDiscordDirectMessage,
  type DiscordGuildMemberModerationItem,
} from "@/lib/discordAdmin";
import { addDiscordMemberRoles } from "@/lib/discordMemberManagement";
import { renderDiscordWelcomeCard } from "@/lib/discordWelcomeCard";
import { getDiscordWelcomeCardSettings, renderDiscordWelcomeMessageTemplate } from "@/lib/discordWelcomeCardSettings";
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
  defaultRoleAssignedAt: string | null;
  defaultRoleId: string | null;
  defaultRoleLastError: string | null;
  defaultRoleLastErrorAt: string | null;
  channelWelcomeSentAt: string | null;
  channelWelcomeSkippedAt: string | null;
  channelWelcomeMessageId: string | null;
  channelWelcomeChannelId: string | null;
  channelWelcomeGreeting: string | null;
  channelWelcomeLabel: string | null;
  channelWelcomeLastError: string | null;
  channelWelcomeLastErrorAt: string | null;
};

export type DiscordNewcomerOnboardingResult = {
  initialized: boolean;
  checked: number;
  newcomers: number;
  sent: number;
  failed: number;
  deferred: number;
  roleIds: string[];
  channelSent: number;
  channelFailed: number;
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
    defaultRoleAssignedAt: timestampToIso(data.defaultRoleAssignedAt),
    defaultRoleId: data.defaultRoleId ? String(data.defaultRoleId).slice(0, 25) : null,
    defaultRoleLastError: data.defaultRoleLastError ? String(data.defaultRoleLastError).slice(0, 500) : null,
    defaultRoleLastErrorAt: timestampToIso(data.defaultRoleLastErrorAt),
    channelWelcomeSentAt: timestampToIso(data.channelWelcomeSentAt),
    channelWelcomeSkippedAt: timestampToIso(data.channelWelcomeSkippedAt),
    channelWelcomeMessageId: data.channelWelcomeMessageId ? String(data.channelWelcomeMessageId).slice(0, 25) : null,
    channelWelcomeChannelId: data.channelWelcomeChannelId ? String(data.channelWelcomeChannelId).slice(0, 25) : null,
    channelWelcomeGreeting: data.channelWelcomeGreeting ? String(data.channelWelcomeGreeting).slice(0, 120) : null,
    channelWelcomeLabel: data.channelWelcomeLabel ? String(data.channelWelcomeLabel).slice(0, 60) : null,
    channelWelcomeLastError: data.channelWelcomeLastError ? String(data.channelWelcomeLastError).slice(0, 500) : null,
    channelWelcomeLastErrorAt: timestampToIso(data.channelWelcomeLastErrorAt),
  };
}

async function loadState() {
  if (!hasFirebaseProfileConfig()) return { initializedAt: null as string | null };
  const snapshot = await getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).get().catch(() => null);
  const data = snapshot?.exists ? snapshot.data() || {} : {};
  return { initializedAt: timestampToIso(data.initializedAt) };
}

async function loadRecords(memberIds: string[]) {
  const map = new Map<string, OnboardingMemberRecord>();
  if (!hasFirebaseProfileConfig() || !memberIds.length) return map;
  const db = getFirebaseAdminDb();
  const cleanIds = Array.from(new Set(memberIds.filter((value) => /^\d{16,25}$/.test(String(value || "")))));
  for (let index = 0; index < cleanIds.length; index += 250) {
    const refs = cleanIds.slice(index, index + 250).map((id) => db.collection(MEMBER_COLLECTION).doc(id));
    const snapshots = await db.getAll(...refs).catch(() => []);
    for (const doc of snapshots as any[]) {
      const record = normalizeRecord(doc);
      if (record) map.set(record.userId, record);
    }
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

function defaultRoleEligible(record: OnboardingMemberRecord, settings: { defaultRoleId: string }, member: DiscordGuildMemberModerationItem) {
  if (record.baseline) return false;
  const roleId = String(settings.defaultRoleId || "").trim();
  if (!roleId) return false;
  return !member.roleIds.includes(roleId) || record.defaultRoleId !== roleId || !record.defaultRoleAssignedAt;
}

function defaultRoleAttemptDue(record: OnboardingMemberRecord, settings: { defaultRoleId: string }, member: DiscordGuildMemberModerationItem, nowMs = Date.now()) {
  if (!defaultRoleEligible(record, settings, member)) return false;
  const roleId = String(settings.defaultRoleId || "").trim();
  if (!roleId) return false;
  if (record.defaultRoleId && record.defaultRoleId !== roleId) return true;
  const failedAt = record.defaultRoleLastErrorAt ? Date.parse(record.defaultRoleLastErrorAt) : Number.NaN;
  if (Number.isFinite(failedAt) && nowMs - failedAt < 15 * 60_000) return false;
  return true;
}

function channelWelcomeEligible(record: OnboardingMemberRecord, settings: { enabled: boolean; enabledAt?: string | null }) {
  if (!settings.enabled || record.baseline) return false;
  const enabledAt = settings.enabledAt ? Date.parse(settings.enabledAt) : Number.NaN;
  const firstSeenAt = record.firstSeenAt ? Date.parse(record.firstSeenAt) : Number.NaN;
  if (!Number.isFinite(enabledAt) || !Number.isFinite(firstSeenAt)) return true;
  return firstSeenAt >= enabledAt;
}

function failedChannelWelcomeRetryDue(record: OnboardingMemberRecord, settings: { enabled: boolean; enabledAt?: string | null }, nowMs = Date.now()) {
  if (!channelWelcomeEligible(record, settings) || record.channelWelcomeSentAt || record.channelWelcomeSkippedAt) return false;
  const failedAt = record.channelWelcomeLastErrorAt ? Date.parse(record.channelWelcomeLastErrorAt) : Number.NaN;
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

async function sendPrivateWelcome(params: {
  member: DiscordGuildMemberModerationItem;
  roleIds: string[];
  guildName: string;
  nickname: string | null;
  nicknameValid: boolean;
}) {
  const content = buildNewcomerWelcomeMessage({
    guildName: params.guildName,
    displayName: params.member.displayName,
    nickname: params.nickname,
    nicknameValid: params.nicknameValid,
  });
  return sendDiscordDirectMessage({ userId: params.member.userId, content, components: acceptButton(params.roleIds) });
}

async function sendChannelWelcome(member: DiscordGuildMemberModerationItem, settings: Awaited<ReturnType<typeof getDiscordWelcomeCardSettings>>) {
  if (!settings.enabled || !settings.channelId) return null;

  const rendered = await renderDiscordWelcomeCard(member, settings);
  const content = renderDiscordWelcomeMessageTemplate(settings.messageTemplate, {
    mention: `<@${member.userId}>`,
    username: member.username || member.displayName,
    displayName: member.displayName,
    greeting: rendered.greeting,
    label: rendered.label,
  });
  const sent = await sendDiscordChannelMessageWithAttachment({
    channelId: settings.channelId,
    content,
    fileName: rendered.fileName,
    fileBuffer: rendered.buffer,
    contentType: rendered.contentType,
    auditReason: `Welcome card for ${member.displayName}`,
    allowedUserMentions: [member.userId],
  });
  return { ...sent, greeting: rendered.greeting, label: rendered.label, channelId: settings.channelId };
}

export async function runDiscordNewcomerOnboarding(): Promise<DiscordNewcomerOnboardingResult> {
  if (!hasFirebaseProfileConfig()) throw new Error("Сховище стану onboarding не налаштоване.");

  const now = new Date().toISOString();
  const [members, state, guild, policy, welcomeCardSettings] = await Promise.all([
    fetchDiscordGuildMembers(0),
    loadState(),
    fetchDiscordGuildSnapshot(),
    getGuildNicknamePolicy(),
    getDiscordWelcomeCardSettings(),
  ]);
  const existing = await loadRecords(members.map((member) => member.userId));

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
      defaultRoleAssignedAt: null,
      defaultRoleId: welcomeCardSettings.defaultRoleId || null,
      defaultRoleLastError: null,
      defaultRoleLastErrorAt: null,
      channelWelcomeSentAt: null,
      channelWelcomeSkippedAt: null,
      channelWelcomeMessageId: null,
      channelWelcomeChannelId: null,
      channelWelcomeGreeting: null,
      channelWelcomeLabel: null,
      channelWelcomeLastError: null,
      channelWelcomeLastErrorAt: null,
    }));
    await writeRecords(baseline);
    await markInitialized(now, members.length);
    logDashboardEvent("info", "discord.newcomer_onboarding.initialized", undefined, { members: members.length }, { category: "action" });
    return { initialized: true, checked: members.length, newcomers: 0, sent: 0, failed: 0, deferred: 0, roleIds: [], channelSent: 0, channelFailed: 0 };
  }

  const nowMs = Date.now();
  const newcomers = members.filter((member) => {
    const previous = existing.get(member.userId);
    if (!previous) return true;
    const privateRetry = failedWelcomeRetryDue(previous, nowMs);
    const defaultRoleRetry = defaultRoleAttemptDue(previous, welcomeCardSettings, member, nowMs);
    const channelRetry = failedChannelWelcomeRetryDue(previous, welcomeCardSettings, nowMs);
    if (privateRetry || defaultRoleRetry || channelRetry) return true;
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
  let channelSent = 0;
  let channelFailed = 0;

  for (const member of targets) {
    const previous = existing.get(member.userId);
    const check = nicknameStatus(member, policy.template);
    const record: OnboardingMemberRecord = {
      userId: member.userId,
      joinedAt: member.joinedAt || previous?.joinedAt || null,
      displayName: member.displayName,
      firstSeenAt: previous?.firstSeenAt || now,
      lastSeenAt: now,
      baseline: false,
      welcomeSentAt: previous?.welcomeSentAt || null,
      welcomeMessageId: previous?.welcomeMessageId || null,
      welcomeChannelId: previous?.welcomeChannelId || null,
      nicknameCheckedAt: now,
      nicknameValid: check.valid,
      nicknameAtCheck: check.nickname,
      rulesAcceptedAt: previous?.rulesAcceptedAt || null,
      lastError: previous?.lastError || null,
      lastErrorAt: previous?.lastErrorAt || null,
      defaultRoleAssignedAt: previous?.defaultRoleAssignedAt || null,
      defaultRoleId: previous?.defaultRoleId || welcomeCardSettings.defaultRoleId || null,
      defaultRoleLastError: previous?.defaultRoleLastError || null,
      defaultRoleLastErrorAt: previous?.defaultRoleLastErrorAt || null,
      channelWelcomeSentAt: previous?.channelWelcomeSentAt || null,
      channelWelcomeSkippedAt: previous?.channelWelcomeSkippedAt || null,
      channelWelcomeMessageId: previous?.channelWelcomeMessageId || null,
      channelWelcomeChannelId: previous?.channelWelcomeChannelId || null,
      channelWelcomeGreeting: previous?.channelWelcomeGreeting || null,
      channelWelcomeLabel: previous?.channelWelcomeLabel || null,
      channelWelcomeLastError: previous?.channelWelcomeLastError || null,
      channelWelcomeLastErrorAt: previous?.channelWelcomeLastErrorAt || null,
    };

    try {
      if (!record.welcomeSentAt || failedWelcomeRetryDue(record, nowMs)) {
        const result = await sendPrivateWelcome({
          member,
          roleIds,
          guildName: guild.name || "Mistblossom Vanguard",
          nickname: check.nickname,
          nicknameValid: check.valid,
        });
        record.welcomeSentAt = now;
        record.welcomeMessageId = result.messageId;
        record.welcomeChannelId = result.channelId;
        record.lastError = null;
        record.lastErrorAt = null;
        sentCount += 1;
        logDashboardEvent("info", "discord.newcomer_onboarding.welcome_sent", undefined, {
          userId: member.userId,
          displayName: member.displayName,
          nickname: check.nickname,
          nicknameValid: check.valid,
          roleIds,
        }, { category: "action" });
      }
    } catch (error) {
      failed += 1;
      const message = safeErrorMessage(error, "Welcome DM failed");
      record.lastError = message;
      record.lastErrorAt = now;
      logDashboardEvent("warn", "discord.newcomer_onboarding.welcome_failed", undefined, {
        userId: member.userId,
        displayName: member.displayName,
        message,
      }, { category: "action" });
    }

    try {
      const desiredRoleId = String(welcomeCardSettings.defaultRoleId || "").trim();
      if (desiredRoleId) {
        if (member.roleIds.includes(desiredRoleId)) {
          record.defaultRoleAssignedAt = record.defaultRoleAssignedAt || now;
          record.defaultRoleId = desiredRoleId;
          record.defaultRoleLastError = null;
          record.defaultRoleLastErrorAt = null;
        } else if (defaultRoleAttemptDue(record, welcomeCardSettings, member, nowMs)) {
          const roleResult = await addDiscordMemberRoles({
            userId: member.userId,
            roleIds: [desiredRoleId],
            reason: `Mistblossom newcomer default role for ${member.displayName}`,
          });
          record.defaultRoleAssignedAt = now;
          record.defaultRoleId = desiredRoleId;
          record.defaultRoleLastError = null;
          record.defaultRoleLastErrorAt = null;
          logDashboardEvent("info", "discord.newcomer_onboarding.default_role_assigned", undefined, {
            userId: member.userId,
            displayName: member.displayName,
            roleId: desiredRoleId,
            changed: roleResult.changed,
          }, { category: "action" });
        }
      }
    } catch (error) {
      const message = safeErrorMessage(error, "Default newcomer role failed");
      record.defaultRoleId = String(welcomeCardSettings.defaultRoleId || "").trim() || null;
      record.defaultRoleLastError = message;
      record.defaultRoleLastErrorAt = now;
      logDashboardEvent("warn", "discord.newcomer_onboarding.default_role_failed", undefined, {
        userId: member.userId,
        displayName: member.displayName,
        roleId: record.defaultRoleId,
        message,
      }, { category: "action" });
    }

    try {
      if (!channelWelcomeEligible(record, welcomeCardSettings)) {
        if (!record.channelWelcomeSentAt && !record.channelWelcomeSkippedAt) record.channelWelcomeSkippedAt = now;
      } else if (failedChannelWelcomeRetryDue(record, welcomeCardSettings, nowMs)) {
        const channelResult = await sendChannelWelcome(member, welcomeCardSettings);
        if (channelResult) {
          record.channelWelcomeSentAt = now;
          record.channelWelcomeMessageId = channelResult.messageId;
          record.channelWelcomeChannelId = channelResult.channelId;
          record.channelWelcomeGreeting = channelResult.greeting;
          record.channelWelcomeLabel = channelResult.label;
          record.channelWelcomeLastError = null;
          record.channelWelcomeLastErrorAt = null;
          channelSent += 1;
          logDashboardEvent("info", "discord.newcomer_onboarding.channel_welcome_sent", undefined, {
            userId: member.userId,
            displayName: member.displayName,
            channelId: channelResult.channelId,
            greeting: channelResult.greeting,
            label: channelResult.label,
          }, { category: "action" });
        }
      }
    } catch (error) {
      channelFailed += 1;
      const message = safeErrorMessage(error, "Welcome channel card failed");
      record.channelWelcomeLastError = message;
      record.channelWelcomeLastErrorAt = now;
      logDashboardEvent("warn", "discord.newcomer_onboarding.channel_welcome_failed", undefined, {
        userId: member.userId,
        displayName: member.displayName,
        message,
      }, { category: "action" });
    }

    updates.push(record);
  }

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
    lastChannelSent: channelSent,
    lastChannelFailed: channelFailed,
  });

  return {
    initialized: false,
    checked: members.length,
    newcomers: newcomers.length,
    sent: sentCount,
    failed,
    deferred: Math.max(0, newcomers.length - targets.length),
    roleIds,
    channelSent,
    channelFailed,
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
