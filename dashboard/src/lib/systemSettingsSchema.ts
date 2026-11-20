// Owner-editable runtime settings that used to live only in dashboard/.env.production.
// Pure module (no storage, no server-only): validation and env overlay are unit-tested.
//
// Only non-secret, fail-safe values belong here. Secrets, bootstrap values (database,
// session, tokens), build-time NEXT_PUBLIC_* values and fail-closed security switches
// stay in .env and are managed with `make configure`.

export type SystemSettingKind = "text" | "realm" | "region" | "regions" | "locale" | "timezone" | "https" | "bool" | "int";
export type SystemSettingDef = {
  key: string;
  group: "Гільдія" | "Інтеграції" | "Діагностика" | "Сховище";
  label: string;
  help: string;
  kind: SystemSettingKind;
  /** "live": read on every call, applies right after saving. "restart": read once at start-up. */
  applies: "live" | "restart";
  min?: number;
  max?: number;
};

export const REGIONS = ["eu", "us", "kr", "tw"] as const;

export const SYSTEM_SETTINGS: SystemSettingDef[] = [
  { key: "DISCORD_GUILD_NAME", group: "Гільдія", label: "Назва Discord-сервера", help: "Показується в повідомленнях і заголовках панелі.", kind: "text", applies: "live" },
  { key: "WOW_GUILD_NAME", group: "Гільдія", label: "Назва гільдії WoW", help: "Як у грі, наприклад Mistblossom Vanguard.", kind: "text", applies: "live" },
  { key: "WOW_GUILD_REALM", group: "Гільдія", label: "Реалм гільдії", help: "Slug реалму латиницею, наприклад terokkar.", kind: "realm", applies: "live" },
  { key: "GUILD_ROSTER_REGION", group: "Гільдія", label: "Регіон складу", help: "Регіон Battle.net для синхронізації складу.", kind: "region", applies: "live" },
  { key: "GUILD_ROSTER_REALM", group: "Гільдія", label: "Реалм складу", help: "Slug реалму для синхронізації складу.", kind: "realm", applies: "live" },
  { key: "GUILD_ROSTER_NAME", group: "Гільдія", label: "Гільдія для складу", help: "Назва гільдії для Battle.net і Raider.IO.", kind: "text", applies: "live" },
  { key: "RAID_RULES_URL", group: "Гільдія", label: "Посилання на правила рейдів", help: "Публічна https-адреса з правилами.", kind: "https", applies: "live" },
  { key: "RAID_TIME_ZONE", group: "Гільдія", label: "Часовий пояс рейдів", help: "IANA-пояс, наприклад Europe/Kyiv.", kind: "timezone", applies: "restart" },
  { key: "BATTLENET_LOCALE", group: "Інтеграції", label: "Мова Battle.net", help: "Локаль відповідей API, наприклад uk_UA або en_GB.", kind: "locale", applies: "live" },
  { key: "BATTLENET_DEFAULT_REGION", group: "Інтеграції", label: "Регіон Battle.net за замовчуванням", help: "Для входу й пошуку персонажів.", kind: "region", applies: "live" },
  { key: "BATTLENET_ENABLED_REGIONS", group: "Інтеграції", label: "Доступні регіони Battle.net", help: "Через кому: eu,us,kr,tw.", kind: "regions", applies: "live" },
  { key: "GUILD_ROSTER_AUTO_SYNC_ENABLED", group: "Інтеграції", label: "Автосинхронізація складу", help: "Фонове оновлення складу за розкладом.", kind: "bool", applies: "live" },
  { key: "GUILD_ROSTER_FULL_REFRESH_SECONDS", group: "Інтеграції", label: "Повне оновлення складу, с", help: "Як часто перечитувати весь склад (від 15 хв до 7 днів).", kind: "int", applies: "live", min: 900, max: 604_800 },
  { key: "DASHBOARD_DEBUG_LOGS", group: "Діагностика", label: "Докладні журнали панелі", help: "Лише для діагностики: збільшує обсяг журналу.", kind: "bool", applies: "live" },
  { key: "SECURITY_DEBUG_LOGS", group: "Діагностика", label: "Докладні журнали безпеки", help: "Деталі відхилених запитів; без секретів.", kind: "bool", applies: "live" },
  { key: "DISCORD_API_LOG_SUCCESS", group: "Діагностика", label: "Журнал успішних запитів Discord", help: "Записувати й успішні виклики Discord API.", kind: "bool", applies: "live" },
  { key: "DASHBOARD_API_DEBUG_AUDIT_LOGS", group: "Діагностика", label: "Аудит фонових API", help: "Докладний аудит фонових оновлень.", kind: "bool", applies: "live" },
  { key: "STORAGE_ECO_MODE", group: "Сховище", label: "Економний режим сховища", help: "Рідше оновлює кеші й зменшує навантаження на базу.", kind: "bool", applies: "live" },
];

