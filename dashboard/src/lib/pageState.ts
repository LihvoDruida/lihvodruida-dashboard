export type ProblemKind = "technical" | "quota" | "access" | "auth" | "not-found";

export type ProblemStateCopy = {
  eyebrow: string;
  title: string;
  message: string;
  primaryLabel: string;
  secondaryLabel?: string;
};

export const PROBLEM_STATES: Record<ProblemKind, ProblemStateCopy> = {
  quota: {
    eyebrow: "Захист сховища",
    title: "Тимчасова технічна помилка",
    message:
      "Ми призупинили важкі читання й записи, бо сховище тимчасово обмежене або спрацював захисний ліміт. Спробуй пізніше — зайві запити зараз не запускаються.",
    primaryLabel: "Оновити",
    secondaryLabel: "До панелі",
  },
  access: {
    eyebrow: "Доступ обмежено",
    title: "Немає доступу до розділу",
    message:
      "Поточна група доступу не має потрібного дозволу. Перевір Discord-роль, групу доступу або звернись до гільдмайстра.",
    primaryLabel: "До профілю",
    secondaryLabel: "До панелі",
  },
  auth: {
    eyebrow: "Потрібна авторизація",
    title: "Увійди ще раз",
    message:
      "Сесія застаріла або права доступу змінилися. Повторний вхід через Discord оновить профіль і дозволи.",
    primaryLabel: "Увійти",
    secondaryLabel: "До панелі",
  },
  "not-found": {
    eyebrow: "404",
    title: "Сторінку не знайдено",
    message:
      "Адреса неправильна, сторінку перенесли або профіль більше недоступний. Дані не змінювались.",
    primaryLabel: "До панелі",
    secondaryLabel: "До профілів",
  },
  technical: {
    eyebrow: "Технічний стан",
    title: "Тимчасова технічна помилка",
    message:
      "Сторінка не отримала дані безпечно. Ми не запускаємо повторні важкі запити, щоб не збільшувати навантаження. Онови сторінку або спробуй пізніше.",
    primaryLabel: "Повторити",
    secondaryLabel: "До панелі",
  },
};

export const TRANSIENT_STREAM_PROBLEM: ProblemStateCopy = {
  eyebrow: "Зʼєднання перервано",
  title: "Сторінка не встигла завантажитись",
  message:
    "Браузерний stream-запит обірвався. Дані не змінювались. Натисни повторити або онови сторінку.",
  primaryLabel: "Повторити",
  secondaryLabel: "До панелі",
};
