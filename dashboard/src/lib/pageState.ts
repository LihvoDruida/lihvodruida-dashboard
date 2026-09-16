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
    label: "База даних",
    detail: "читаємо потрібні записи з серверного сховища",
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

  if (pathname === "/profile" || pathname.startsWith("/profile/")) {
    return {
      eyebrow: "Профіль",
      title: "Відкриваємо профіль",
      message: "Перевіряємо сесію, читаємо профіль і підтягуємо персонажів.",
      activeLabel: "Зараз: читаємо профіль із серверної бази",
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


  if (pathname.startsWith("/profiles")) {
    return {
      eyebrow: "Профілі гільдії",
      title: "Збираємо каталог профілів",
      message: "Читаємо профілі, мейнів, Discord-привʼязки та готуємо фільтри каталогу.",
      activeLabel: "Зараз: формуємо каталог профілів",
      steps: withActiveStep([
        baseSteps[0],
        {
          label: "Профілі",
          detail: "читаємо доступні профілі та мейнів",
          state: "active",
        },
        {
          label: "Фільтри",
          detail: "готуємо ролі, Battle.net і сортування",
          state: "next",
        },
        baseSteps[3],
      ], 1),
    };
  }

  if (pathname.startsWith("/applications")) {
    return {
      eyebrow: "Заявки",
      title: "Відкриваємо журнал заявок",
      message: "Перевіряємо доступ, читаємо актуальні заявки та збираємо статуси Discord.",
      activeLabel: "Зараз: читаємо заявки",
      steps: withActiveStep([
        baseSteps[0],
        baseSteps[1],
        {
          label: "Заявки",
          detail: "завантажуємо записи та поточні статуси",
          state: "active",
        },
        baseSteps[3],
      ], 2),
    };
  }

  if (pathname.startsWith("/polls")) {
    return {
      eyebrow: "Рейд-пули",
      title: "Готуємо голосування",
      message: "Читаємо розклад, голоси, Discord-публікацію та доступні дії.",
      activeLabel: "Зараз: синхронізуємо дані рейд-пулу",
      steps: withActiveStep([
        baseSteps[0],
        {
          label: "Розклад",
          detail: "читаємо дні, час і стан публікації",
          state: "active",
        },
        {
          label: "Голоси",
          detail: "збираємо відповіді учасників",
          state: "next",
        },
        baseSteps[3],
      ], 1),
    };
  }

  if (pathname.startsWith("/roster")) {
    return {
      eyebrow: "Формування складу",
      title: "Готуємо склад рейду",
      message: "Читаємо актуальне формування, класи, ролі та Discord-параметри оголошення.",
      activeLabel: "Зараз: формуємо матрицю складу",
      steps: withActiveStep([
        baseSteps[0],
        {
          label: "Склад",
          detail: "читаємо зайняті класи та ролі",
          state: "active",
        },
        {
          label: "Discord",
          detail: "готуємо канал, теги та публікацію",
          state: "next",
        },
        baseSteps[3],
      ], 1),
    };
  }

  if (pathname.startsWith("/discord")) {
    return {
      eyebrow: "Discord",
      title: "Відкриваємо Discord-інструменти",
      message: "Перевіряємо інтеграцію, доступні ролі, канали та стан керування повідомленнями.",
      activeLabel: "Зараз: звіряємо Discord-інтеграцію",
      steps: withActiveStep([
        baseSteps[0],
        baseSteps[1],
        {
          label: "Discord API",
          detail: "читаємо канали, ролі та конфігурацію",
          state: "active",
        },
        baseSteps[3],
      ], 2),
    };
  }

  if (pathname.startsWith("/content")) {
    return {
      eyebrow: "Контент",
      title: "Готуємо редактор контенту",
      message: "Читаємо матеріали, таксономію та доступні медіа перед відкриттям редактора.",
      activeLabel: "Зараз: завантажуємо бібліотеку контенту",
      steps: withActiveStep([
        baseSteps[0],
        baseSteps[1],
        {
          label: "Матеріали",
          detail: "читаємо записи, категорії та медіа",
          state: "active",
        },
        baseSteps[3],
      ], 2),
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
      activeLabel: "Зараз: читаємо оптимізовані записи складу",
      steps: withActiveStep([
        baseSteps[0],
        {
          label: "Склад",
          detail: "читаємо оптимізовані записи складу",
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
    title: "Відкриваємо портал до розділу",
    message: "Синхронізуємо сесію, права доступу й потрібні серверні дані перед переходом.",
    activeLabel: "Зараз: стабілізуємо захищений канал",
    steps: baseSteps,
  };
}

export function resolveLoadingState(pathname?: string | null): LoadingStateCopy {
  return loadingCopyForPath(String(pathname || "/"));
}
