export type ProblemKind = "technical" | "quota" | "access" | "auth" | "not-found";

export type ProblemStateCopy = {
  eyebrow: string;
  title: string;
  message: string;
  primaryLabel: string;
  secondaryLabel?: string;
};

export type LoadingStepState = "done" | "active" | "next";

export type LoadingStep = {
  label: string;
  detail: string;
  state: LoadingStepState;
};

export type LoadingStateCopy = {
  eyebrow: string;
  title: string;
  message: string;
  activeLabel: string;
  steps: LoadingStep[];
};

export const PROBLEM_STATES: Record<ProblemKind, ProblemStateCopy> = {
  quota: {
    eyebrow: "Захист Firebase",
    title: "Тимчасова технічна помилка",
    message:
      "Ми призупинили важкі читання й записи, бо сховище тимчасово обмежене або наблизилось до квоти. Спробуй пізніше — зайві запити зараз не запускаються.",
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

const baseSteps: LoadingStep[] = [
  {
    label: "Сесія",
    detail: "перевіряємо Discord-вхід",
    state: "done",
  },
  {
    label: "Доступ",
    detail: "звіряємо групу та дозволи",
    state: "active",
  },
  {
    label: "Firebase",
    detail: "читаємо потрібні записи без зайвих запитів",
    state: "next",
  },
  {
    label: "Сторінка",
    detail: "готуємо інтерфейс і дії",
    state: "next",
  },
];

function withActiveStep(steps: LoadingStep[], activeIndex: number) {
  return steps.map((step, index) => ({
    ...step,
    state: index < activeIndex ? "done" : index === activeIndex ? "active" : "next",
  })) satisfies LoadingStep[];
}

function loadingCopyForPath(pathname: string): LoadingStateCopy {
  if (pathname.startsWith("/rules/accept")) {
    return {
      eyebrow: "Правила гільдії",
      title: "Готуємо прийняття правил",
      message: "Перевіряємо Discord-підтвердження, актуальність ролі та стан профілю.",
      activeLabel: "Зараз: звіряємо Discord і привʼязки",
      steps: withActiveStep([
        {
          label: "Discord",
          detail: "перевіряємо персональне підтвердження",
          state: "done",
        },
        {
          label: "Роль",
          detail: "звіряємо сервер і актуальну роль",
          state: "active",
        },
        {
          label: "Профіль",
          detail: "читаємо збережені привʼязки й персонажів",
          state: "next",
        },
        {
          label: "Сторінка",
          detail: "готуємо доступні дії без зайвих блокувань",
          state: "next",
        },
      ], 1),
    };
  }

  if (pathname.startsWith("/profile")) {
    return {
      eyebrow: "Профіль",
      title: "Відкриваємо профіль",
      message: "Перевіряємо сесію, читаємо профіль і підтягуємо персонажів.",
      activeLabel: "Зараз: читаємо профіль з Firebase",
      steps: withActiveStep([
        baseSteps[0],
        {
          label: "Профіль",
          detail: "читаємо основні поля й налаштування",
          state: "active",
        },
        {
          label: "Персонажі",
          detail: "підтягуємо Battle.net / Raider.IO звʼязки",
          state: "next",
        },
        baseSteps[3],
      ], 1),
    };
  }

  if (pathname.startsWith("/raids")) {
    return {
      eyebrow: "Рейди",
      title: "Готуємо рейдову сторінку",
      message: "Читаємо рейд, склад, статуси запису та доступні дії.",
      activeLabel: "Зараз: синхронізуємо рейдові дані",
      steps: withActiveStep([
        baseSteps[0],
        {
          label: "Рейд",
          detail: "читаємо подію та склад",
          state: "active",
        },
        {
          label: "Запис",
          detail: "перевіряємо доступні кнопки й статус",
          state: "next",
        },
        baseSteps[3],
      ], 1),
    };
  }

  if (pathname.startsWith("/dashboard")) {
    return {
      eyebrow: "Адмін-панель",
      title: "Перевіряємо доступ до керування",
      message: "Звіряємо групу доступу, політики та потрібні адмін-дані.",
      activeLabel: "Зараз: перевіряємо права адміністратора",
      steps: withActiveStep([
        baseSteps[0],
        baseSteps[1],
        {
          label: "Політики",
          detail: "читаємо runtime-налаштування панелі",
          state: "next",
        },
        baseSteps[3],
      ], 1),
    };
  }

  if (pathname.startsWith("/guild")) {
    return {
      eyebrow: "Склад гільдії",
      title: "Завантажуємо склад",
      message: "Беремо оптимізовані записи складу чанками, без масового читання учасників.",
      activeLabel: "Зараз: читаємо оптимізовані guild records",
      steps: withActiveStep([
        baseSteps[0],
        {
          label: "Склад",
          detail: "читаємо memberChunks",
          state: "active",
        },
        {
          label: "Фільтри",
          detail: "готуємо ролі, класи та пошук",
          state: "next",
        },
        baseSteps[3],
      ], 1),
    };
  }

  return {
    eyebrow: "Панель гільдії",
    title: "Завантажуємо сторінку",
    message: "Перевіряємо сесію, доступ і потрібні дані для цього розділу.",
    activeLabel: "Зараз: перевіряємо доступ і дані сторінки",
    steps: baseSteps,
  };
}

export function resolveLoadingState(pathname?: string | null): LoadingStateCopy {
  return loadingCopyForPath(String(pathname || "/"));
}
