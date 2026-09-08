/**
 * Спільні дрібні нормалізатори.
 *
 * Модуль навмисно БЕЗ жодного імпорту: він потрапляє і в серверні бібліотеки,
 * і в middleware (`src/proxy.ts`), і в клієнтські компоненти. Будь-яка
 * залежність тут — це або цикл імпортів, або `next/server` у браузерному
 * бандлі, тому нових імпортів сюди додавати не треба.
 *
 * Кожна функція тут раніше існувала в кількох копіях:
 *   timestampToIso  — 12 копій
 *   envFlag         — 9 копій
 *   cleanSnowflake  — 8 копій (під трьома різними назвами)
 *   timezoneOffsetMs — 2 копії по 26 рядків
 * Копії встигли розійтись: частина `timestampToIso` не розуміла `Date`,
 * частина `envFlag` — списку імен змінних. Тобто це вже була не косметика,
 * а різна поведінка на однакових на вигляд викликах.
 */

/** Firestore Timestamp, ISO-рядок або Date → ISO-рядок. */
export function timestampToIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const maybeTimestamp = value as { toDate?: () => Date };
  if (typeof maybeTimestamp.toDate === "function") {
    const date = maybeTimestamp.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Булева змінна оточення. Приймає одне імʼя або список: перше визначене
 * і непорожнє значення виграє, решта ігнорується.
 */
export function envFlag(names: string | string[], fallback = false) {
  for (const name of Array.isArray(names) ? names : [names]) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") continue;
    return TRUTHY_ENV_VALUES.has(String(raw).trim().toLowerCase());
  }
  return fallback;
}

/** Discord snowflake або порожній рядок. Єдине джерело правди для формату ID. */
export function cleanSnowflake(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

/**
 * Список snowflake-ів без дублів. Приймає масив, рядок через кому/пробіл
 * або одне значення — усі три форми зустрічались у різних копіях.
 */
export function cleanSnowflakeIds(values: unknown, max = 25) {
  const list = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values.split(/[\s,]+/)
      : values == null
        ? []
        : [values];
  return Array.from(new Set(list.map(cleanSnowflake).filter(Boolean))).slice(0, Math.max(0, max));
}

/**
 * Зсув часової зони відносно UTC у мілісекундах на конкретний момент.
 * Через Intl, тому враховує перехід на літній час. При будь-якій помилці
 * повертає 0 — це гірше за правильний зсув, але краще за виняток у cron.
 */
export function timezoneOffsetMs(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour === "24" ? "0" : values.hour),
      Number(values.minute),
      Number(values.second),
    );
    return asUtc - date.getTime();
  } catch {
    return 0;
  }
}
