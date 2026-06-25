"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ToastTone = "info" | "success" | "warning" | "error";

type Toast = {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  ttl?: number;
};

const CHARACTER_STATUS_MESSAGES: Record<string, Omit<Toast, "id">> = {
  bnet_connected: {
    tone: "success",
    title: "Battle.net перевірено",
    message:
      "Свіжий список персонажів відкритий тимчасово. Можна додати гільдійних і інших персонажів, а у рейді вони будуть позначені окремо.",
    ttl: 7200,
  },
  bnet_no_characters: {
    tone: "warning",
    title: "Персонажів не знайдено",
    message:
      "Battle.net підключено, але список персонажів не повернувся. Перевір регіон, доступ wow.profile і повтори оновлення.",
    ttl: 8200,
  },
  bnet_no_guild_characters: {
    tone: "warning",
    title: "Гільдійних персонажів не знайдено",
    message:
      "Battle.net не підтвердив персонажів Mistblossom Vanguard, але інших персонажів можна додавати для запису в рейд із позначкою 🤝.",
    ttl: 8200,
  },
  bnet_failed: {
    tone: "error",
    title: "Battle.net не оновлено",
    message:
      "Battle.net не повернув список персонажів. Спробуй повторити вхід через Battle.net.",
    ttl: 9000,
  },
  bnet_duplicate_account: {
    tone: "error",
    title: "Battle.net заблоковано",
    message:
      "У цьому Battle.net списку є персонаж, який уже привʼязаний до іншого профілю. Тимчасовий список не збережено.",
    ttl: 9800,
  },
  bnet_state: {
    tone: "warning",
    title: "Battle.net авторизацію відхилено",
    message:
      "Сесія Battle.net застаріла або перевірка не пройшла. Запусти підключення Battle.net ще раз із цієї ж вкладки.",
    ttl: 7600,
  },
  geo_blocked: {
    tone: "error",
    title: "Доступ обмежено",
    message:
      "Авторизація або підключення Battle.net з цієї країни зараз недоступні правилами спільноти.",
    ttl: 9000,
  },
  character_added: {
    tone: "success",
    title: "Персонажа додано",
    message:
      "Персонажа додано до профілю. Якщо це перший персонаж у профілі, він автоматично стає мейном.",
  },
  characters_added: {
    tone: "success",
    title: "Персонажів додано",
    message:
      "Вибрані персонажі збережені у профілі. Додані записи прибрано з тимчасового Battle.net списку.",
    ttl: 7200,
  },
  characters_added_partial: {
    tone: "warning",
    title: "Додано не всіх персонажів",
    message:
      "Частина персонажів збережена, а частина пропущена: зазвичай це дублікати або застарілий тимчасовий список. Перевір список збережених персонажів нижче.",
    ttl: 8200,
  },
  characters_bulk_empty: {
    tone: "warning",
    title: "Немає вибраних персонажів",
    message:
      "Познач хоча б одного персонажа у тимчасовому Battle.net списку або натисни “Додати всі”.",
  },
  characters_bulk_noop: {
    tone: "warning",
    title: "Нічого не додано",
    message:
      "Запит оброблено, але нових персонажів не додано. Найчастіше всі вибрані вже були збережені або список змінився після перевірки.",
    ttl: 7600,
  },
  characters_bulk_no_verified: {
    tone: "error",
    title: "Немає коректних персонажів",
    message:
      "У вибраному Battle.net списку немає персонажів, які можна зберегти. Онови список через Battle.net і повтори дію.",
    ttl: 9000,
  },
  characters_bulk_all_duplicates: {
    tone: "warning",
    title: "Усі вибрані вже додані",
    message:
      "Ці персонажі вже є у профілі. Повторно вони не додаються — це захист від дублікатів.",
    ttl: 7600,
  },
  character_add_failed: {
    tone: "error",
    title: "Персонажа не додано",
    message: "Персонажа не вдалося зберегти. Онови сторінку і повтори дію.",
    ttl: 9000,
  },
  character_add_duplicate: {
    tone: "warning",
    title: "Персонаж уже є в профілі",
    message:
      "Повторний запис не створюється. Якщо хочеш оновити список, спочатку пройди Battle.net реавторизацію або видали старий запис.",
    ttl: 7000,
  },
  character_add_conflict: {
    tone: "error",
    title: "Персонаж уже привʼязаний",
    message:
      "Цей персонаж уже є в іншому профілі. Додавання заблоковано, щоб не створювати дублікати акаунтів.",
    ttl: 9800,
  },
  character_add_invalid: {
    tone: "error",
    title: "Некоректний персонаж",
    message:
      "Дані персонажа застаріли або пошкоджені. Онови сторінку профілю і натисни кнопку додавання ще раз.",
    ttl: 7600,
  },
  character_add_not_guild: {
    tone: "error",
    title: "Персонажа не додано",
    message:
      "Дані персонажа не пройшли Battle.net перевірку або застаріли. Онови список через Battle.net і повтори дію.",
    ttl: 9000,
  },
  character_add_profile_missing: {
    tone: "error",
    title: "Профіль не знайдено",
    message:
      "Сесія активна, але профіль ще не створився. Вийди й увійди через Discord, потім повтори Battle.net перевірку.",
    ttl: 9200,
  },
  character_add_firebase_unconfigured: {
    tone: "error",
    title: "Збереження профілів недоступне",
    message:
      "Сервер тимчасово не може зберігати профілі. Звернись до гільдмайстра або повтори пізніше.",
    ttl: 9200,
  },
  character_add_firebase_failed: {
    tone: "error",
    title: "Персонажа не збережено",
    message: "Профіль не вдалося оновити. Онови сторінку і повтори дію.",
    ttl: 9200,
  },
  character_reauth_required: {
    tone: "warning",
    title: "Потрібна свіжа Battle.net перевірка",
    message:
      "Тимчасовий список персонажів відсутній або застарів. Натисни “Оновити персонажів”, пройди Battle.net і додавай персонажа одразу після повернення.",
    ttl: 8600,
  },
  character_removed: {
    tone: "success",
    title: "Персонажа видалено",
    message:
      "Запис прибрано з профілю. Якщо це був мейн, система автоматично вибере наступного доступного персонажа.",
    ttl: 6800,
  },
  character_remove_failed: {
    tone: "error",
    title: "Не вдалося видалити персонажа",
    message: "Запис не видалено. Онови сторінку і повтори дію.",
    ttl: 8600,
  },
  character_remove_invalid: {
    tone: "error",
    title: "Некоректний запит видалення",
    message:
      "Дані персонажа застаріли або пошкоджені. Онови сторінку профілю і повтори дію.",
    ttl: 7600,
  },
  character_remove_profile_missing: {
    tone: "error",
    title: "Профіль для видалення не знайдено",
    message:
      "Не вдалося знайти профіль поточної сесії. Увійди через Discord ще раз.",
    ttl: 8600,
  },
  character_remove_firebase_unconfigured: {
    tone: "error",
    title: "Профіль недоступний для видалення",
    message:
      "Сервер тимчасово не може змінювати список персонажів. Звернись до гільдмайстра або повтори пізніше.",
    ttl: 8600,
  },
  main_character_set: {
    tone: "success",
    title: "Мейн оновлено",
    message:
      "Цей персонаж тепер використовується як основний для сайту, рейдових правил та інтеграцій Discord.",
  },
  main_character_failed: {
    tone: "error",
    title: "Мейна не змінено",
    message:
      "Не вдалося зберегти мейн-персонажа. Онови сторінку і повтори дію.",
    ttl: 8600,
  },
  main_character_invalid: {
    tone: "error",
    title: "Некоректний мейн-персонаж",
    message:
      "Дані персонажа застаріли. Онови сторінку і натисни “Зробити мейном” ще раз.",
    ttl: 7600,
  },
  main_character_missing: {
    tone: "warning",
    title: "Спочатку додай персонажа",
    message:
      "Мейна можна вибрати тільки серед персонажів, уже збережених у профілі.",
    ttl: 7600,
  },
  main_character_profile_missing: {
    tone: "error",
    title: "Профіль для мейна не знайдено",
    message:
      "Не вдалося знайти твій профіль. Вийди й увійди через Discord, потім повтори дію.",
    ttl: 8600,
  },
  main_character_firebase_unconfigured: {
    tone: "error",
    title: "Профіль недоступний для мейна",
    message:
      "Сервер тимчасово не може зберегти мейн-персонажа. Звернись до гільдмайстра або повтори пізніше.",
    ttl: 8600,
  },
  raid_role_set: {
    tone: "success",
    title: "Роль у рейді збережено",
    message:
      "Під час запису на рейд система використовуватиме вибрану роль замість ролі зі спеки мейна.",
    ttl: 6800,
  },
  raid_role_auto: {
    tone: "success",
    title: "Авто-роль увімкнено",
    message: "Під час запису на рейд роль знову братиметься зі спеки мейна.",
    ttl: 6800,
  },
  raid_role_invalid: {
    tone: "error",
    title: "Некоректна роль",
    message: "Можна вибрати тільки авто, танка, хіла або ДД.",
    ttl: 7600,
  },
  raid_role_main_missing: {
    tone: "warning",
    title: "Спочатку вибери мейна",
    message:
      "Роль у рейді привʼязується до мейна. Додай персонажа й зроби його основним.",
    ttl: 7600,
  },
  raid_role_failed: {
    tone: "error",
    title: "Роль у рейді не збережено",
    message: "Профіль не вдалося оновити. Онови сторінку і повтори дію.",
    ttl: 8600,
  },
  profile_name_saved: {
    tone: "success",
    title: "Імʼя збережено",
    message:
      "Профільне імʼя оновлено. Тепер можна синхронізувати серверне імʼя в Discord.",
    ttl: 6200,
  },
  profile_name_mode_saved: {
    tone: "success",
    title: "Формат імені збережено",
    message:
      "Панель тепер використовує вибраний формат у профілі, рейдах, авторах і списках.",
    ttl: 6200,
  },
  profile_gender_saved: {
    tone: "success",
    title: "Звертання збережено",
    message:
      "Персональні повідомлення сайту та Discord тепер використовуватимуть вибрану форму.",
    ttl: 6200,
  },
  profile_gender_failed: {
    tone: "error",
    title: "Звертання не збережено",
    message: "Профіль не вдалося оновити. Онови сторінку і повтори дію.",
    ttl: 8600,
  },
  profile_nickname_characters_saved: {
    tone: "success",
    title: "Альти для ніку збережено",
    message:
      "Discord nickname тепер братиме мейна і вибрані два альти за шаблоном з адмін-панелі.",
    ttl: 6200,
  },
  profile_nickname_characters_failed: {
    tone: "error",
    title: "Альти не збережено",
    message:
      "Не вдалося оновити персонажів для Discord nickname. Онови сторінку і повтори дію.",
    ttl: 8600,
  },
  profile_name_invalid: {
    tone: "warning",
    title: "Імʼя не збережено",
    message:
      "Вкажи нормальне імʼя від 2 до 32 символів без зайвих спецсимволів.",
    ttl: 7600,
  },
  profile_name_failed: {
    tone: "error",
    title: "Імʼя не збережено",
    message: "Профіль не вдалося оновити. Онови сторінку і повтори дію.",
    ttl: 8600,
  },
  discord_nick_synced: {
    tone: "success",
    title: "Discord імʼя оновлено",
    message:
      "Серверний nickname змінено за стандартом профілю: імʼя, мейн і до двох вибраних альтів.",
    ttl: 7200,
  },
  discord_nick_synced_short: {
    tone: "success",
    title: "Discord імʼя оновлено",
    message:
      "Nickname застосовано. Через ліміт Discord у 32 символи список персонажів було скорочено, але мейн залишився у пріоритеті.",
    ttl: 8200,
  },
  discord_nick_name_missing: {
    tone: "warning",
    title: "Спочатку вкажи імʼя",
    message:
      "Для стандартизації Discord nickname потрібно зберегти поле “Імʼя” у профілі.",
    ttl: 7600,
  },
  discord_nick_not_discord: {
    tone: "warning",
    title: "Потрібен Discord-профіль",
    message:
      "Серверний nickname можна змінити тільки для акаунта, який увійшов через Discord.",
    ttl: 7600,
  },
  discord_nick_profile_missing: {
    tone: "error",
    title: "Профіль не знайдено",
    message:
      "Не вдалося знайти профіль для синхронізації Discord імені. Увійди ще раз.",
    ttl: 8600,
  },
  discord_nick_owner: {
    tone: "warning",
    title: "Для власника — вручну",
    message:
      "Discord не дозволяє змінювати імʼя власника сервера автоматично. Скопіюй готовий формат у профілі й встанови його вручну.",
    ttl: 9800,
  },
  discord_nick_hierarchy: {
    tone: "warning",
    title: "Discord не дозволив зміну",
    message:
      "Зазвичай причина — роль користувача вища або на одному рівні з роллю, яка виконує зміну. Скопіюй готовий формат або звернись до гільдмайстра.",
    ttl: 9800,
  },
  discord_nick_failed: {
    tone: "error",
    title: "Discord імʼя не оновлено",
    message:
      "Discord не дозволив автоматично змінити серверне імʼя. Скопіюй готовий формат або звернись до гільдмайстра.",
    ttl: 9200,
  },
  rate_limit: {
    tone: "warning",
    title: "Забагато дій",
    message:
      "Зачекай кілька хвилин і повтори спробу. Це захист від дублювання дій.",
  },
};
const LOGIN_ERROR_MESSAGES: Record<string, Omit<Toast, "id">> = {
  rate_limit: {
    tone: "warning",
    title: "Забагато спроб входу",
    message: "Зачекай кілька хвилин і повтори авторизацію.",
  },
  token: {
    tone: "error",
    title: "Вхід не виконано",
    message: "Резервний ключ недійсний або застарів.",
  },
  session_required: {
    tone: "warning",
    title: "Потрібен вхід",
    message: "Увійди в акаунт, щоб продовжити дію.",
  },
  discord_only: {
    tone: "warning",
    title: "Доступ через Discord",
    message: "Для входу в панель використовується Discord.",
  },
  oauth_state: {
    tone: "warning",
    title: "Вхід Discord не завершився",
    message:
      "Спробуй авторизуватися ще раз. Паралельні входи з різних вкладок тепер не мають блокувати один одного.",
  },
  oauth_failed: {
    tone: "error",
    title: "Авторизація не вдалася",
    message:
      "Спробуй повторити вхід через Discord. Якщо помилка лишиться — звернись до гільдмайстра.",
  },
  access_denied: {
    tone: "error",
    title: "Доступ заборонено",
    message: "У цього акаунта немає потрібної ролі.",
  },
  discord_banned: {
    tone: "error",
    title: "Вхід заблоковано",
    message:
      "Цей Discord-акаунт знаходиться в бані на сервері. Профіль не активовано.",
  },
  not_guild_member: {
    tone: "error",
    title: "Профіль видалено",
    message:
      "Цього Discord-акаунта вже немає серед учасників сервера, тому його профіль видалено.",
  },
  duplicate_characters: {
    tone: "error",
    title: "Вхід заблоковано",
    message:
      "У профілі знайдено персонажів, які вже привʼязані до іншого акаунта. Потрібна перевірка офіцером.",
  },
  security_check_failed: {
    tone: "error",
    title: "Вхід не перевірено",
    message:
      "Не вдалося виконати серверну перевірку бану або членства в Discord. Спробуй пізніше або звернись до гільдмайстра.",
  },
  geo_blocked: {
    tone: "error",
    title: "Доступ обмежено",
    message: "Авторизація з цієї країни зараз недоступна правилами спільноти.",
  },
};

