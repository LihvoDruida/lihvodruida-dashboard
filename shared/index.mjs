/**
 * Контракт Discord `custom_id` — єдине джерело правди для панелі й бота.
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ ПАКЕТ. Раніше кожна зі сторін тримала власну копію
 * регулярних виразів. Двічі це закінчилось однаково: у панелі зʼявлявся новий
 * тип дії, копію в боті забували оновити, і кнопка мовчки переставала
 * працювати — бот повертав `null` ще до того, як запит доходив до панелі.
 * Помилка не ловилась ні типами, ні збіркою, тільки в проді.
 *
 * Тепер обидві сторони імпортують саме цей файл. Додаєш дію тут — вона одразу
 * відома і панелі, і боту.
 *
 * Пакет свідомо БЕЗ залежностей і без доменної логіки: тут тільки розбір
 * рядків. Перевірки на кшталт «чи існує такий клас WoW» лишаються в панелі,
 * бо бот про них нічого не знає і знати не повинен.
 */

export const CUSTOM_ID_NAMESPACE = "mbv1";

/** Максимальна довжина custom_id у Discord. Перевищення = 400 від API. */
export const CUSTOM_ID_MAX_LENGTH = 100;

const RAID_ID = "[A-Za-z0-9_-]{8,80}";
const SIGNUP_STATUS = "going|tentative|late|skipped";
const ACTIVE_STATUS = "going|tentative|late";
const ROLE = "tank|healer|dps";
const CHARACTER_KEY = "[A-Za-z0-9._-]{1,64}";
const WEEKDAY = "mon|tue|wed|thu|fri|sat|sun";

/* ------------------------------------------------------------------ *
 * Рейд-пули
 * ------------------------------------------------------------------ */

export const RAID_POLL_ACTION_PREFIX = `${CUSTOM_ID_NAMESPACE}:poll`;

/**
 * Дії, які означають «відкрий приватний пульт голосування».
 *
 * `character_prompt` і `character` — легасі часів, коли голос вимагав
 * персонажа Battle.net. У Discord досі висять опубліковані embed-и зі старими
 * `custom_id`, і після деплою вони мають далі відкривати пульт, а не падати
 * з «Дія не вдалася».
 */
export const RAID_POLL_PROMPT_KINDS = Object.freeze([
  "vote_prompt",
  "character_prompt",
  "character",
]);

const RAID_POLL_PATTERN = new RegExp(
  `^${CUSTOM_ID_NAMESPACE}:poll_(`
    + `schedule_(?:${WEEKDAY})`
    + `|schedule_page_\\d{1,2}`
    + `|vote_prompt|character_prompt|character`
    + `|quick|role|submit`
    + `):(${RAID_ID})$`,
);

/**
 * Розбирає дію рейд-пулу.
 *
 * @param {string} customId
 * @param {unknown} values значення select-меню, якщо це select
 * @returns {{pollId: string, kind: string, group: string, values: string[]} | null}
 */
export function decodeRaidPollCustomId(customId, values) {
  const value = String(customId || "").trim();
  const match = value.match(RAID_POLL_PATTERN);
  if (!match) return null;

  const rawKind = match[1];
  const isPrompt = RAID_POLL_PROMPT_KINDS.includes(rawKind);
  const selected = Array.isArray(values)
    ? values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 25)
    : [];

  // Select без вибраного значення — це або збій клієнта, або підробка.
  // Кнопки (prompt, submit, сторінки) значень не мають за визначенням.
  const needsValues = !isPrompt
    && rawKind !== "submit"
    && !rawKind.startsWith("schedule_page_");
  if (needsValues && !selected.length) return null;

  const kind = isPrompt
    ? "vote_prompt"
    : rawKind.startsWith("schedule_page_")
      ? "schedule_page"
      : rawKind.startsWith("schedule_")
        ? "schedule"
        : rawKind;

  const group = rawKind.startsWith("schedule_page_")
    ? rawKind.replace("schedule_page_", "page_")
    : rawKind.startsWith("schedule_")
      ? rawKind.slice("schedule_".length)
      : "";

  return { pollId: match[2], kind, group, values: selected };
}

/** Чи відкриває ця дія приватний пульт (потрібна НОВА ефемерна відповідь). */
export function isRaidPollPromptKind(kind) {
  return kind === "vote_prompt" || RAID_POLL_PROMPT_KINDS.includes(String(kind));
}

/* ------------------------------------------------------------------ *
 * Записи на рейд
 * ------------------------------------------------------------------ */

