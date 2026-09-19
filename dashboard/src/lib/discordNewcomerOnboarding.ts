import "server-only";

import { randomUUID } from "node:crypto";

import {
  addGuildMemberRoles,
  buildRulesAcceptCustomId,
  fetchDiscordGuildMemberSnapshot,
  fetchDiscordGuildMembers,
  fetchDiscordGuildSnapshot,
  fetchDiscordRoleControlSnapshotCachedForUi,
  getDiscordGuildId,
  sendDiscordChannelMessageWithAttachment,
  sendDiscordDirectMessage,
  type DiscordGuildMemberModerationItem,
} from "@/lib/discordAdmin";
import { createDiscordWelcomeArtifact } from "@/lib/discordWelcomeArtifact";
import { mapConcurrent } from "@/lib/concurrency";
import { getDiscordWelcomeCardSettings, type DiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";
import { discordGuildChannelUrl } from "@/lib/discordGuildLinks";
import { firebaseWrite } from "@/lib/firebaseAccess";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { getGuildNicknamePolicy, nicknameMatchesTemplate, VALID_NICKNAME_STRUCTURES, type GuildNicknamePolicy } from "@/lib/guildNicknamePolicy";
import { logDashboardEvent, safeErrorMessage } from "@/lib/security";
import { timestampToIso } from "@/lib/values";
import { resolveConfiguredRulesRoleIds } from "@/lib/discordRulesRolePolicy";

const STATE_COLLECTION = "dashboardSettings";
const STATE_DOC_ID = "discordNewcomerOnboardingAutomation";
const MEMBER_COLLECTION = "discordNewcomerOnboardingMembers";
const RETRY_DELAY_MS = 15 * 60_000;
const ONBOARDING_LEASE_TTL_MS = 75_000;
const RECORD_CACHE_TTL_MS = 30 * 60_000;
const DEFAULT_BATCH_LIMIT = 32;
const DEFAULT_CONCURRENCY = 3;

function envInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function onboardingBatchLimit() {
  return envInteger("DISCORD_ONBOARDING_BATCH_LIMIT", DEFAULT_BATCH_LIMIT, 1, 100);
}

function onboardingConcurrency(total: number) {
  return Math.min(Math.max(1, total), envInteger("DISCORD_ONBOARDING_CONCURRENCY", DEFAULT_CONCURRENCY, 1, 6));
}

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
  defaultRoleAssigned: number;
  defaultRoleFailed: number;
  channelSent: number;
  channelFailed: number;
  processed: number;
  durationMs: number;
  concurrency: number;
  recordCacheHits: number;
  recordDbReads: number;
  persistenceFailed: number;
  skippedReason?: "distributed_lease" | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRulesRoleIdsCache: { roleIds: string[]; cachedAt: number } | undefined;
  // eslint-disable-next-line no-var
  var __mistblossomOnboardingRecordCache: { records: Map<string, OnboardingMemberRecord>; refreshedAt: number; version: string | null } | undefined;
}