const TOAST_QUERY_KEYS = [
  "characterStatus",
  "toast",
  "notice",
  "success",
  "error",
  "published",
  "updated",
  "deleted",
  "created",
  "saved",
  "warning",
  "attendance",
];
const FLASH_TOAST_COOKIE = "dashboard_toast";

function toneIcon(tone: ToastTone) {
  if (tone === "success") return "✓";
  if (tone === "warning") return "!";
  if (tone === "error") return "×";
  return "✦";
}

function createId(prefix = "toast") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanMessage(value: string | null | undefined, limit = 360) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function toastFromAttendance(value: string | null): Toast | null {
  const action = cleanMessage(value, 32);
  if (!action) return null;
  if (action === "going")
    return {
      id: createId("attendance"),
      tone: "success",
      title: "Запис оновлено",
      message: "Тебе записали на рейд. Склад оновлено.",
      ttl: 6200,
    };
  if (action === "late")
    return {
      id: createId("attendance"),
      tone: "success",
      title: "Запис оновлено",
      message: "Позначено, що ти затримаєшся. Склад оновлено.",
      ttl: 6200,
    };
  if (action === "tentative")
    return {
      id: createId("attendance"),
      tone: "success",
      title: "Запис оновлено",
      message: "Тебе записали 50/50. За потреби запис піде в лаву запасних після сірого списку.",
      ttl: 7200,
    };
  if (action === "skipped")
    return {
      id: createId("attendance"),
      tone: "success",
      title: "Запис оновлено",
      message: "Позначено, що ти пропускаєш рейд.",
      ttl: 6200,
    };
  return null;
}

