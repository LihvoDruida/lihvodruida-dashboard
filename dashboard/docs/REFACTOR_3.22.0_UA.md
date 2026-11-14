# Dashboard 3.22.0 — аудит і рефакторинг

Дата: 14.11.2026. База: наданий dashboard.zip, Dashboard 3.21.0.

## Аналіз перед змінами

Прочитано dashboard/docs/CSS_AUDIT.md, MANAGEMENT_UI.md, STYLE_AUDIT.md,
UI_SYSTEM.md, package.json, next.config.mjs і .env.example. Архів містить
монорепозиторій: dashboard/, shared/, bot/, deploy/ та документацію.
Збережено PostgreSQL, Discord OAuth, shared-контракт, Next.js 16.3.5,
React 19.2.8, відеофон входу, рейди, заявки та інтеграції.

Попередні документи містять історичні лічильники й обмеження перевірки.
Поточний проєкт: 420 TS/TSX-файлів, 45 сторінок, 124 API route-файли.
Статичний аудит не є доказом візуальної коректності чи повним пентестом.

## Архітектура

| Каталог | Відповідальність |
| --- | --- |
| src/app/ | App Router, Server Components, API, авторизація кожної операції |
| src/app/dashboard/layout.tsx | Додаткова перевірка сесії та входу в керування |
| src/components/management/ | Єдиний ManagementShell для 10 адміністративних сторінок |
| src/components/ui/ | Button, FormField, DataTable |
| src/components/content/, static/ | Доменні інтерфейси |
| src/lib/auth/ | Підпис cookie й актуалізація серверних дозволів |
| src/lib/navigation/ | Єдиний каталог меню та швидких дій |
| src/lib/db/ | PostgreSQL і document-store adapter |
| src/lib/ | Доменні серверні сервіси, політики й чисті функції |
| src/hooks/ | useActionFocus, useDashboardRequests, useRaidPollMutation |
| src/types/ | Спільні типи сесій без серверних імпортів |
| src/app/styles/ | Токени, база, компоненти, доменні стилі |

Доменні сервіси залишено в lib/: масове перейменування 100+ модулів саме по
собі не прискорює застосунок і не покращує ізоляцію. Серверні модулі авторизації
позначені server-only; клієнт отримує лише потрібні серіалізовані дані.

## Меню та UX

На desktop навігація керування розташована в бічній колонці 232px,
а робоча область — у fluid-колонці. Нижче 1000px навігація розташована над
контентом; нижче 640px посилання переносяться. Вкладені редактори реагують
на ширину власного контейнера, а не лише на розмір екрана.

Групи: «Доступ і права» (огляд, авторизація, групи), «Discord та учасники»
(учасники, модерація, профілі, привітання, Статик), «Система» (журнали, сервер).
Каталог management.ts визначає видимість меню й дії огляду. Група з правом
лише на журнали тепер також бачить вхід у керування в глобальному меню.

## Матриця доступу

Наведені нижче — стандартні стартові групи. Уже збережені права груп не
перезаписуються цим релізом. Нові групи можуть мати власний ранг і набір прав.
Найвищий ранг серед явно зіставлених Discord-ролей обирає одну групу;
права різних груп не об'єднуються.

| Суб'єкт | Доступ |
| --- | --- |
| Власник Discord | Усі дозволи, якщо політика дозволяє виняток власника; сервер, Welcome та руйнівні службові операції |
| Адмін, група 1 | Явні права групи; стандартна нова група має всі permission keys; службові owner-only операції потребують власника |
| Модератор, група 2 | Стандартно заявки, приватні поля заявок, оголошення, рейди, склад і профілі |
| Наставник, група 3 | Стандартно перегляд заявок, рейдів, складу й профілів своєї групи та нижче |
| Учасник, група 99 | Власний профіль та стандартні дозволи перегляду рейдів, складу й профілів своєї групи та нижче |
| Довільна група з groups.view | Перегляд таблиці груп без редактора; POST і Server Actions редагування заборонені |
| Неавторизований відвідувач | Лише явно публічні сторінки та санітизовані API; внутрішні API потребують окремого bearer/підпису |

Назва ролі admin, moderator чи mentor сама по собі нічого не дозволяє.
Для делегованого права потрібні dashboard.view та відповідний permission key.
Для groups.manage також збережено вимогу адміністративної ролі.
Повний каталог із назвами та описами: src/lib/accessGroupSchema.ts.

## Безпека: реалізована поведінка

1. Proxy перевіряє HMAC, audience, provider, role, exp/iat і розмір cookie.
   Підроблена непорожня cookie більше не проходить початковий шлюз.
   Виправлено розпізнавання /raids/new, /raids/bench-priority та /polls/new:
   вони більше не класифікуються як публічні сторінки конкретного запису.
