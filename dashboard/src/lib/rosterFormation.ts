import { randomUUID } from "crypto";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import type { DashboardSession } from "@/lib/auth";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { firebaseRead, firebaseUnavailableMessage, firebaseWrite } from "@/lib/firebaseAccess";
import { clearRuntimeCachedValue, clearRuntimeCachedValuesByPrefix } from "@/lib/runtimeResilience";
import {
  createDiscordRaidMessage,
  deleteDiscordRaidMessage,
  discordMessageUrl,
  editDiscordRaidMessage,
  getDiscordDefaultChannelId,
  normalizeDiscordEmbed,
} from "@/lib/discordAdmin";
import type { WowCharacterRole } from "@/lib/wowRoles";
import {
  WOW_CLASS_CATALOG,
  findWowClass,
  findWowSpec,
  roleEmoji,
  roleLabelShort,
  wowClassColorInt,
  wowClassCount,
} from "@/lib/wowClassCatalog";

/* ==========================================================================
   Система «Формування складу».

   Побудована на тій самій інфраструктурі, що й рейд-пули (Firebase +
   Discord embed + інтеракції), але без ітем-левелу та привʼязки до
   dashboard-профілю: учасник обирає клас і спеку прямо в Discord, а система
   фіксує його серверний нік. Мета — зібрати 20 гравців так, щоб був
   представлений щонайменше 1 гравець кожного класу.
   ========================================================================== */

export const ROSTER_TARGET_SIZE = 20;
export const ROSTER_SEASONS = [1, 2, 3, 4] as const;
export type RosterSeason = (typeof ROSTER_SEASONS)[number];

export const ROSTER_TITLE_PREFIX = "Формування складу -";

const ROSTER_COLLECTION = "dashboardRosterFormations";
const ROSTER_ACTION_PREFIX = "mbv1:roster";
const ROSTER_LIST_CACHE_KEY = "roster-formations:list:v1";
const ROSTER_GET_CACHE_PREFIX = "roster-formation:";
const ROSTER_LIST_TTL_MS = 60_000;
const ROSTER_GET_TTL_MS = 60_000;

export type RosterMemberPick = {
  discordUserId: string;
  /** Серверний нік учасника Discord на момент вибору. */
  discordName: string;
  classKey: string;
  className: string;
  specKey: string;
  specName: string;
  role: WowCharacterRole;
  createdAt: string;
  updatedAt: string;
};

export type RosterFormation = {
  id: string;
  season: RosterSeason;
  /** Повний заголовок ембеду: "Формування складу - Сезон N". */
  title: string;
  description: string;
  channelId: string;
  messageId: string;
  messageUrl: string;
  mentionRoleIds: string[];
  /** Discord-автор оголошення (адмін, що опублікував). */
  authorId: string;
  authorName: string;
  status: "open" | "closed";
  picks: RosterMemberPick[];
  createdAt: string;
  updatedAt: string;
};

export type RosterCreateInput = {
  season?: unknown;
  description?: unknown;
  channelId?: unknown;
  mentionRoleIds?: unknown;
};

export function hasRosterStorage() {
  return hasFirebaseProfileConfig();
}

export function rosterSeasonLabel(season: RosterSeason) {
  return `Сезон ${season}`;
}

export function rosterFullTitle(season: RosterSeason) {
  return `${ROSTER_TITLE_PREFIX} ${rosterSeasonLabel(season)}`;
}

/* ----------------------------------------------------------------------------
   Валідатори / нормалізація
   -------------------------------------------------------------------------- */