function normalizeToastTone(value: unknown): ToastTone {
  return value === "success" ||
    value === "warning" ||
    value === "error" ||
    value === "info"
    ? value
    : "info";
}

function toastFromCookie(): Toast[] {
  if (typeof document === "undefined") return [];

  const raw = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(FLASH_TOAST_COOKIE + "="));

  if (!raw) return [];

  try {
    const value = decodeURIComponent(raw.slice(FLASH_TOAST_COOKIE.length + 1));
    const parsed = JSON.parse(value) as Partial<Toast> | Partial<Toast>[];
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items
      .map(
        (item): Toast => ({
          id: createId("flash"),
          tone: normalizeToastTone(item.tone),
          title: cleanMessage(item.title, 96),
          message: cleanMessage(item.message, 520),
          ttl: typeof item.ttl === "number" ? item.ttl : undefined,
        }),
      )
      .filter((item) => Boolean(item.title));
  } catch {
    return [];
  }
}

function clearToastCookie() {
  if (typeof document === "undefined") return;
  document.cookie = FLASH_TOAST_COOKIE + "=; Path=/; Max-Age=0; SameSite=Lax";
}

function toastFromSearchParams(
  params: URLSearchParams,
  options: { includeError?: boolean } = {},
): Toast[] {
  const result: Toast[] = [];
  const includeError = options.includeError !== false;
  const characterStatus = cleanMessage(params.get("characterStatus"));
  if (characterStatus && CHARACTER_STATUS_MESSAGES[characterStatus]) {
    result.push({
      id: createId("character"),
      ...CHARACTER_STATUS_MESSAGES[characterStatus],
    });
  }

  const rawError = includeError ? cleanMessage(params.get("error")) : "";
  if (rawError) {
    result.push({
      id: createId("error"),
      ...(LOGIN_ERROR_MESSAGES[rawError] || {
        tone: "error",
        title: "Дію не виконано",
        message: rawError,
      }),
    });
  }

  const rawSuccess = cleanMessage(params.get("success"));
  if (rawSuccess) {
    result.push({
      id: createId("success"),
      tone: "success",
      title: "Готово",
      message: rawSuccess,
    });
  }

  const attendanceToast = toastFromAttendance(params.get("attendance"));
  if (attendanceToast) result.push(attendanceToast);

  const rawPublished = cleanMessage(params.get("published"));
  if (rawPublished) {
    const isDiscord =
      /^https?:\/\/discord(?:app)?\.com\//i.test(rawPublished) ||
      rawPublished.includes("discord.com/channels/");
    result.push({
      id: createId("published"),
      tone: "success",
      title: isDiscord
        ? "Discord повідомлення опубліковано"
        : "Матеріал опубліковано",
      message: isDiscord ? "Оголошення доступне в Discord." : rawPublished,
      ttl: 6800,
    });
  }

  const rawUpdated = cleanMessage(params.get("updated") || params.get("saved"));
  if (rawUpdated) {
    const isDiscord =
      /^https?:\/\/discord(?:app)?\.com\//i.test(rawUpdated) ||
      rawUpdated.includes("discord.com/channels/");
    result.push({
      id: createId("updated"),
      tone: "success",
      title: isDiscord ? "Discord повідомлення оновлено" : "Зміни збережено",
      message: isDiscord ? "Оголошення в Discord оновлено." : rawUpdated,
      ttl: 6800,
    });
  }

  const rawDeleted = cleanMessage(params.get("deleted"));
  if (rawDeleted) {
    result.push({
      id: createId("deleted"),
      tone: "success",
      title: "Видалено",
      message: rawDeleted,
      ttl: 6200,
    });
  }

  const rawCreated = cleanMessage(params.get("created"));
  if (rawCreated) {
    result.push({
      id: createId("created"),
      tone: "success",
      title: "Створено",
      message: rawCreated,
      ttl: 6200,
    });
  }

  const rawWarning = cleanMessage(params.get("warning"));
  if (rawWarning) {
    result.push({
      id: createId("warning"),
      tone: "warning",
      title: "Потрібна увага",
      message: rawWarning,
      ttl: 7200,
    });
  }

  const rawNotice = cleanMessage(params.get("notice") || params.get("toast"));
  if (rawNotice) {
    result.push({
      id: createId("notice"),
      tone: "info",
      title: "Повідомлення",
      message: rawNotice,
    });
  }

  return result;
}

