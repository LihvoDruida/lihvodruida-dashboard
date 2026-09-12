import { randomUUID } from "crypto";
import { FieldValue, type QueryDocumentSnapshot, type Transaction } from "@/lib/db/firestoreCompat";
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
  wowClassCount,
  wowSpecFullName,
} from "@/lib/wowClassCatalog";
import {
  RAID_ALGORITHM_PARTY_SIZE,
  raidAlgorithmAutoCompositionForSize,
  raidAlgorithmDpsRangeType,
} from "@/lib/raidCompositionAlgorithm";
import { cleanSnowflake, cleanSnowflakeIds } from "@/lib/values";
import { resolveDiscordInteractionDocument, type DiscordInteractionMessageRef } from "@/lib/discordInteractionStorage";

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
/* Кеш складу свідомо коротший за рейдовий (60 с).

   Скидання кешу після запису працює лише в межах одного інстансу:
   інтеракцію з Discord може обробити один, а сторінку відрендерити
   інший, у якого копія ще стара. У рейдів це закриває інвалідація
   публічного кеша Cloudflare, у складу такої немає — тож вікно
   розбіжності обмежуємо коротшим TTL. Документів мало (до 60),
   тож зайві читання Firestore дешеві. */
const ROSTER_LIST_TTL_MS = 15_000;
const ROSTER_GET_TTL_MS = 15_000;

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
  // Без Discord ID пік неможливо ані показати, ані прибрати — тільки він
  // є справжньою підставою відкинути запис.
  if (!discordUserId) return null;

  const resolved = findWowSpec(data.classKey, data.specKey);
  const createdAt = typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString();

  // Раніше нерозпізнаний спек ТИХО викидав учасника зі складу: у Firestore
  // і в ембеді Discord він лишався, а на сайті зникав. Досить було нового
  // спека в грі або старого ключа в базі. Тепер падаємо на збережені
  // назви — краще показати незвіданий спек, ніж загубити людину.
  const fallbackClassKey = String(data.classKey || "").trim().toLowerCase();
  const fallbackSpecKey = String(data.specKey || "").trim().toLowerCase();
  const storedRole = String(data.role || "").trim().toLowerCase();
  const role: WowCharacterRole =
    storedRole === "tank" || storedRole === "healer" ? storedRole : "dps";

  return {
    discordUserId,
    discordName: cleanText(data.discordName, 80) || "Учасник Discord",
    classKey: resolved?.cls.key || fallbackClassKey,
    className: resolved?.cls.label || cleanText(data.className, 60) || fallbackClassKey || "Невідомий клас",
    specKey: resolved?.spec.key || fallbackSpecKey,
    specName: resolved?.spec.label || cleanText(data.specName, 60) || fallbackSpecKey || "Невідомий спек",
    role: resolved?.spec.role || role,
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
    mentionRoleIds: cleanSnowflakeIds(data.mentionRoleIds, 20),
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
      return snap.docs.map((doc: QueryDocumentSnapshot) => normalizeRosterFormation(doc.id, doc.data() || {}));
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

async function getRosterFormationForDiscordInteraction(
  rosterId: string,
  messageRef?: DiscordInteractionMessageRef | null,
): Promise<RosterFormation | null> {
  if (!hasRosterStorage()) return null;
  const id = String(rosterId || "").trim();
  if (!id) return null;

  const resolved = await resolveDiscordInteractionDocument({
    collection: ROSTER_COLLECTION,
    resourceId: id,
    messageRef,
  });
  if (!resolved) return null;
  const roster = normalizeRosterFormation(resolved.id, resolved.data);
  clearRosterCaches(roster.id);
  if (resolved.recovered) {
    console.warn("[rosterFormation] Discord interaction resource recovered", {
      requestedRosterId: id,
      resolvedRosterId: roster.id,
      source: resolved.source,
      channelId: messageRef?.channelId || null,
      messageId: messageRef?.messageId || null,
    });
  }
  return roster;
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
   Деталізована роль: танк / хіл / ДД (мелі) / РДД (рендж).
   Мелі-vs-рендж визначається автоматично тим самим класифікатором, що вже
   використовують рейди на сайті (raidAlgorithmDpsRangeType), тож джерело
   правди одне.
   -------------------------------------------------------------------------- */

export type RosterDetailedRole = "tank" | "healer" | "melee" | "ranged";

export function rosterPickDetailedRole(pick: RosterMemberPick): RosterDetailedRole {
  if (pick.role === "tank") return "tank";
  if (pick.role === "healer") return "healer";
  return raidAlgorithmDpsRangeType({ className: pick.classKey, activeSpecName: pick.specKey, role: "dps" });
}

export function rosterDetailedRoleLabel(role: RosterDetailedRole) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  if (role === "melee") return "ДД"; // ближній бій
  return "РДД"; // дальній бій
}

export function rosterDetailedRoleEmoji(role: RosterDetailedRole) {
  if (role === "tank") return "🛡️";
  if (role === "healer") return "💚";
  if (role === "melee") return "⚔️";
  return "🏹";
}

export function rosterRoleBreakdown(roster: RosterFormation) {
  return roster.picks.reduce(
    (acc, pick) => {
      acc[rosterPickDetailedRole(pick)] += 1;
      return acc;
    },
    { tank: 0, healer: 0, melee: 0, ranged: 0 } as Record<RosterDetailedRole, number>,
  );
}

/* ----------------------------------------------------------------------------
   Формування паті.

   Цільова композиція береться з тієї ж механіки, що й рейди на сайті:
   raidAlgorithmAutoCompositionForSize(20, "mythic") → 2 танки / 4 хіли / 14 ДД.
   Далі гравці розкладаються по паті (по 5) так, щоб у кожній паті був хіл,
   танки рознесені по перших паті, а ДД заповнювали решту з перевагою до
   різноманіття класів у межах паті (як assignDpsToParties у raids.ts).
   -------------------------------------------------------------------------- */

export type RosterParty = {
  index: number;
  tank: RosterMemberPick | null;
  healer: RosterMemberPick | null;
  dps: RosterMemberPick[];
  members: RosterMemberPick[];
};

export type RosterComposition = {
  /** Ціль для 20 гравців: { tanks: 2, healers: 4, dps: 14 }. */
  target: { tanks: number; healers: number; dps: number };
  partyCount: number;
  parties: RosterParty[];
  bench: RosterMemberPick[];
  breakdown: Record<RosterDetailedRole, number>;
};

function rosterPartyCapacity(party: RosterParty) {
  return RAID_ALGORITHM_PARTY_SIZE - (party.tank ? 1 : 0) - (party.healer ? 1 : 0) - party.dps.length;
}

function rosterPartyMemberCount(party: RosterParty) {
  return (party.tank ? 1 : 0) + (party.healer ? 1 : 0) + party.dps.length;
}

function rosterPartyHasClass(party: RosterParty, classKey: string) {
  return (
    party.tank?.classKey === classKey ||
    party.healer?.classKey === classKey ||
    party.dps.some((member) => member.classKey === classKey)
  );
}

export function buildRosterComposition(roster: RosterFormation): RosterComposition {
  const target = raidAlgorithmAutoCompositionForSize(ROSTER_TARGET_SIZE, "mythic");
  const partyCount = Math.max(1, Math.ceil(ROSTER_TARGET_SIZE / RAID_ALGORITHM_PARTY_SIZE));
  const parties: RosterParty[] = Array.from({ length: partyCount }, (_, i) => ({
    index: i + 1,
    tank: null,
    healer: null,
    dps: [],
    members: [],
  }));

  const ordered = [...roster.picks].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const tanks = ordered.filter((pick) => pick.role === "tank");
  const healers = ordered.filter((pick) => pick.role === "healer");
  const dps = ordered.filter((pick) => pick.role === "dps");
  const bench: RosterMemberPick[] = [];

  // Танки: по одному в паті, у порядку індексів.
  for (const tank of tanks) {
    const slot = parties.find((party) => !party.tank && rosterPartyCapacity(party) > 0);
    if (slot) slot.tank = tank;
    else bench.push(tank);
  }

  // Хіли: рівно по одному в кожну паті (4 хіли → 4 паті). Зайві — на лаву.
  for (const healer of healers) {
    const slot = parties.find((party) => !party.healer && rosterPartyCapacity(party) > 0);
    if (slot) slot.healer = healer;
    else bench.push(healer);
  }

  // ДД: заповнюють вільні слоти; перевага паті без такого ж класу, потім найменш заповненій.
  for (const member of dps) {
    const candidates = parties.filter((party) => rosterPartyCapacity(party) > 0);
    if (!candidates.length) {
      bench.push(member);
      continue;
    }
    candidates.sort((a, b) => {
      const aHas = rosterPartyHasClass(a, member.classKey);
      const bHas = rosterPartyHasClass(b, member.classKey);
      return (
        Number(aHas) - Number(bHas) ||
        a.dps.length - b.dps.length ||
        rosterPartyMemberCount(a) - rosterPartyMemberCount(b) ||
        a.index - b.index
      );
    });
    candidates[0].dps.push(member);
  }

  for (const party of parties) {
    party.members = [party.tank, party.healer, ...party.dps].filter(Boolean) as RosterMemberPick[];
  }

  return { target, partyCount, parties, bench, breakdown: rosterRoleBreakdown(roster) };
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
  const detailed = rosterPickDetailedRole(pick);
  return `${rosterDetailedRoleEmoji(detailed)} **${pick.discordName}** — ${wowSpecFullName(pick.classKey, pick.specKey)}`;
}

function partiesFieldValue(composition: RosterComposition) {
  return composition.parties
    .map((party) => {
      const slots: string[] = [];
      slots.push(party.tank ? `🛡️ ${party.tank.discordName}` : "🛡️ —");
      slots.push(party.healer ? `💚 ${party.healer.discordName}` : "💚 —");
      for (const member of party.dps) {
        const detailed = rosterPickDetailedRole(member);
        slots.push(`${rosterDetailedRoleEmoji(detailed)} ${member.discordName}`);
      }
      return `**Паті ${party.index}** (${party.members.length}/${RAID_ALGORITHM_PARTY_SIZE})\n${slots.join(" · ")}`;
    })
    .join("\n\n")
    .slice(0, 1024);
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
  const composition = buildRosterComposition(roster);
  const breakdown = composition.breakdown;
  const target = composition.target;
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
      value:
        `🛡️ Танки: **${breakdown.tank}/${target.tanks}**\n` +
        `💚 Хіли: **${breakdown.healer}/${target.healers}**\n` +
        `⚔️ ДД (мелі): **${breakdown.melee}**\n` +
        `🏹 РДД (рендж): **${breakdown.ranged}**\n` +
        `Разом ДД: **${breakdown.melee + breakdown.ranged}/${target.dps}**`,
      inline: false,
    },
    {
      name: `🧩 Паті (по ${RAID_ALGORITHM_PARTY_SIZE}, хіл у кожній)`,
      value: total ? partiesFieldValue(composition) : "Паті сформуються, щойно гравці почнуть обирати ролі.",
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
        : `Mistblossom Vanguard • Мета: ${target.tanks} танки / ${target.healers} хіли / ${target.dps} ДД, мінімум 1 представник кожного класу`,
    },
    timestamp: new Date().toISOString(),
  });

  return {
    content: closed
      ? "🔒 **Формування складу завершено.**"
      : "🧭 **Формування складу відкрито. Натисни кнопку, обери клас і спеку — твій нік автоматично зафіксується.**",
    embed,
    components: buildRosterDiscordComponents(roster),
    mentionRoleIds: cleanSnowflakeIds(roster.mentionRoleIds, 20),
  };
}