2. getStoredSession перевіряє production revocation у PostgreSQL.
   React cache об'єднує ці читання лише в межах одного серверного рендеру.
3. getSession перевіряє членство Discord за чинним обмеженим live-кешем,
   після чого читає групи й roleGroupMappings із PostgreSQL без fallback-прав.
   Видалена група, видалена відповідність чи відсутній dashboard.view
   блокують сесію. Помилка читання політики/каталогу також блокує доступ.
4. Discord-членство має існуючий TTL: типово 90 секунд, налаштовується через
   DISCORD_LIVE_ACCESS_SYNC_SECONDS. Під час збоїв діє обмежене grace-вікно
   останнього підтвердженого членства. Це не обіцянка миттєвого відкликання
   Discord-ролі. PostgreSQL-дозволи повторно читаються на кожен запит.
5. Порожній масив permissions більше не відновлює типові права. Фонова
   ініціалізація системних груп не додає назад дозволи, які адміністратор прибрав.
6. permissions.ts — спільний механізм прав для серверних перевірок і видимості UI;
   accessGroups.ts реекспортує його замість іншої реалізації.
7. Захист API й Server Actions збережено незалежно від layout і Proxy:
   handlers перевіряють права, а чутливі операції — власника, Origin,
   ліміти запиту, частоту й актуальність даних. Публічні bridge/signature/bearer
   маршрути не переведені на browser session і зберігають окремі контракти.
8. Старі GitHub-сесії відхиляються; історичні профілі не видаляються автоматично.
   Аварійний token-login залишається вимкненим чинною політикою.
9. Прибрано createSessionCookie, що без явної ролі створював Local admin.
   Генерація нормальних Discord-сесій і createSessionToken збережені.
10. next.config.mjs більше не містить ignoreBuildErrors: true.
    Звичайний production build також перевіряє TypeScript.

Для основних змін прав достатньо поточної схеми document-store; нових таблиць
або автоматичних руйнівних SQL-міграцій цей реліз не вимагає.

## Дизайн-система

ManagementShell замінює дубльовану геометрію 10 сторінок. Button підтримує
tone, small, disabled, busy, type і React 19 ref. FormField пов'язує label,
hint та error з input через id/aria-describedby, має maxLength. DataTable
містить caption, scope=col, region і горизонтальне прокручування.

Поверхні та звичайні контроли використовують --card-radius, --control-radius,
--control-height, --space-* та спільні семантичні кольори. Прибрано локальне
перевизначення всіх admin .btn на іншу висоту й radius. Статичні inline-стилі
Welcome і редакції контенту перенесені в shared CSS / AdminPageHeader.
Динамічні значення ширини progress, графіків і кольорів персонажів залишено:
це runtime-дані, а не копії статичних CSS-правил.

## Видалення та переміщення

Видалено 26 асетів без runtime-споживачів:

- `public/assets/icons/profile/home.svg`
- `public/assets/icons/profile/link.svg`
- `public/assets/icons/profile/shield.svg`
- `public/assets/icons/profile/plus.svg`
- `public/assets/icons/profile/check.svg`
- `public/assets/icons/profile/group.svg`
- `public/assets/icons/profile/sync.svg`
- `public/assets/icons/profile/crown.svg`
- `public/assets/icons/profile/calendar.svg`
- `public/assets/icons/profile/leaf.svg`
- `public/assets/icons/profile/user.svg`
- `public/assets/icons/profile/logout.svg`
- `public/assets/icons/profile/gear.svg`
- `public/assets/icons/profile/swords.svg`
- `public/assets/icons/character-card/guild-leaf.svg`
- `public/assets/icons/character-card/main-star.svg`
- `public/assets/icons/character-card/external-link.svg`
- `public/assets/icons/character-card/updated-clock.svg`
- `public/assets/icons/character-card/item-level.svg`
- `public/assets/icons/character-card/crown.svg`
- `public/assets/icons/character-card/non-guild-members.svg`
- `public/assets/icons/character-card/level-shield.svg`
- `public/assets/icons/character-card/rio-chart.svg`
- `public/assets/icons/character-card/trash.svg`
- `public/assets/img/profile/profile-sidebar-emblem.svg`
- `public/assets/img/ui/guild-hero-bg.png`

Інші видалення:

- vendor/node-domexception/index.cjs та package.json: Node 24 має native DOMException;
  npm explain підтвердив відсутність транзитивних споживачів цього shim.