function cleanNickname(value: unknown) {
  return Array.from(String(value || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, 32).join("");
}

function validTime(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function retryDue(lastErrorAt: string | null, nowMs: number) {
  const failedAt = validTime(lastErrorAt);
  return failedAt === null || nowMs - failedAt >= RETRY_DELAY_MS;
}

function isRejoin(member: DiscordGuildMemberModerationItem, previous?: OnboardingMemberRecord | null) {
  return Boolean(member.joinedAt && previous?.joinedAt && member.joinedAt !== previous.joinedAt);
}

function normalizeRecord(doc: any): OnboardingMemberRecord | null {
  if (!doc || doc.exists === false) return null;
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
  if (!hasFirebaseProfileConfig()) return { initializedAt: null as string | null, recordVersion: null as string | null };
  const snapshot = await getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).get();
  const data = snapshot.exists ? snapshot.data() || {} : {};
  return { initializedAt: timestampToIso(data.initializedAt), recordVersion: typeof data.recordVersion === "string" ? data.recordVersion : null };
}

function onboardingRecordCache() {
  const cache = globalThis.__mistblossomOnboardingRecordCache || {
    records: new Map<string, OnboardingMemberRecord>(),
    refreshedAt: 0,
    version: null,
  };
  globalThis.__mistblossomOnboardingRecordCache = cache;
  return cache;
}

function cacheOnboardingRecord(record: OnboardingMemberRecord) {
  const cache = onboardingRecordCache();
  cache.records.set(record.userId, { ...record });
}

async function loadRecords(memberIds: string[], expectedVersion: string | null) {
  const records = new Map<string, OnboardingMemberRecord>();
  if (!hasFirebaseProfileConfig() || !memberIds.length) return { records, cacheHits: 0, dbReads: 0 };

  const cleanIds = Array.from(new Set(memberIds.filter((value) => /^\d{16,25}$/.test(String(value || "")))));
  const cache = onboardingRecordCache();
  const cacheFresh = Date.now() - cache.refreshedAt < RECORD_CACHE_TTL_MS && cache.version === expectedVersion;
  let cacheHits = 0;
  let dbReads = 0;

  if (cacheFresh) {
    for (const id of cleanIds) {
      const cached = cache.records.get(id);
      if (!cached) continue;
      records.set(id, { ...cached });
      cacheHits += 1;
    }
  }

  const idsToRead = cacheFresh ? cleanIds.filter((id) => !records.has(id)) : cleanIds;
  if (!idsToRead.length) return { records, cacheHits, dbReads };

  const db = getFirebaseAdminDb();
  const refreshed = cacheFresh ? cache.records : new Map<string, OnboardingMemberRecord>();
  for (let index = 0; index < idsToRead.length; index += 250) {
    const ids = idsToRead.slice(index, index + 250);
    const refs = ids.map((id) => db.collection(MEMBER_COLLECTION).doc(id));
    // Deliberately no silent catch here. A failed state read must abort the run;
    // treating an outage as "no records" can mass-message the whole guild.
    const snapshots = await db.getAll(...refs);
    dbReads += snapshots.length;
    for (const doc of snapshots as any[]) {
      const record = normalizeRecord(doc);
      if (!record) continue;
      records.set(record.userId, record);
      refreshed.set(record.userId, { ...record });
    }
  }

  cache.records = refreshed;
  cache.refreshedAt = Date.now();
  cache.version = expectedVersion;
  return { records, cacheHits, dbReads };
}

async function writeRecords(records: OnboardingMemberRecord[]) {
  if (!hasFirebaseProfileConfig() || !records.length) return;
  const db = getFirebaseAdminDb();
  for (const record of records) cacheOnboardingRecord(record);
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

async function writeRecord(record: OnboardingMemberRecord) {
  if (!hasFirebaseProfileConfig()) return;
  // Keep the process-local state optimistic even if the backing write has a
  // transient failure. This prevents an immediate duplicate burst on the next
  // cron tick; the error still propagates and is logged.
  cacheOnboardingRecord(record);
  await firebaseWrite(
    "settings",
    `discord-newcomer-onboarding:member:${record.userId}`,
    () => getFirebaseAdminDb().collection(MEMBER_COLLECTION).doc(record.userId).set(
      { ...record, updatedAt: record.lastSeenAt },
      { merge: true },
    ),
    { timeoutMs: 4_500, logEvent: "discord.newcomer_onboarding.member_write_failed" },
  );
}

async function markInitialized(at: string, memberCount: number, recordVersion: string) {
  if (!hasFirebaseProfileConfig()) return;
  await firebaseWrite(
    "settings",
    "discord-newcomer-onboarding:initialize",
    () => getFirebaseAdminDb().collection(STATE_COLLECTION).doc(STATE_DOC_ID).set({
      initializedAt: at,
      lastScanAt: at,
      lastMemberCount: memberCount,
      recordVersion,
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

async function acquireOnboardingLease(owner: string) {
  if (!hasFirebaseProfileConfig()) return false;
  const db = getFirebaseAdminDb();
  const ref = db.collection(STATE_COLLECTION).doc(STATE_DOC_ID);
  const nowMs = Date.now();
  return db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    const leaseUntilMs = Number(data.leaseUntilMs || 0);
    const leaseOwner = String(data.leaseOwner || "");
    if (Number.isFinite(leaseUntilMs) && leaseUntilMs > nowMs && leaseOwner && leaseOwner !== owner) return false;
    transaction.set(ref, {
      leaseOwner: owner,
      leaseUntilMs: nowMs + ONBOARDING_LEASE_TTL_MS,
      leaseStartedAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
    }, { merge: true });
    return true;
  });
}

async function releaseOnboardingLease(owner: string) {
  if (!hasFirebaseProfileConfig()) return;
  const db = getFirebaseAdminDb();
  const ref = db.collection(STATE_COLLECTION).doc(STATE_DOC_ID);
  await db.runTransaction(async (transaction: any) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() || {} : {};
    if (String(data.leaseOwner || "") !== owner) return;
    transaction.set(ref, {
      leaseOwner: null,
      leaseUntilMs: 0,
      leaseReleasedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  });
}

function nicknameStatus(member: DiscordGuildMemberModerationItem, template: string) {
  const nickname = cleanNickname(member.nick) || null;
  return { nickname, valid: Boolean(nickname && nicknameMatchesTemplate(nickname, template)) };
}

function welcomeDeliveryPermanentlyBlocked(record: OnboardingMemberRecord) {
  return Boolean(record.lastError && /Discord API 403|\b50007\b|cannot send messages to this user/i.test(record.lastError));
}

function privateWelcomeDue(record: OnboardingMemberRecord, nowMs: number) {
  if (record.baseline || record.welcomeSentAt || record.rulesAcceptedAt || welcomeDeliveryPermanentlyBlocked(record)) return false;
  return retryDue(record.lastErrorAt, nowMs);
}

function channelWelcomeEligible(record: OnboardingMemberRecord, settings: DiscordWelcomeCardSettings) {
  if (!settings.enabled || record.baseline) return false;
  const enabledAt = validTime(settings.enabledAt);
  if (enabledAt === null) return true;
  const joinedAt = validTime(record.joinedAt) ?? validTime(record.firstSeenAt);
  return joinedAt === null || joinedAt >= enabledAt;
}

function channelWelcomeDue(record: OnboardingMemberRecord, settings: DiscordWelcomeCardSettings, nowMs: number) {
  if (!channelWelcomeEligible(record, settings) || record.channelWelcomeSentAt || record.channelWelcomeSkippedAt) return false;
  return retryDue(record.channelWelcomeLastErrorAt, nowMs);
}

function defaultRoleAppliesToJoin(record: OnboardingMemberRecord, settings: DiscordWelcomeCardSettings) {
  const roleId = String(settings.defaultRoleId || "").trim();
  if (!roleId || record.baseline) return false;
  if (record.defaultRoleId === roleId && record.defaultRoleLastError) return true;
  const configuredAt = validTime(settings.defaultRoleConfiguredAt) ?? validTime(settings.updatedAt);
  const joinedAt = validTime(record.joinedAt) ?? validTime(record.firstSeenAt);
  return configuredAt === null || joinedAt === null || joinedAt >= configuredAt;
}

function defaultRoleEligible(record: OnboardingMemberRecord, settings: DiscordWelcomeCardSettings, member: DiscordGuildMemberModerationItem) {
  const roleId = String(settings.defaultRoleId || "").trim();
  return Boolean(roleId && defaultRoleAppliesToJoin(record, settings) && !member.roleIds.includes(roleId));
}

function defaultRoleDue(record: OnboardingMemberRecord, settings: DiscordWelcomeCardSettings, member: DiscordGuildMemberModerationItem, nowMs: number, retryDelayMs = RETRY_DELAY_MS) {
  if (!defaultRoleEligible(record, settings, member)) return false;
  if (record.defaultRoleAssignedAt && record.defaultRoleId === settings.defaultRoleId) return false;
  const failedAt = validTime(record.defaultRoleLastErrorAt);
  return failedAt === null || nowMs - failedAt >= retryDelayMs;
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
    components: [{ type: 2, style: 3, label: "Прийняти правила", custom_id: buildRulesAcceptCustomId(roleIds) }],
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

async function sendChannelWelcome(member: DiscordGuildMemberModerationItem, settings: DiscordWelcomeCardSettings) {
  if (!settings.enabled || !settings.channelId) return null;
  const artifact = await createDiscordWelcomeArtifact(member, settings);
  const sent = await sendDiscordChannelMessageWithAttachment({
    channelId: settings.channelId,
    content: artifact.content,
    fileName: artifact.fileName,
    fileBuffer: artifact.buffer,
    contentType: artifact.contentType,
    auditReason: `Welcome card for ${member.displayName}`,
    allowedUserMentions: [member.userId],
  });
  return { ...sent, greeting: artifact.greeting, label: artifact.label, channelId: settings.channelId };
}

function baselineRecord(member: DiscordGuildMemberModerationItem, now: string, settings: DiscordWelcomeCardSettings): OnboardingMemberRecord {
  return {
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
    defaultRoleId: settings.defaultRoleId || null,
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
  };
}

function workingRecord(member: DiscordGuildMemberModerationItem, previous: OnboardingMemberRecord | undefined, now: string, settings: DiscordWelcomeCardSettings) {
  const rejoin = isRejoin(member, previous);
  if (!previous || rejoin) {
    return {
      ...baselineRecord(member, now, settings),
      baseline: false,
      firstSeenAt: previous?.firstSeenAt || now,
      joinedAt: member.joinedAt || now,
    } satisfies OnboardingMemberRecord;
  }
  return {
    ...previous,
    displayName: member.displayName,
    joinedAt: member.joinedAt || previous.joinedAt,
    lastSeenAt: now,
  };
}

export async function runDiscordNewcomerOnboarding(options: {
  priorityUserIds?: string[];
  source?: "cron" | "gateway" | "manual" | "auth_self_heal";
} = {}): Promise<DiscordNewcomerOnboardingResult> {
  if (!hasFirebaseProfileConfig()) throw new Error("Сховище стану onboarding не налаштоване.");

  const startedAt = Date.now();
  const leaseOwner = randomUUID();
  const leaseAcquired = await acquireOnboardingLease(leaseOwner);
  if (!leaseAcquired) {
    return {
      initialized: false,
      checked: 0,
      newcomers: 0,
      sent: 0,
      failed: 0,
      deferred: 0,
      roleIds: [],
      defaultRoleAssigned: 0,
      defaultRoleFailed: 0,
      channelSent: 0,
      channelFailed: 0,
      processed: 0,
      durationMs: Date.now() - startedAt,
      concurrency: 0,
      recordCacheHits: 0,
      recordDbReads: 0,
      persistenceFailed: 0,
      skippedReason: "distributed_lease",
    };
  }

  try {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const priorityUserIds = Array.from(new Set((options.priorityUserIds || [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^\d{16,25}$/.test(value))))
      .slice(0, 25);
    const priorityMode = priorityUserIds.length > 0;
    const defaultRoleRetryDelayMs = priorityMode ? 3_000 : RETRY_DELAY_MS;
    const [state, welcomeCardSettings] = await Promise.all([
      loadState(),
      getDiscordWelcomeCardSettings(),
    ]);

    let members: DiscordGuildMemberModerationItem[];
    if (priorityMode) {
      const resolved = await Promise.allSettled(priorityUserIds.map((userId) => fetchDiscordGuildMemberSnapshot(userId)));
      const unresolved = resolved
        .map((item, index) => ({ item, userId: priorityUserIds[index] }))
        .filter(({ item }) => item.status === "rejected" || !item.value?.joinedAt);
      if (unresolved.length) {
        const details = unresolved.slice(0, 5).map(({ item, userId }) => {
          const reason = item.status === "rejected"
            ? safeErrorMessage(item.reason, "member snapshot failed")
            : "member snapshot has no joined_at";
          return `${userId}: ${reason}`;
        }).join("; ");
        throw new Error(`Priority Discord member snapshot unresolved (${unresolved.length}/${priorityUserIds.length}): ${details}`);
      }
      members = resolved
        .filter((item): item is PromiseFulfilledResult<DiscordGuildMemberModerationItem> => item.status === "fulfilled")
        .map((item) => item.value);
    } else {
      members = await fetchDiscordGuildMembers(0);
    }

    if (!state.initializedAt) {
      if (priorityMode) {
        const allMembers = await fetchDiscordGuildMembers(0);
        const prioritySet = new Set(priorityUserIds);
        const baselineMembers = allMembers.filter((member) => !prioritySet.has(member.userId));
        await writeRecords(baselineMembers.map((member) => baselineRecord(member, now, welcomeCardSettings)));
        await markInitialized(now, allMembers.length, leaseOwner);
        onboardingRecordCache().version = leaseOwner;
        logDashboardEvent("info", "discord.newcomer_onboarding.initialized_from_priority_event", undefined, {
          members: allMembers.length,
          priorityUsers: priorityUserIds,
          source: options.source || "gateway",
        }, { category: "action" });
      } else {
        await writeRecords(members.map((member) => baselineRecord(member, now, welcomeCardSettings)));
        await markInitialized(now, members.length, leaseOwner);
        onboardingRecordCache().version = leaseOwner;
        logDashboardEvent("info", "discord.newcomer_onboarding.initialized", undefined, { members: members.length }, { category: "action" });
        return {
          initialized: true,
          checked: members.length,
          newcomers: 0,
          sent: 0,
          failed: 0,
          deferred: 0,
          roleIds: [],
          defaultRoleAssigned: 0,
          defaultRoleFailed: 0,
          channelSent: 0,
          channelFailed: 0,
          processed: 0,
          durationMs: Date.now() - startedAt,
          concurrency: 0,
          recordCacheHits: 0,
          recordDbReads: 0,
          persistenceFailed: 0,
          skippedReason: null,
        };
      }
    }

    const effectiveState = state.initializedAt ? state : { ...state, initializedAt: now, recordVersion: leaseOwner };
    const loadedRecords = await loadRecords(members.map((member) => member.userId), effectiveState.recordVersion);
    const existing = loadedRecords.records;

    const candidates = members.filter((member) => {
      const previous = existing.get(member.userId);
      if (!previous || isRejoin(member, previous)) return true;
      return privateWelcomeDue(previous, nowMs)
        || defaultRoleDue(previous, welcomeCardSettings, member, nowMs, defaultRoleRetryDelayMs)
        || channelWelcomeDue(previous, welcomeCardSettings, nowMs);
    }).sort((a, b) => {
      const aPrevious = existing.get(a.userId);
      const bPrevious = existing.get(b.userId);
      const aFresh = !aPrevious || isRejoin(a, aPrevious);
      const bFresh = !bPrevious || isRejoin(b, bPrevious);
      if (aFresh !== bFresh) return aFresh ? -1 : 1;
      const aRoleless = a.roleIds.length === 0;
      const bRoleless = b.roleIds.length === 0;
      if (aRoleless !== bRoleless) return aRoleless ? -1 : 1;
      const aJoined = validTime(a.joinedAt) || 0;
      const bJoined = validTime(b.joinedAt) || 0;
      if (aJoined !== bJoined) return bJoined - aJoined;
      return a.userId.localeCompare(b.userId);
    });
    const batchLimit = onboardingBatchLimit();
    const targets = candidates.slice(0, batchLimit);
    const nextRecordVersion = targets.length ? leaseOwner : effectiveState.recordVersion;
    if (targets.length) {
      // Invalidate other process-local caches only when member records can
      // actually change. Quiet cron ticks keep the same generation and avoid
      // forcing a full Firestore reread on another dashboard instance.
      await patchState({ recordVersion: leaseOwner, runStartedAt: now });
      onboardingRecordCache().version = leaseOwner;
    }
    const targetRecords = new Map(
      targets.map((member) => [member.userId, workingRecord(member, existing.get(member.userId), now, welcomeCardSettings)] as const),
    );

    const needsPrivateContext = targets.some((member) => privateWelcomeDue(targetRecords.get(member.userId)!, nowMs));
    const needsNicknameContext = targets.some((member) => !targetRecords.get(member.userId)!.nicknameCheckedAt);
    const needsRoleContext = targets.some((member) => defaultRoleDue(targetRecords.get(member.userId)!, welcomeCardSettings, member, nowMs, defaultRoleRetryDelayMs));

    let policy: GuildNicknamePolicy | null = null;
    let roleIds: string[] = [];
    let guildName = "Mistblossom Vanguard";
    let defaultRoleManageable = true;
    const guildId = getDiscordGuildId();

    if (needsPrivateContext || needsNicknameContext) {
      policy = await getGuildNicknamePolicy();
    }

    if (needsPrivateContext) {
      [roleIds, guildName] = await Promise.all([
        resolveConfiguredRulesRoleIds(policy),
        fetchDiscordGuildSnapshot().then((guild) => guild.name || guildName).catch(() => guildName),
      ]);
    }

    if (needsRoleContext && welcomeCardSettings.defaultRoleId) {
      const control = await fetchDiscordRoleControlSnapshotCachedForUi(120_000);
      defaultRoleManageable = control.manageableRoles.some((role) => role.id === welcomeCardSettings.defaultRoleId);
      if (!defaultRoleManageable) {
        logDashboardEvent("warn", "discord.newcomer_onboarding.default_role_unmanageable", undefined, {
          roleId: welcomeCardSettings.defaultRoleId,
          error: control.error || null,
        }, { category: "action" });
      }
    }

    const concurrency = onboardingConcurrency(targets.length);
    const mapped = await mapConcurrent(
      targets,
      async (member) => {
        const record = targetRecords.get(member.userId)!;
        const result = {
          sent: 0,
          failed: 0,
          defaultRoleAssigned: 0,
          defaultRoleFailed: 0,
          channelSent: 0,
          channelFailed: 0,
          persistenceFailed: 0,
        };

        try {
          // Lifecycle priority: role first. Everything else may depend on access
          // opened by this role, so no DM/image/nickname side effect should run
          // ahead of the access bootstrap.
          const desiredRoleId = String(welcomeCardSettings.defaultRoleId || "").trim();
          if (desiredRoleId && member.roleIds.includes(desiredRoleId) && defaultRoleAppliesToJoin(record, welcomeCardSettings)) {
            record.defaultRoleAssignedAt = record.defaultRoleAssignedAt || now;
            record.defaultRoleId = desiredRoleId;
            record.defaultRoleLastError = null;
            record.defaultRoleLastErrorAt = null;
          } else if (defaultRoleDue(record, welcomeCardSettings, member, nowMs, defaultRoleRetryDelayMs)) {
            if (!defaultRoleManageable || !guildId) {
              result.defaultRoleFailed += 1;
              record.defaultRoleId = desiredRoleId || null;
              record.defaultRoleLastError = !guildId
                ? "Discord guild ID не налаштований."
                : "Стартова роль більше не керована ботом. Перевір ієрархію ролей і Manage Roles.";
              record.defaultRoleLastErrorAt = now;
            } else {
              try {
                await addGuildMemberRoles({
                  guildId,
                  userId: member.userId,
                  roleIds: [desiredRoleId],
                  reason: `Mistblossom newcomer default role for ${member.displayName}`,
                  concurrency: 1,
                  maxConcurrency: 1,
                });
                if (!member.roleIds.includes(desiredRoleId)) member.roleIds.push(desiredRoleId);
                record.defaultRoleAssignedAt = now;
                record.defaultRoleId = desiredRoleId;
                record.defaultRoleLastError = null;
                record.defaultRoleLastErrorAt = null;
                result.defaultRoleAssigned += 1;
                logDashboardEvent("info", "discord.newcomer_onboarding.default_role_assigned", undefined, {
                  userId: member.userId,
                  displayName: member.displayName,
                  roleId: desiredRoleId,
                  source: options.source || (priorityMode ? "gateway" : "cron"),
                }, { category: "action" });
              } catch (error) {
                result.defaultRoleFailed += 1;
                const message = safeErrorMessage(error, "Default newcomer role failed");
                record.defaultRoleId = desiredRoleId || null;
                record.defaultRoleLastError = message;
                record.defaultRoleLastErrorAt = now;
                logDashboardEvent("warn", "discord.newcomer_onboarding.default_role_failed", undefined, {
                  userId: member.userId,
                  displayName: member.displayName,
                  roleId: record.defaultRoleId,
                  source: options.source || (priorityMode ? "gateway" : "cron"),
                  message,
                }, { category: "action" });
              }
            }
          }

          // Initial nickname check is informational and runs once per join. It
          // never gets to block the bootstrap role or public welcome.
          if (!record.nicknameCheckedAt) {
            if (!policy) throw new Error("Політика Discord-ніків недоступна для первинної перевірки.");
            const check = nicknameStatus(member, policy.template);
            record.nicknameCheckedAt = now;
            record.nicknameValid = check.valid;
            record.nicknameAtCheck = check.nickname;
          }

          if (privateWelcomeDue(record, nowMs)) {
            if (!roleIds.length) {
              result.failed += 1;
              record.lastError = "Не знайдено роль для кнопки прийняття правил. Перевір повідомлення правил або newcomer role.";
              record.lastErrorAt = now;
            } else {
              try {
                const privateResult = await sendPrivateWelcome({
                  member,
                  roleIds,
                  guildName,
                  nickname: record.nicknameAtCheck,
                  nicknameValid: Boolean(record.nicknameValid),
                });
                record.welcomeSentAt = now;
                record.welcomeMessageId = privateResult.messageId;
                record.welcomeChannelId = privateResult.channelId;
                record.lastError = null;
                record.lastErrorAt = null;
                result.sent += 1;
                logDashboardEvent("info", "discord.newcomer_onboarding.welcome_sent", undefined, {
                  userId: member.userId,
                  displayName: member.displayName,
                  nickname: record.nicknameAtCheck,
                  nicknameValid: record.nicknameValid,
                  roleIds,
                  source: options.source || (priorityMode ? "gateway" : "cron"),
                }, { category: "action" });
              } catch (error) {
                result.failed += 1;
                const message = safeErrorMessage(error, "Welcome DM failed");
                record.lastError = message;
                record.lastErrorAt = now;
                logDashboardEvent("warn", "discord.newcomer_onboarding.welcome_failed", undefined, {
                  userId: member.userId,
                  displayName: member.displayName,
                  message,
                }, { category: "action" });
              }
            }
          }

          if (!channelWelcomeEligible(record, welcomeCardSettings)) {
            if (!record.channelWelcomeSentAt && !record.channelWelcomeSkippedAt) record.channelWelcomeSkippedAt = now;
          } else if (channelWelcomeDue(record, welcomeCardSettings, nowMs)) {
            try {
              const channelResult = await sendChannelWelcome(member, welcomeCardSettings);
              if (channelResult) {
                record.channelWelcomeSentAt = now;
                record.channelWelcomeMessageId = channelResult.messageId;
                record.channelWelcomeChannelId = channelResult.channelId;
                record.channelWelcomeGreeting = channelResult.greeting;
                record.channelWelcomeLabel = channelResult.label;
                record.channelWelcomeLastError = null;
                record.channelWelcomeLastErrorAt = null;
                result.channelSent += 1;
                logDashboardEvent("info", "discord.newcomer_onboarding.channel_welcome_sent", undefined, {
                  userId: member.userId,
                  displayName: member.displayName,
                  channelId: channelResult.channelId,
                  greeting: channelResult.greeting,
                  label: channelResult.label,
                }, { category: "action" });
              }
            } catch (error) {
              result.channelFailed += 1;
              const message = safeErrorMessage(error, "Welcome channel card failed");
              record.channelWelcomeLastError = message;
              record.channelWelcomeLastErrorAt = now;
              logDashboardEvent("warn", "discord.newcomer_onboarding.channel_welcome_failed", undefined, {
                userId: member.userId,
                displayName: member.displayName,
                message,
              }, { category: "action" });
            }
          }
        } catch (error) {
          result.failed += 1;
          const message = safeErrorMessage(error, "Newcomer processing failed");
          logDashboardEvent("error", "discord.newcomer_onboarding.member_processing_failed", undefined, {
            userId: member.userId,
            displayName: member.displayName,
            message,
          }, { category: "action" });
        }

        try {
          await writeRecord(record);
        } catch (error) {
          result.persistenceFailed += 1;
          logDashboardEvent("error", "discord.newcomer_onboarding.member_persist_failed", undefined, {
            userId: member.userId,
            displayName: member.displayName,
            message: safeErrorMessage(error, "Onboarding state persist failed"),
          }, { category: "action" });
        }
        return result;
      },
      {
        profile: "external-api",
        concurrency,
        min: 1,
        max: 6,
        failFast: false,
      },
    );

    const totals = mapped.results.reduce((acc, item) => {
      if (!item) return acc;
      acc.sent += item.sent;
      acc.failed += item.failed;
      acc.defaultRoleAssigned += item.defaultRoleAssigned;
      acc.defaultRoleFailed += item.defaultRoleFailed;
      acc.channelSent += item.channelSent;
      acc.channelFailed += item.channelFailed;
      acc.persistenceFailed += item.persistenceFailed;
      return acc;
    }, {
      sent: 0,
      failed: 0,
      defaultRoleAssigned: 0,
      defaultRoleFailed: 0,
      channelSent: 0,
      channelFailed: 0,
      persistenceFailed: 0,
    });

    const durationMs = Date.now() - startedAt;
    await patchState({
      lastScanAt: now,
      lastMemberCount: members.length,
      lastNewcomers: candidates.length,
      lastProcessed: targets.length,
      lastDeferred: Math.max(0, candidates.length - targets.length),
      lastSent: totals.sent,
      lastFailed: totals.failed,
      lastDefaultRoleAssigned: totals.defaultRoleAssigned,
      lastDefaultRoleFailed: totals.defaultRoleFailed,
      lastChannelSent: totals.channelSent,
      lastChannelFailed: totals.channelFailed,
      lastPersistenceFailed: totals.persistenceFailed,
      lastDurationMs: durationMs,
      lastConcurrency: concurrency,
      lastRecordCacheHits: loadedRecords.cacheHits,
      lastRecordDbReads: loadedRecords.dbReads,
      recordVersion: nextRecordVersion,
    });
    onboardingRecordCache().version = nextRecordVersion;

    return {
      initialized: false,
      checked: members.length,
      newcomers: candidates.length,
      sent: totals.sent,
      failed: totals.failed,
      deferred: Math.max(0, candidates.length - targets.length),
      roleIds,
      defaultRoleAssigned: totals.defaultRoleAssigned,
      defaultRoleFailed: totals.defaultRoleFailed,
      channelSent: totals.channelSent,
      channelFailed: totals.channelFailed,
      processed: targets.length,
      durationMs,
      concurrency,
      recordCacheHits: loadedRecords.cacheHits,
      recordDbReads: loadedRecords.dbReads,
      persistenceFailed: totals.persistenceFailed,
      skippedReason: null,
    };
  } finally {
    await releaseOnboardingLease(leaseOwner).catch((error) => {
      logDashboardEvent("warn", "discord.newcomer_onboarding.lease_release_failed", undefined, {
        message: safeErrorMessage(error, "Onboarding lease release failed"),
      }, { category: "action" });
    });
  }
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
  const cache = globalThis.__mistblossomOnboardingRecordCache;
  const cached = cache?.records.get(userId);
  if (cached) cache!.records.set(userId, { ...cached, rulesAcceptedAt: now });
}