export const RAID_CUSTOM_ID_PATTERNS = Object.freeze({
  attendance: new RegExp(`^${CUSTOM_ID_NAMESPACE}:raid:(${RAID_ID}):(${SIGNUP_STATUS})$`),
  characterSelect: new RegExp(`^${CUSTOM_ID_NAMESPACE}:rsc:(${RAID_ID}):(${ACTIVE_STATUS}):(${ROLE})$`),
  characterSelectLegacy: new RegExp(`^${CUSTOM_ID_NAMESPACE}:rc:(${RAID_ID}):(${SIGNUP_STATUS})$`),
  roleSelect: new RegExp(`^${CUSTOM_ID_NAMESPACE}:rsr:(${RAID_ID}):(${ACTIVE_STATUS}):(${CHARACTER_KEY})$`),
  roleSelectLegacy: new RegExp(`^${CUSTOM_ID_NAMESPACE}:rr:(${RAID_ID}):(${ACTIVE_STATUS}):(${CHARACTER_KEY})$`),
  manualClass: new RegExp(`^${CUSTOM_ID_NAMESPACE}:rmc:(${RAID_ID}):(${ACTIVE_STATUS})$`),
  manualSpec: new RegExp(`^${CUSTOM_ID_NAMESPACE}:rms:(${RAID_ID}):(${ACTIVE_STATUS}):([a-z]{2,20})$`),
  signupSubmit: new RegExp(`^${CUSTOM_ID_NAMESPACE}:rss:(${RAID_ID}):(${ACTIVE_STATUS}):(${CHARACTER_KEY}):(${ROLE})$`),
});

export const ROSTER_CUSTOM_ID_PATTERN = new RegExp(
  `^${CUSTOM_ID_NAMESPACE}:roster:(${RAID_ID}):([a-z_]{2,24})$`,
);

export const RULES_CUSTOM_ID_PATTERN = new RegExp(
  `^${CUSTOM_ID_NAMESPACE}:r(?:ules)?:([a-z_]{2,24})(?::([A-Za-z0-9_:-]{1,80}))?$`,
);

/* ------------------------------------------------------------------ *
 * Маршрутизація для бота
 * ------------------------------------------------------------------ */

/**
 * Домени взаємодій. Бот не розбирає їх глибоко — йому досить знати, до якого
 * домену належить дія, щоб перевірити підпис, відкласти відповідь потрібного
 * типу і переслати запит у панель.
 */
export const INTERACTION_DOMAINS = Object.freeze({
  RAID_POLL: "raid-poll",
  RAID: "raid",
  ROSTER: "roster",
  RULES: "rules",
  APPLICATION: "application",
});

const DOMAIN_PREFIXES = [
  [`${CUSTOM_ID_NAMESPACE}:poll_`, INTERACTION_DOMAINS.RAID_POLL],
  [`${CUSTOM_ID_NAMESPACE}:roster:`, INTERACTION_DOMAINS.ROSTER],
  [`${CUSTOM_ID_NAMESPACE}:raid:`, INTERACTION_DOMAINS.RAID],
  [`${CUSTOM_ID_NAMESPACE}:rsc:`, INTERACTION_DOMAINS.RAID],
  [`${CUSTOM_ID_NAMESPACE}:rsr:`, INTERACTION_DOMAINS.RAID],
  [`${CUSTOM_ID_NAMESPACE}:rss:`, INTERACTION_DOMAINS.RAID],
  [`${CUSTOM_ID_NAMESPACE}:rmc:`, INTERACTION_DOMAINS.RAID],
  [`${CUSTOM_ID_NAMESPACE}:rms:`, INTERACTION_DOMAINS.RAID],
  [`${CUSTOM_ID_NAMESPACE}:rc:`, INTERACTION_DOMAINS.RAID],
  [`${CUSTOM_ID_NAMESPACE}:rr:`, INTERACTION_DOMAINS.RAID],
  [`${CUSTOM_ID_NAMESPACE}:rules:`, INTERACTION_DOMAINS.RULES],
  [`${CUSTOM_ID_NAMESPACE}:r:`, INTERACTION_DOMAINS.RULES],
];

/**
 * До якого домену належить `custom_id`.
 * @param {string} customId
 * @returns {string | null}
 */
export function interactionDomainFor(customId) {
  const value = String(customId || "").trim();
  if (!value.startsWith(`${CUSTOM_ID_NAMESPACE}:`)) return null;
  for (const [prefix, domain] of DOMAIN_PREFIXES) {
    if (value.startsWith(prefix)) return domain;
  }
  return null;
}

/**
 * Перевірка набору компонентів перед відправкою в Discord.
 *
 * Discord відхиляє повідомлення з однаковими `custom_id` помилкою 400, і саме
 * так одного разу зламався весь приватний пульт голосування: при рівно двох
 * сторінках кнопки «назад» і «вперед» вели на ту саму сторінку, а номер
 * сторінки входить у `custom_id`. Перевірка тут — щоб такий випадок падав
 * на тестах, а не на очах у гільдії.
 *
 * @param {Array<{components?: Array<{custom_id?: string}>}>} rows
 * @returns {{ok: boolean, duplicates: string[], tooLong: string[], rows: number}}
 */
export function validateInteractionComponents(rows) {
  const seen = new Set();
  const duplicates = [];
  const tooLong = [];
  const list = Array.isArray(rows) ? rows : [];

  for (const row of list) {
    for (const component of row?.components || []) {
      const customId = typeof component?.custom_id === "string" ? component.custom_id : "";
      if (!customId) continue;
      if (customId.length > CUSTOM_ID_MAX_LENGTH) tooLong.push(customId);
      if (seen.has(customId)) duplicates.push(customId);
      seen.add(customId);
    }
  }

  return {
    ok: duplicates.length === 0 && tooLong.length === 0 && list.length <= 5,
    duplicates,
    tooLong,
    rows: list.length,
  };
}