- Пряму dependency node-domexception і відповідний override/COPY у Dockerfile.
- Невикористовуваний override uuid (у lock-файлі немає його споживачів).
- Прямі devDependencies @eslint/eslintrc та @eslint/js: їх використовує сам ESLint
  як транзитивні залежності; dashboard їх не імпортує.
- Невикористовувану функцію createSessionCookie та її реекспорт.
- Мертвий селектор .server-status-container і дубльовані admin control overrides.
- Старі шляхи трьох hooks: реалізації перенесені в src/hooks/ з оновленням імпортів.

Тестові fixtures у scripts/ залишені: вони використовуються перевірками й не
підключені як runtime-профілі. Рейдові зображення й відео не видалялися:
частина адрес формується динамічно. Невикористовуваних TS/TSX-компонентів,
які можна було б підтверджено видалити за графом імпортів, не виявлено.

У наданому архіві немає живого каталогу користувачів або доступу до production
PostgreSQL. Реальні/тестові акаунти з БД цим завданням фізично не видалені.
Для цього залишається owner-only /dashboard/profiles із актуальним preview,
перевіркою того самого власника, строком preview й підтвердженням видалення.
Не застосовуйте видалення лише за схожістю імені на test/demo.

## Перевірка та впровадження

Повний код кожної зміни міститься в архіві; кодових плейсхолдерів немає.
Зберігайте весь монорепозиторій: file:../shared потрібний ще до npm ci.
Не накладайте архів на старі каталоги без урахування видалень: використайте
чистий checkout/каталог релізу, збережіть чинні .env.production та дані PostgreSQL.

```bash
cd dashboard
npm ci
npm run verify
npm run build
npm run check:standalone
```

Встановлення production Docker-стека описано в кореневих docs/DEPLOYMENT.md
та docs/RELEASE_INSTALL_2026-10-19_UA.md. Зміни не розгорнуто на VPS.
Після розгортання власник має перевірити актуальні roleGroupMappings і права
наявних груп: порожні/пошкоджені права тепер коректно блокують вхід.

check:rbac входить у verify та build:ci. Він виконує 15 поведінкових сценаріїв:
явні права, відкликання, deleted/empty groups, збій БД, старі провайдери,
імперсонацію, HMAC/expiry та реальний Proxy для приватних/публічних маршрутів.
Існуючі тести оновлено під нові шляхи, спільний каталог і async Proxy.
Позитивні тестові сесії мають явні дозволи; перевірки відмови збережено.

Додано check:management-browser: він рендерить справжні Shell, AdminTabs,
ManagementSections і UI-примітиви з синтетичними даними на 1440/1024/768/390px,
перевіряє overflow, клавіатуру, збереження вводу й read-only меню.
Цей браузерний прогін НЕ виконаний успішно в поточному середовищі:
Chromium блокується на створенні службового Unix-сокета (Operation not permitted).
Тому візуальна коректність та live OAuth/Discord/production PostgreSQL потребують
окремого staging-прогону. Успішну компіляцію не видаємо за ці перевірки.

Для окремого браузерного прогону потрібні Playwright, esbuild і Chromium;
вони не додані до production dependencies. Шляхи можна передати через
MISTBLOSSOM_QA_MODULES і MISTBLOSSOM_QA_CHROMIUM, як в інших browser-скриптах.

Нормативна довідка: https://nextjs.org/docs/app/guides/authentication
та https://nextjs.org/docs/app/api-reference/file-conventions/proxy —
Proxy не замінює перевірки в кожному Server Function / data-access operation.

## Підсумковий протокол виконання

| Перевірка | Результат |
| --- | --- |
| npm ci | PASS, 462 пакети |
| npm run verify | PASS, 103 групи перевірок |
| npm run check:rbac | PASS, 15/15 |
| npm run lint | PASS |
| npm run typecheck | PASS |
| npm run build | PASS, Next.js 16.3.5 + semantic TypeScript |
| npm run check:standalone | PASS, 10/10, включно зі стартом пакетованого сервера |
| audit:styles / check:design-tokens / audit:ui | PASS |
| Пошук назв SESSION_SECRET, DISCORD_OAUTH_CLIENT_SECRET, DATABASE_URL, INTERNAL_API_TOKEN у .next/static JS | Збігів немає |
| check:management-browser | BLOCKED середовищем, успішного візуального прогону немає |
| Production DB / OAuth / Discord / VPS deploy | Не виконувалися: немає живої конфігурації |

Пошук назв секретів є додатковою перевіркою збірки й не є доказом повної
відсутності будь-яких можливих витоків. Повний endpoint inventory знаходиться
в API_AUTH_INVENTORY.json; він описує статичні auth-сигнали, а не замінює
поведінкові тести кожного методу.