export const SYSTEM_SETTING_KEYS = new Set(SYSTEM_SETTINGS.map(setting => setting.key));
export const MAX_SYSTEM_SETTING_LENGTH = 200;

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(value);
  } catch {
    return false;
  }
}

/** Normalized value, or an error message in Ukrainian. Empty input means «use .env». */
export function normalizeSystemSetting(def: SystemSettingDef, input: unknown): { value: string } | { error: string } {
  if (input === null || input === undefined) return { value: "" };
  if (typeof input !== "string" && typeof input !== "number" && typeof input !== "boolean") return { error: "Некоректний тип значення." };
  const raw = String(input).trim();
  if (!raw) return { value: "" };
  if (raw.length > MAX_SYSTEM_SETTING_LENGTH || /[\u0000-\u001f\u007f]/.test(raw)) return { error: "Значення задовге або містить керівні символи." };
  switch (def.kind) {
    case "text":
      return raw.length <= 100 ? { value: raw } : { error: "Не більше 100 символів." };
    case "realm":
      return /^[a-z0-9-]{2,64}$/.test(raw) ? { value: raw } : { error: "Slug реалму: латиниця, цифри й дефіс, наприклад terokkar." };
    case "region":
      return (REGIONS as readonly string[]).includes(raw.toLowerCase()) ? { value: raw.toLowerCase() } : { error: `Допустимо: ${REGIONS.join(", ")}.` };
    case "regions": {
      const list = raw.toLowerCase().split(",").map(part => part.trim()).filter(Boolean);
      if (!list.length || list.some(region => !(REGIONS as readonly string[]).includes(region))) return { error: `Регіони через кому з: ${REGIONS.join(", ")}.` };
      return { value: [...new Set(list)].join(",") };
    }
    case "locale":
      return /^[a-z]{2}_[A-Z]{2}$/.test(raw) ? { value: raw } : { error: "Формат мова_КРАЇНА, наприклад uk_UA." };
    case "timezone":
      return validTimeZone(raw) ? { value: raw } : { error: "Невідомий часовий пояс; приклад: Europe/Kyiv." };
    case "https": {
      try {
        const url = new URL(raw);
        return url.protocol === "https:" && !url.username && !url.password ? { value: url.href } : { error: "Потрібна https-адреса без логіна й пароля." };
      } catch {
        return { error: "Некоректна адреса." };
      }
    }
    case "bool": {
      const text = raw.toLowerCase();
      if (["1", "true", "on", "yes"].includes(text)) return { value: "true" };
      if (["0", "false", "off", "no"].includes(text)) return { value: "false" };
      return { error: "Потрібно true або false." };
    }
    case "int": {
      if (!/^\d{1,9}$/.test(raw)) return { error: "Потрібне ціле число." };
      const value = Number(raw);
      if ((def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max)) return { error: `Від ${def.min} до ${def.max}.` };
      return { value: String(value) };
    }
  }
}

/** Validates a whole submission; unknown keys are rejected rather than silently stored. */
export function normalizeSystemSettings(input: unknown): { values: Record<string, string> } | { errors: Record<string, string> } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: { _: "Очікується обʼєкт значень." } };
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const def = SYSTEM_SETTINGS.find(setting => setting.key === key);
    if (!def) { errors[key] = "Невідомий параметр."; continue; }
    const result = normalizeSystemSetting(def, raw);
    if ("error" in result) errors[key] = result.error;
    else if (result.value) values[key] = result.value;
  }
  return Object.keys(errors).length ? { errors } : { values };
}

/**
 * Overlays stored values on process.env. The first call snapshots the original .env
 * values, so clearing an override restores the .env value (or removes the variable).
 */
export function applySystemSettingsToEnv(values: Record<string, string>, env: NodeJS.ProcessEnv, base: Record<string, string | undefined>) {
  for (const def of SYSTEM_SETTINGS) {
    if (!(def.key in base)) base[def.key] = env[def.key];
    const override = values[def.key];
    if (override) env[def.key] = override;
    else if (base[def.key] === undefined) delete env[def.key];
    else env[def.key] = base[def.key];
  }
}