function buildRosterDiscordComponents(roster: RosterFormation) {
  // Після закриття кнопки НЕ прибираємо, а робимо неактивними: повідомлення
  // лишається візуально цілим, і всім видно, що набір саме закрито, а не зламано.
  const closed = roster.status === "closed";
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: closed ? "Набір закрито" : "Обрати / змінити клас",
          emoji: { name: closed ? "🔒" : "🧭" },
          custom_id: buildRosterPickCustomId(roster.id),
          disabled: closed,
        },
        {
          type: 2,
          style: 4,
          label: "Покинути склад",
          emoji: { name: "🚪" },
          custom_id: buildRosterLeaveCustomId(roster.id),
          disabled: closed,
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
            .map((spec) => {
              const detailed: RosterDetailedRole =
                spec.role === "dps"
                  ? raidAlgorithmDpsRangeType({ className: cls.key, activeSpecName: spec.key, role: "dps" })
                  : spec.role;
              return {
                label: `${spec.label} ${cls.label}`,
                value: spec.key,
                description: rosterDetailedRoleLabel(detailed),
                emoji: { name: rosterDetailedRoleEmoji(detailed) },
              };
            })
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
  const saved = await firebaseWrite<RosterFormation>(
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
    { logEvent: "roster.mutate_failed", bypassCircuit: true },
  );

  // Кеш списку і картки складу треба скинути одразу після запису.
  // Без цього вибір, зроблений кнопкою в Discord, не зʼявлявся на сайті
  // до 60 секунд (TTL кешу), а інколи й довше — сторінка бачила стару
  // копію. Решта мутацій складу вже робили це, а саме гаряча гілка
  // «гравець натиснув кнопку» — ні.
  clearRosterCaches(rosterId);
  return saved;
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
  messageRef?: DiscordInteractionMessageRef | null;
}): Promise<RosterActionResult> {
  const { rosterId, kind, values, userId, userName } = params;

  if (!/^\d{16,25}$/.test(userId)) {
    return { ok: false, content: "❌ Discord не передав твій ID. Спробуй натиснути кнопку ще раз." };
  }

  let roster: RosterFormation | null = null;
  try {
    roster = await getRosterFormationForDiscordInteraction(rosterId, params.messageRef);
  } catch (error) {
    console.error("[rosterFormation] authoritative Discord lookup failed", {
      rosterId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      content: "⚠️ Сховище складу зараз не відповідає. Дані не видалені — спробуй ще раз за кілька секунд.",
    };
  }
  if (!roster) return { ok: false, content: "❌ Формування складу справді не знайдено. Discord-повідомлення могло залишитися від видаленого формування." };
  const effectiveRosterId = roster.id;
  if (roster.status === "closed") return { ok: false, content: "🔒 Набір складу вже закрито офіцером." };

  if (kind === "pick") {
    return {
      ok: true,
      content: "🧭 Обери свій клас для складу:",
      components: classSelectComponents(effectiveRosterId),
    };
  }

  if (kind === "class") {
    const classKey = values[0];
    const cls = findWowClass(classKey);
    if (!cls) return { ok: false, content: "Невідомий клас. Спробуй ще раз." };
    const specs = specSelectComponents(effectiveRosterId, cls.key);
    if (!specs) return { ok: false, content: "Не вдалося показати спеки цього класу." };
    return { ok: true, content: `Клас: **${cls.label}**. Тепер обери спеку:`, components: specs };
  }

  if (kind === "spec") {
    const resolved = findWowSpec(params.classKey, values[0]);
    if (!resolved) return { ok: false, content: "Невідома спеціалізація. Спробуй ще раз." };
    const now = new Date().toISOString();

    const updated = await applyPickTransaction(effectiveRosterId, (current) => {
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
    const detailedRole: RosterDetailedRole =
      resolved.spec.role === "dps"
        ? raidAlgorithmDpsRangeType({ className: resolved.cls.key, activeSpecName: resolved.spec.key, role: "dps" })
        : resolved.spec.role;
    return {
      ok: true,
      content: `✅ Тебе записано у склад: **${wowSpecFullName(resolved.cls, resolved.spec)}** (${rosterDetailedRoleLabel(detailedRole)}).`,
    };
  }

  // leave
  const before = roster.picks.length;
  const updated = await applyPickTransaction(effectiveRosterId, (current) => ({
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
  const mentionRoleIds = cleanSnowflakeIds(input.mentionRoleIds, 20);
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

/**
 * Закриття або повторне відкриття набору (лише адмін), БЕЗ видалення
 * повідомлення. Кнопки в Discord стають неактивними, дані складу лишаються.
 */
export async function setRosterFormationStatus(
  rosterId: string,
  status: "open" | "closed",
): Promise<RosterFormation> {
  if (!hasRosterStorage()) throw new Error(firebaseUnavailableMessage("raid", "write"));

  const updated = await firebaseWrite<RosterFormation>(
    "raid",
    `roster:status:${rosterId}:${status}`,
    async () => {
      const ref = rosterRef(rosterId);
      return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Формування складу не знайдено.");
        const roster = normalizeRosterFormation(snap.id, snap.data() || {});
        if (roster.status === status) return roster;
        const updatedAt = new Date().toISOString();
        tx.update(ref, { status, updatedAt, updatedAtMs: Date.now() });
        return { ...roster, status, updatedAt };
      });
    },
    { logEvent: "roster.status_failed" },
  );

  await rerenderRosterMessage(updated);
  clearRosterCaches(rosterId);
  return updated;
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

/**
 * Прибирає зі складів сезону тих, кого вже немає в Discord.
 *
 * Раніше очищення акаунтів чистило профілі та рейдові записи, але
 * формування складу лишалися недоторканими: людина виходила з сервера,
 * а її пік і далі займав місце в паті та зараховувався в покриття класів.
 *
 * Закриті набори не чіпаємо: це історія сезону, а не активний склад.
 */
export async function removeRosterPicksForAccounts(input: {
  discordUserIds?: Iterable<unknown>;
  dryRun?: boolean;
  limit?: unknown;
}) {
  const targets = new Set(
    [...(input.discordUserIds || [])]
      .map((value) => String(value || "").trim())
      .filter((value) => /^\d{16,25}$/.test(value)),
  );

  const empty = {
    dryRun: Boolean(input.dryRun),
    scannedRosters: 0,
    changedRosters: 0,
    removedPicks: 0,
    changedItems: [] as Array<{
      rosterId: string;
      title: string;
      removed: number;
      remaining: number;
      names: string[];
    }>,
  };

  if (!targets.size || !hasRosterStorage()) return empty;

  const rosters = await listRosterFormations(Number(input.limit) || 60).catch(
    () => [] as RosterFormation[],
  );
  const result = { ...empty, scannedRosters: rosters.length };

  for (const roster of rosters) {
    if (roster.status === "closed") continue;
    const staying = roster.picks.filter(
      (pick) => !targets.has(String(pick.discordUserId || "").trim()),
    );
    const removed = roster.picks.length - staying.length;
    if (!removed) continue;

    result.changedRosters += 1;
    result.removedPicks += removed;
    result.changedItems.push({
      rosterId: roster.id,
      title: roster.title,
      removed,
      remaining: staying.length,
      names: roster.picks
        .filter((pick) => targets.has(String(pick.discordUserId || "").trim()))
        .map((pick) => pick.discordName || pick.discordUserId)
        .slice(0, 20),
    });

    if (input.dryRun) continue;

    // Пишемо через транзакцію: між читанням списку і записом хтось
    // міг натиснути кнопку в Discord, і його вибір не має зникнути.
    const saved = await firebaseWrite<RosterFormation>(
      "raid",
      `roster:cleanup:${roster.id}:${Date.now()}`,
      async () => {
        const ref = rosterRef(roster.id);
        return getFirebaseAdminDb().runTransaction(async (tx: Transaction) => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw new Error("Формування складу не знайдено.");
          const current = normalizeRosterFormation(snap.id, snap.data() || {});
          const picks = current.picks.filter(
            (pick) => !targets.has(String(pick.discordUserId || "").trim()),
          );
          const updatedAt = new Date().toISOString();
          tx.update(ref, { picks, updatedAt, updatedAtMs: Date.now() });
          return { ...current, picks, updatedAt };
        });
      },
      { logEvent: "roster.cleanup_failed" },
    ).catch(() => null);

    if (saved) {
      await rerenderRosterMessage(saved);
      clearRosterCaches(roster.id);
    }
  }

  return result;
}