function cleanSeason(value: unknown): RosterSeason {
  const num = Math.trunc(Number(value));
  return (ROSTER_SEASONS as readonly number[]).includes(num) ? (num as RosterSeason) : 1;
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanSnowflake(value: unknown) {
  const raw = String(value ?? "").trim();
  return /^\d{16,25}$/.test(raw) ? raw : "";
}

function cleanSnowflakeIds(values: unknown) {
  const list = Array.isArray(values) ? values : values == null ? [] : [values];
  return Array.from(new Set(list.map((item) => cleanSnowflake(item)).filter(Boolean))).slice(0, 20);
}

function newRosterId() {
  return `rf_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function rosterRef(rosterId: string) {
  return getFirebaseAdminDb().collection(ROSTER_COLLECTION).doc(rosterId);
}

function normalizePick(raw: unknown): RosterMemberPick | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const discordUserId = cleanSnowflake(data.discordUserId);
  const resolved = findWowSpec(data.classKey, data.specKey);
  if (!discordUserId || !resolved) return null;
  const createdAt = typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString();
  return {
    discordUserId,
    discordName: cleanText(data.discordName, 80) || "Учасник Discord",
    classKey: resolved.cls.key,
    className: resolved.cls.label,
    specKey: resolved.spec.key,
    specName: resolved.spec.label,
    role: resolved.spec.role,
    createdAt,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : createdAt,
  };
}

export function normalizeRosterFormation(id: string, data: Record<string, unknown>): RosterFormation {
  const season = cleanSeason(data.season);
  const picks = Array.isArray(data.picks)
    ? data.picks.map(normalizePick).filter((pick): pick is RosterMemberPick => Boolean(pick))
    : [];
  const createdAt = typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString();
  return {
    id,
    season,
    title: cleanText(data.title, 160) || rosterFullTitle(season),
    description: cleanText(data.description, 1500),
    channelId: cleanSnowflake(data.channelId),
    messageId: cleanSnowflake(data.messageId),
    messageUrl: typeof data.messageUrl === "string" ? data.messageUrl : "",
    mentionRoleIds: cleanSnowflakeIds(data.mentionRoleIds),
    authorId: cleanSnowflake(data.authorId),
    authorName: cleanText(data.authorName, 80),
    status: data.status === "closed" ? "closed" : "open",
    picks,
    createdAt,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : createdAt,
  };
}

/* ----------------------------------------------------------------------------
   Читання
   -------------------------------------------------------------------------- */

export async function listRosterFormations(limit = 60): Promise<RosterFormation[]> {
  if (!hasRosterStorage()) return [];
  return firebaseRead<RosterFormation[]>(
    "raid",
    ROSTER_LIST_CACHE_KEY,
    async () => {
      const snap = await getFirebaseAdminDb()
        .collection(ROSTER_COLLECTION)
        .orderBy("createdAt", "desc")
        .limit(Math.max(1, Math.min(limit, 120)))
        .get();
      return snap.docs.map((doc) => normalizeRosterFormation(doc.id, doc.data() || {}));
    },
    { ttlMs: ROSTER_LIST_TTL_MS, fallback: () => [], logEvent: "roster.list_failed" },
  );
}

export async function getRosterFormation(rosterId: string): Promise<RosterFormation | null> {
  if (!hasRosterStorage()) return null;
  const id = String(rosterId || "").trim();
  if (!id) return null;
  return firebaseRead<RosterFormation | null>(
    "raid",
    `${ROSTER_GET_CACHE_PREFIX}${id}`,
    async () => {
      const snap = await rosterRef(id).get();
      return snap.exists ? normalizeRosterFormation(snap.id, snap.data() || {}) : null;
    },
    { ttlMs: ROSTER_GET_TTL_MS, fallback: () => null, logEvent: "roster.get_failed" },
  );
}

function clearRosterCaches(rosterId?: string | null) {
  clearRuntimeCachedValue(ROSTER_LIST_CACHE_KEY);
  clearRuntimeCachedValuesByPrefix(ROSTER_GET_CACHE_PREFIX);
  if (rosterId) clearRuntimeCachedValue(`${ROSTER_GET_CACHE_PREFIX}${rosterId}`);
}

/* ----------------------------------------------------------------------------
   Coverage — покриття класів (таблиця вільних ролей)
   -------------------------------------------------------------------------- */

export type RosterCoverageRow = {
  classKey: string;
  className: string;
  emoji: string;
  color: string;
  count: number;
  members: RosterMemberPick[];
};

export function rosterClassCoverage(roster: RosterFormation): RosterCoverageRow[] {
  return WOW_CLASS_CATALOG.map((cls) => {
    const members = roster.picks.filter((pick) => pick.classKey === cls.key);
    return {
      classKey: cls.key,
      className: cls.label,
      emoji: cls.emoji,
      color: cls.color,
      count: members.length,
      members,
    };
  });
}

export function rosterCoveredClassCount(roster: RosterFormation) {
  return rosterClassCoverage(roster).filter((row) => row.count > 0).length;
}

export function rosterRoleCounts(roster: RosterFormation) {
  return roster.picks.reduce(
    (acc, pick) => {
      acc[pick.role] += 1;
      return acc;
    },
    { tank: 0, healer: 0, dps: 0 } as Record<WowCharacterRole, number>,
  );
}

/* ----------------------------------------------------------------------------
   Custom ID кодування для Discord-інтеракцій
   -------------------------------------------------------------------------- */

export type RosterDiscordKind = "pick" | "class" | "spec" | "leave";

export function buildRosterPickCustomId(rosterId: string) {
  return `${ROSTER_ACTION_PREFIX}_pick:${rosterId}`;
}
export function buildRosterClassSelectCustomId(rosterId: string) {
  return `${ROSTER_ACTION_PREFIX}_class:${rosterId}`;
}
export function buildRosterSpecSelectCustomId(rosterId: string, classKey: string) {
  return `${ROSTER_ACTION_PREFIX}_spec:${rosterId}:${classKey}`;
}
export function buildRosterLeaveCustomId(rosterId: string) {
  return `${ROSTER_ACTION_PREFIX}_leave:${rosterId}`;
}

export function decodeRosterCustomId(
  customId: string,
  values: unknown,
): { rosterId: string; kind: RosterDiscordKind; classKey?: string; values: string[] } | null {
  const value = String(customId || "").trim();
  const match = value.match(/^mbv1:roster_(pick|class|spec|leave):([A-Za-z0-9_-]{6,40})(?::([a-z0-9_]{2,20}))?$/);
  if (!match) return null;
  const kind = match[1] as RosterDiscordKind;
  const selected = Array.isArray(values)
    ? values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5)
    : [];
  return { rosterId: match[2], kind, classKey: match[3], values: selected };
}

/* ----------------------------------------------------------------------------
   Побудова embed + компонентів публічного повідомлення
   -------------------------------------------------------------------------- */

function pickLine(pick: RosterMemberPick) {
  return `${roleEmoji(pick.role)} **${pick.discordName}** — ${pick.className} · ${pick.specName}`;
}

function coverageFieldValue(roster: RosterFormation) {
  return rosterClassCoverage(roster)
    .map((row) => {
      const mark = row.count > 0 ? `✅ ${row.count}` : "⬜ вільно";
      return `${row.emoji} **${row.className}** — ${mark}`;
    })
    .join("\n")
    .slice(0, 1024);
}

function rosterListFieldValue(roster: RosterFormation) {
  if (!roster.picks.length) return "Ще ніхто не обрав клас.";
  return [...roster.picks]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, 20)
    .map((pick, index) => `${String(index + 1).padStart(2, "0")}. ${pickLine(pick)}`)
    .join("\n")
    .slice(0, 1024);
}

export function buildRosterDiscordPayload(roster: RosterFormation) {
  const closed = roster.status === "closed";
  const covered = rosterCoveredClassCount(roster);
  const roleCounts = rosterRoleCounts(roster);
  const total = roster.picks.length;

  const fields = [
    {
      name: "📌 Статус",
      value: closed
        ? "🔒 **Набір закрито**"
        : `🟢 **Набір відкрито** — натисни кнопку й обери клас та спеку`,
      inline: false,
    },
    {
      name: `👥 Склад (${total}/${ROSTER_TARGET_SIZE})`,
      value: rosterListFieldValue(roster),
      inline: false,
    },
    {
      name: `🎯 Покриття класів (${covered}/${wowClassCount()})`,
      value: coverageFieldValue(roster),
      inline: false,
    },
    {
      name: "⚔️ Ролі",
      value: `🛡️ Танки: **${roleCounts.tank}**\n💚 Хіли: **${roleCounts.healer}**\n⚔️ ДД: **${roleCounts.dps}**`,
      inline: false,
    },
  ];

  const embed = normalizeDiscordEmbed({
    title: `${closed ? "🔒" : "🧭"} ${roster.title}`,
    description: roster.description || "Обери свій клас і спеку для рейдової групи ендгейм-контенту.",
    color: closed ? 0x5865f2 : 0xf5a316,
    fields,
    author: roster.authorName ? { name: roster.authorName } : undefined,
    footer: {
      text: closed
        ? "Mistblossom Vanguard • Формування складу завершено"
        : `Mistblossom Vanguard • Мета: ${ROSTER_TARGET_SIZE} гравців, мінімум 1 представник кожного класу`,
    },
    timestamp: new Date().toISOString(),
  });

  return {
    content: closed
      ? "🔒 **Формування складу завершено.**"
      : "🧭 **Формування складу відкрито. Натисни кнопку, обери клас і спеку — твій нік автоматично зафіксується.**",
    embed,
    components: buildRosterDiscordComponents(roster),
    mentionRoleIds: cleanSnowflakeIds(roster.mentionRoleIds),
  };
}

function buildRosterDiscordComponents(roster: RosterFormation) {
  if (roster.status === "closed") return [];
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "Обрати / змінити клас",
          emoji: { name: "🧭" },
          custom_id: buildRosterPickCustomId(roster.id),
        },
        {
          type: 2,
          style: 4,
          label: "Покинути склад",
          emoji: { name: "🚪" },
          custom_id: buildRosterLeaveCustomId(roster.id),
        },
      ],
    },
  ];
}

/** Ефемерне меню вибору класу (крок 1). */
function classSelectComponents(rosterId: string) {
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: buildRosterClassSelectCustomId(rosterId),
          placeholder: "Обери свій клас",
          min_values: 1,
          max_values: 1,
          options: WOW_CLASS_CATALOG.map((cls) => ({
            label: cls.label,
            value: cls.key,
            emoji: { name: cls.emoji },
          })).slice(0, 25),
        },
      ],
    },
  ];
}

/** Ефемерне меню вибору спеки (крок 2). */
function specSelectComponents(rosterId: string, classKey: string) {
  const cls = findWowClass(classKey);
  if (!cls) return null;
  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: buildRosterSpecSelectCustomId(rosterId, cls.key),
          placeholder: `Спека — ${cls.label}`,
          min_values: 1,
          max_values: 1,
          options: cls.specs
            .map((spec) => ({
              label: spec.label,
              value: spec.key,
              description: roleLabelShort(spec.role),
              emoji: { name: roleEmoji(spec.role) },
            }))
            .slice(0, 25),
        },
      ],
    },
  ];
}

/* ----------------------------------------------------------------------------
   Discord-інтеракції (крок за кроком)
   -------------------------------------------------------------------------- */

type RosterActionResult = { ok: boolean; content: string; components?: unknown[] };

async function rerenderRosterMessage(roster: RosterFormation) {
  if (!roster.channelId || !roster.messageId) return;
  const payload = buildRosterDiscordPayload(roster);
  await editDiscordRaidMessage({
    ref: { channelId: roster.channelId, messageId: roster.messageId },
    content: payload.content,
    embed: payload.embed,
    components: payload.components,
    mentionRoleIds: [], // при оновленні складу не пінгуємо ролі повторно
    auditReason: `Roster formation updated: ${roster.id}`,
  }).catch((error) => {
    console.warn("[rosterFormation] failed to re-render message", {
      rosterId: roster.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

async function applyPickTransaction(
  rosterId: string,
  mutate: (roster: RosterFormation) => { picks: RosterMemberPick[] },
): Promise<RosterFormation> {
  return firebaseWrite<RosterFormation>(
    "raid",
    `roster:mutate:${rosterId}:${Date.now()}`,
    async () => {
      const ref = rosterRef(rosterId);
      return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Формування складу не знайдено.");
        const roster = normalizeRosterFormation(snap.id, snap.data() || {});
        if (roster.status === "closed") throw new Error("Набір складу вже закрито.");
        const { picks } = mutate(roster);
        const updatedAt = new Date().toISOString();
        tx.update(ref, { picks, updatedAt, updatedAtMs: Date.now() });
        return { ...roster, picks, updatedAt };
      });
    },
    { logEvent: "roster.mutate_failed" },
  );
}

/**
 * Обробляє всі кроки Discord-інтеракції складу:
 *  pick  → показати меню класів (ефемерно)
 *  class → показати меню спек обраного класу (ефемерно)
 *  spec  → зберегти вибір у Firebase, оновити публічний ембед
 *  leave → прибрати гравця зі складу, оновити ембед
 */
export async function handleRosterFormationDiscordAction(params: {
  rosterId: string;
  kind: RosterDiscordKind;
  classKey?: string;
  values: string[];
  userId: string;
  userName: string;
}): Promise<RosterActionResult> {
  const { rosterId, kind, values, userId, userName } = params;

  if (!/^\d{16,25}$/.test(userId)) {
    return { ok: false, content: "❌ Discord не передав твій ID. Спробуй натиснути кнопку ще раз." };
  }

  const roster = await getRosterFormation(rosterId);
  if (!roster) return { ok: false, content: "Це формування складу вже недоступне." };
  if (roster.status === "closed") return { ok: false, content: "🔒 Набір складу вже закрито офіцером." };

  if (kind === "pick") {
    return {
      ok: true,
      content: "🧭 Обери свій клас для складу:",
      components: classSelectComponents(rosterId),
    };
  }

  if (kind === "class") {
    const classKey = values[0];
    const cls = findWowClass(classKey);
    if (!cls) return { ok: false, content: "Невідомий клас. Спробуй ще раз." };
    const specs = specSelectComponents(rosterId, cls.key);
    if (!specs) return { ok: false, content: "Не вдалося показати спеки цього класу." };
    return { ok: true, content: `Клас: **${cls.label}**. Тепер обери спеку:`, components: specs };
  }

  if (kind === "spec") {
    const resolved = findWowSpec(params.classKey, values[0]);
    if (!resolved) return { ok: false, content: "Невідома спеціалізація. Спробуй ще раз." };
    const now = new Date().toISOString();

    const updated = await applyPickTransaction(rosterId, (current) => {
      const existing = current.picks.find((pick) => pick.discordUserId === userId);
      const withoutUser = current.picks.filter((pick) => pick.discordUserId !== userId);
      if (!existing && withoutUser.length >= ROSTER_TARGET_SIZE) {
        throw new Error(`Склад уже заповнений (${ROSTER_TARGET_SIZE}/${ROSTER_TARGET_SIZE}).`);
      }
      const pick: RosterMemberPick = {
        discordUserId: userId,
        discordName: cleanText(userName, 80) || existing?.discordName || "Учасник Discord",
        classKey: resolved.cls.key,
        className: resolved.cls.label,
        specKey: resolved.spec.key,
        specName: resolved.spec.label,
        role: resolved.spec.role,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      return { picks: [...withoutUser, pick] };
    });

    await rerenderRosterMessage(updated);
    return {
      ok: true,
      content: `✅ Тебе записано у склад: **${resolved.cls.label} · ${resolved.spec.label}** (${roleLabelShort(resolved.spec.role)}).`,
    };
  }

  // leave
  const before = roster.picks.length;
  const updated = await applyPickTransaction(rosterId, (current) => ({
    picks: current.picks.filter((pick) => pick.discordUserId !== userId),
  }));
  if (updated.picks.length === before) {
    return { ok: true, content: "Тебе й не було у складі — нічого не змінилось." };
  }
  await rerenderRosterMessage(updated);
  return { ok: true, content: "🚪 Тебе прибрано зі складу." };
}

/* ----------------------------------------------------------------------------
   Публікація / очистка (адмін, через сайт)
   -------------------------------------------------------------------------- */

async function publishRosterMessage(roster: RosterFormation, channelId: string) {
  const payload = buildRosterDiscordPayload(roster);
  const message = (await createDiscordRaidMessage({
    channelId,
    content: payload.content,
    embed: payload.embed,
    components: payload.components,
    mentionRoleIds: payload.mentionRoleIds,
    auditReason: `Roster formation published: ${roster.id}`,
  })) as Record<string, unknown>;

  const messageId = cleanSnowflake(message?.id || message?.message_id);
  const finalChannelId = cleanSnowflake(message?.channel_id) || channelId;
  if (!messageId || !finalChannelId) throw new Error("Discord не підтвердив повідомлення складу.");
  return { channelId: finalChannelId, messageId, messageUrl: discordMessageUrl(finalChannelId, messageId) };
}

export async function saveRosterFormationFromInput(
  input: RosterCreateInput,
  user: DashboardSession,
): Promise<RosterFormation> {
  if (!hasRosterStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));

  const season = cleanSeason(input.season);
  const description = cleanText(input.description, 1500);
  const channelId = cleanSnowflake(input.channelId) || getDiscordDefaultChannelId();
  const mentionRoleIds = cleanSnowflakeIds(input.mentionRoleIds);
  if (!channelId) throw new Error("Discord-канал для складу не вибрано.");

  const now = new Date().toISOString();
  const id = newRosterId();
  const authorId = user.provider === "discord" ? cleanSnowflake(user.id) : "";
  const draft: RosterFormation = {
    id,
    season,
    title: rosterFullTitle(season),
    description,
    channelId,
    messageId: "",
    messageUrl: "",
    mentionRoleIds,
    authorId,
    authorName: cleanText(user.name, 80),
    status: "open",
    picks: [],
    createdAt: now,
    updatedAt: now,
  };

  const published = await publishRosterMessage(draft, channelId);
  const finalRoster: RosterFormation = { ...draft, ...published, updatedAt: new Date().toISOString() };

  await firebaseWrite<void>(
    "raid",
    `roster:create:${id}`,
    async () => {
      await rosterRef(id).set({
        season: finalRoster.season,
        title: finalRoster.title,
        description: finalRoster.description,
        channelId: finalRoster.channelId,
        messageId: finalRoster.messageId,
        messageUrl: finalRoster.messageUrl,
        mentionRoleIds: finalRoster.mentionRoleIds,
        authorId: finalRoster.authorId,
        authorName: finalRoster.authorName,
        status: finalRoster.status,
        picks: [],
        createdAt: finalRoster.createdAt,
        updatedAt: finalRoster.updatedAt,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
    },
    { logEvent: "roster.create_failed" },
  );

  clearRosterCaches(id);
  return finalRoster;
}

/** Очистка складу: прибирає всі вибори гравців (лише адмін). */
export async function clearRosterFormation(rosterId: string): Promise<RosterFormation> {
  if (!hasRosterStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));

  const cleared = await firebaseWrite<RosterFormation>(
    "raid",
    `roster:clear:${rosterId}`,
    async () => {
      const ref = rosterRef(rosterId);
      return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Формування складу не знайдено.");
        const roster = normalizeRosterFormation(snap.id, snap.data() || {});
        const updatedAt = new Date().toISOString();
        tx.update(ref, { picks: [], updatedAt, updatedAtMs: Date.now() });
        return { ...roster, picks: [], updatedAt };
      });
    },
    { logEvent: "roster.clear_failed" },
  );

  await rerenderRosterMessage(cleared);
  clearRosterCaches(rosterId);
  return cleared;
}

/** Закриття набору + видалення повідомлення (опційно для адміна). */
export async function deleteRosterFormation(rosterId: string): Promise<void> {
  if (!hasRosterStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));
  const roster = await getRosterFormation(rosterId);
  if (!roster) return;

  if (roster.channelId && roster.messageId) {
    await deleteDiscordRaidMessage({
      ref: { channelId: roster.channelId, messageId: roster.messageId },
      auditReason: `Roster formation deleted: ${rosterId}`,
    }).catch(() => null);
  }

  await firebaseWrite<void>(
    "raid",
    `roster:delete:${rosterId}`,
    async () => {
      await rosterRef(rosterId).delete();
    },
    { logEvent: "roster.delete_failed" },
  );
  clearRosterCaches(rosterId);
}

// FieldValue збережено для майбутніх часткових оновлень; тримаємо імпорт живим.
void FieldValue;
