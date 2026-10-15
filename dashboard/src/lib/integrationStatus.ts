import { checkBattleNetApplicationAccess, getDefaultBattleNetRegion } from "@/lib/battlenet";
import { discordApi, getDiscordGuildId, hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { hasDocumentDbConfig, getDocumentDb } from "@/lib/documentDb";
import { storageCapability } from "@/lib/storageAccess";
import { envFlag } from "@/lib/values";

export type IntegrationState = "ok" | "warning" | "error" | "unconfigured";

export type IntegrationStatusItem = {
  key: "discord" | "battlenet" | "applications" | "database" | "database-write";
  label: string;
  state: IntegrationState;
  message: string;
  checkedAt: string;
};

export type IntegrationStatusSummary = {
  checkedAt: string;
  items: IntegrationStatusItem[];
};

function item(key: IntegrationStatusItem["key"], label: string, state: IntegrationState, message: string, checkedAt: string): IntegrationStatusItem {
  return { key, label, state, message, checkedAt };
}

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomIntegrationStatusCache: { checkedAtMs: number; value: IntegrationStatusSummary } | undefined;
}
function integrationStatusCacheTtlMs() {
  const fallback = envFlag(["STORAGE_ECO_MODE", "STORAGE_ECO_MODE", "DASHBOARD_ECO_MODE"], false) ? 10 * 60_000 : 120_000;
  const value = Number(process.env.INTEGRATION_STATUS_CACHE_TTL_MS || fallback);
  return Number.isFinite(value) ? Math.max(60_000, Math.min(Math.floor(value), 60 * 60_000)) : fallback;
}

function safeMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (message || fallback).replace(/\s+/g, " ").trim().slice(0, 160) || fallback;
}

async function checkDiscord(checkedAt: string): Promise<IntegrationStatusItem> {
  if (!hasDiscordEmbedConfig()) {
    return item("discord", "Discord", "unconfigured", "потребує уваги", checkedAt);
  }

  const guildId = getDiscordGuildId();
  if (!guildId) {
    return item("discord", "Discord", "warning", "бот є, але guild id не заданий", checkedAt);
  }

  try {
    await discordApi(`/guilds/${guildId}`);
    return item("discord", "Discord", "ok", "працює", checkedAt);
  } catch (error) {
    const message = safeMessage(error, "Discord тимчасово недоступний");
    if (/тимчасово недоступна|bot token|публікація/i.test(message)) {
      return item("discord", "Discord", "warning", "підключено, але потрібна ручна перевірка", checkedAt);
    }
    return item("discord", "Discord", "error", message, checkedAt);
  }
}

async function checkBattleNet(checkedAt: string): Promise<IntegrationStatusItem> {
  try {
    await checkBattleNetApplicationAccess(getDefaultBattleNetRegion());
    return item("battlenet", "Battle.net", "ok", "працює", checkedAt);
  } catch (error) {
    const message = safeMessage(error, "Battle.net тимчасово недоступний");
    if (/not configured|env is not configured|oauth env/i.test(message)) {
      return item("battlenet", "Battle.net", "unconfigured", "потребує уваги", checkedAt);
    }
    return item("battlenet", "Battle.net", "error", message, checkedAt);
  }
}

async function checkApplications(checkedAt: string): Promise<IntegrationStatusItem> {
  try {
    await getDocumentDb().collection(process.env.STORAGE_APPLICATIONS_COLLECTION || "guildApplications").limit(1).get();
    return item("applications", "Заявки", "ok", "працює", checkedAt);
  } catch (error) {
    const message = safeMessage(error, "Заявки тимчасово недоступні");
    if (/env is not configured|not configured/i.test(message)) {
      return item("applications", "Заявки", "unconfigured", "потребує уваги", checkedAt);
    }
    return item("applications", "Заявки", "error", message, checkedAt);
  }
}

async function checkStorageProfiles(checkedAt: string): Promise<IntegrationStatusItem> {
  if (!hasDocumentDbConfig()) {
    return item("database", "Профілі", "unconfigured", "потребує уваги", checkedAt);
  }

  try {
    const db = getDocumentDb();
    await db.collection("dashboardProfiles").limit(1).get();
    return item("database", "Профілі", "ok", "працює", checkedAt);
  } catch (error) {
    return item("database", "Профілі", "error", safeMessage(error, "Профілі тимчасово недоступні"), checkedAt);
  }
}

async function checkStorageWrites(checkedAt: string): Promise<IntegrationStatusItem> {
  const capability = storageCapability("profile", "write");
  if (!capability.configured) {
    return item("database-write", "Запис PostgreSQL", "unconfigured", "потребує уваги", checkedAt);
  }
  if (!capability.available) {
    return item("database-write", "Запис PostgreSQL", "warning", "режим тільки читання", checkedAt);
  }
  return item("database-write", "Запис PostgreSQL", "ok", "доступний", checkedAt);
}

export async function getIntegrationStatusSummary(): Promise<IntegrationStatusSummary> {
  const cached = globalThis.__mistblossomIntegrationStatusCache;
  if (cached && Date.now() - cached.checkedAtMs < integrationStatusCacheTtlMs()) return cached.value;

  const checkedAt = new Date().toISOString();
  const results = await Promise.allSettled([
    checkDiscord(checkedAt),
    checkBattleNet(checkedAt),
    checkApplications(checkedAt),
    checkStorageProfiles(checkedAt),
    checkStorageWrites(checkedAt),
  ]);

  const fallbackKeys: Array<[IntegrationStatusItem["key"], string]> = [
    ["discord", "Discord"],
    ["battlenet", "Battle.net"],
    ["applications", "Заявки"],
    ["database", "Профілі"],
    ["database-write", "Запис PostgreSQL"],
  ];

  const value = {
    checkedAt,
    items: results.map((result, index) => {
      if (result.status === "fulfilled") return result.value;
      const [key, label] = fallbackKeys[index] || ["discord", "Інтеграція"];
      return item(key, label, "error", "перевірка не виконалась", checkedAt);
    }),
  };
  globalThis.__mistblossomIntegrationStatusCache = { checkedAtMs: Date.now(), value };
  return value;
}
