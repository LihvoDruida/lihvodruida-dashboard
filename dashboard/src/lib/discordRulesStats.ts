import "server-only";

import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { firebaseRead, firebaseWrite } from "@/lib/firebaseAccess";
import { cleanSnowflake, timestampToIso } from "@/lib/values";

/**
 * Записи про прийняття правил — у нашій базі.
 *
 * Раніше вони жили в Cloudflare KV під ключами `rules:<guildId>:user:<userId>`,
 * а лічильники — окремими ключами поруч. Тепер це звичайна колекція
 * документів: `discordRulesRecords/<guildId>:<userId>`.
 *
 * Лічильники навмисно НЕ дублюються окремими полями. У KV вони існували тому,
 * що перерахунок вимагав `list` по всьому неймспейсу; у нас це один запит із
 * фільтром, і два джерела правди, які можуть розійтись, тут зайві.
 */

const RULES_RECORDS_COLLECTION = "discordRulesRecords";

export type RulesRecordAction = "accepted" | "declined";
export type RulesRecordScope = "guild" | "raid";

export type RulesRecord = {
  guildId: string;
  discordId: string;
  discordName: string;
  scope: RulesRecordScope;
  action: RulesRecordAction;
  updatedAt: string;
  profileId: string | null;
};

function recordId(guildId: string, discordId: string, scope: RulesRecordScope) {
  return `${scope}:${guildId || "global"}:${discordId}`;
}

function cleanScope(value: unknown): RulesRecordScope {
  return String(value || "").trim().toLowerCase() === "raid" ? "raid" : "guild";
}

function cleanAction(value: unknown): RulesRecordAction {
  return String(value || "").trim().toLowerCase() === "declined" ? "declined" : "accepted";
}

function normalizeRecord(raw: unknown): RulesRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const discordId = cleanSnowflake(data.discordId);
  if (!discordId) return null;
  return {
    guildId: cleanSnowflake(data.guildId),
    discordId,
    discordName: String(data.discordName || "").trim().slice(0, 100) || "Discord user",
    scope: cleanScope(data.scope),
    action: cleanAction(data.action),
    updatedAt: timestampToIso(data.updatedAt) || new Date(0).toISOString(),
    profileId: String(data.profileId || "").trim() || null,
  };
}

function guildFilter(guildId?: string | null) {
  return cleanSnowflake(guildId) || cleanSnowflake(process.env.DISCORD_GUILD_ID);
}

/**
 * Записує рішення користувача щодо правил.
 *
 * Ідемпотентно за (scope, guild, user): повторне прийняття не роздуває
 * лічильники, а зміна рішення просто перезаписує запис — рівно так само,
 * як поводився KV-варіант.
 */
export async function recordRulesDecision(input: {
  guildId?: string | null;
  discordId: string;
  discordName?: string | null;
  scope?: RulesRecordScope;
  action?: RulesRecordAction;
  profileId?: string | null;
}) {
  if (!hasFirebaseProfileConfig()) return { ok: false as const, reason: "unconfigured" as const };

  const discordId = cleanSnowflake(input.discordId);
  if (!discordId) return { ok: false as const, reason: "invalid_user" as const };

  const guildId = guildFilter(input.guildId);
  const scope = cleanScope(input.scope);
  const record: RulesRecord = {
    guildId,
    discordId,
    discordName: String(input.discordName || "").trim().slice(0, 100) || "Discord user",
    scope,
    action: cleanAction(input.action),
    updatedAt: new Date().toISOString(),
    profileId: String(input.profileId || "").trim() || null,
  };

  await firebaseWrite("rules", `rules-record:${record.scope}:${discordId}`, async () => {
    await getFirebaseAdminDb()
      .collection(RULES_RECORDS_COLLECTION)
      .doc(recordId(guildId, discordId, scope))
      .set(record);
  }, { logEvent: "rules.record_failed" });

  return { ok: true as const, record };
}

async function loadRecords(scope: RulesRecordScope, guildId?: string | null): Promise<RulesRecord[] | null> {
  if (!hasFirebaseProfileConfig()) return null;

  return firebaseRead("rules", `rules-records:${scope}`, async () => {
    const snapshot = await getFirebaseAdminDb()
      .collection(RULES_RECORDS_COLLECTION)
      .where("scope", "==", scope)
      .get();

    const wanted = guildFilter(guildId);
    const records: RulesRecord[] = [];
    for (const doc of snapshot.docs) {
      const record = normalizeRecord(doc.data());
      if (!record) continue;
      // Порожній guildId у записі означає «до того, як гільдію почали
      // проставляти» — такі записи рахуємо, інакше стара статистика зникне.
      if (wanted && record.guildId && record.guildId !== wanted) continue;
      records.push(record);
    }
    return records;
  }, {
    // Хвилина кешу: сторінка правил відкривається рідко, але оновлюється
    // після кожного підпису — довший TTL зробив би її брехливою.
    ttlMs: 60_000,
    fallback: () => null as RulesRecord[] | null,
    logEvent: "rules.records_read_failed",
  });
}

function latestIso(records: RulesRecord[]) {
  let latest: string | null = null;
  for (const record of records) {
    if (!latest || record.updatedAt > latest) latest = record.updatedAt;
  }
  return latest;
}

export async function readGuildRulesStats(guildId?: string | null) {
  const records = await loadRecords("guild", guildId);
  if (!records) return null;

  let accepted = 0;
  let declined = 0;
  for (const record of records) {
    if (record.action === "declined") declined += 1;
    else accepted += 1;
  }
  return { accepted, declined, total: accepted + declined, updatedAt: latestIso(records) };
}

export async function readRaidRulesRecords(guildId?: string | null) {
  const records = await loadRecords("raid", guildId);
  if (!records) return null;

  const signed = records.filter((record) => record.action === "accepted");
  // Найновіші зверху: сторінка правил показує саме останні підписи.
  signed.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return { signed, updatedAt: latestIso(records) };
}