function sanitizeToasts(toasts: Toast[]) {
  const seen = new Set<string>();
  return toasts.filter((toast) => {
    const key = `${toast.tone}:${toast.title}:${toast.message || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function GlobalToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, number>>(new Map());
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const searchKey = useMemo(() => searchParams.toString(), [searchParams]);

  const removeToast = (id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const pushToast = (toast: Omit<Toast, "id"> | Toast) => {
    const item = "id" in toast ? toast : { id: createId(), ...toast };
    setToasts((current) => sanitizeToasts([item, ...current]).slice(0, 4));

    const ttl = item.ttl ?? (item.tone === "error" ? 7200 : 5200);
    const timer = window.setTimeout(() => removeToast(item.id), ttl);
    timers.current.set(item.id, timer);
  };

  useEffect(() => {
    const next = [
      ...toastFromCookie(),
      ...toastFromSearchParams(new URLSearchParams(searchKey), {
        includeError: pathname !== "/login",
      }),
    ];
    if (!next.length) return;

    next.forEach(pushToast);
    clearToastCookie();

    const cleaned = new URLSearchParams(searchKey);
    let changed = false;
    const toastQueryKeys =
      pathname === "/login"
        ? TOAST_QUERY_KEYS.filter((key) => key !== "error")
        : TOAST_QUERY_KEYS;
    toastQueryKeys.forEach((key) => {
      if (cleaned.has(key)) {
        cleaned.delete(key);
        changed = true;
      }
    });

    if (changed) {
      const nextUrl = cleaned.toString() ? `${pathname}?${cleaned}` : pathname;
      window.setTimeout(() => router.replace(nextUrl, { scroll: false }), 60);
    }
  }, [pathname, router, searchKey]);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<Partial<Toast>>).detail || {};
      pushToast({
        tone: normalizeToastTone(detail.tone),
        title: cleanMessage(detail.title) || "Обробка дії",
        message: cleanMessage(detail.message),
        ttl: typeof detail.ttl === "number" ? detail.ttl : undefined,
      });
    }

    window.addEventListener("dashboard:toast", onToast as EventListener);
    return () => {
      window.removeEventListener("dashboard:toast", onToast as EventListener);
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    };
  }, []);

  if (!toasts.length) return null;

  return (
    <aside
      className="global-toast-stack"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Сповіщення панелі"
    >
      {toasts.map((toast) => (
        <article
          className={`global-toast global-toast--${toast.tone}`}
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-atomic="true"
        >
          <span className="global-toast__icon" aria-hidden="true">
            {toneIcon(toast.tone)}
          </span>
          <span className="global-toast__body">
            <strong>{toast.title}</strong>
            {toast.message ? <small>{toast.message}</small> : null}
          </span>
          <button
            className="global-toast__close"
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label="Закрити повідомлення"
          >
            ×
          </button>
        </article>
      ))}
    </aside>
  );
}
