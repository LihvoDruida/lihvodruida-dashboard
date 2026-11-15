# Крок 1: універсальна архітектура сторінок — Dashboard 3.23.0

Дата: 14.11.2026. База: поточний Dashboard 3.22.0.

## Виконана межа

Прочитано UI_SYSTEM.md, CSS_AUDIT.md, MANAGEMENT_UI.md, STYLE_AUDIT.md.
Проаналізовано всі 45 сторінок: [повний перелік](PAGE_ROUTE_INVENTORY.md).
Реалізовано спільний фундамент і повністю переписано лише `/dashboard`.
Решта 41 сторінки з UI очікують наступних ітерацій; 3 redirects потребують
лише перевірки навігації. Наявний RBAC, серверні перевірки, фон і бізнес-логіка
інших розділів не перебудовувались.

## Аудит стану до змін

- Page shell уже був спільним для 10 management-сторінок, але не для всіх
  робочих сторінок. Hero, шапки редакторів і metadata мали різну композицію.
- AdminPageHeader стилізувався і в admin.css, і в management.css, включно
  з окремими media/container перевизначеннями. Новий PageHeader ізольовано
  CSS Modules, він не отримує ці доменні перевизначення.
- Огляд складався з повторного набору посилань, без пошуку/категорій і
  з вкладеною panel для інтеграцій. Порожні дані імітували warning-статуси.
- Автоматизації могли показувати всі картки й owner-only посилання користувачу
  з одним правом керування Discord. Новий огляд відбирає дані й дії на сервері.
- Немає єдиного контракту loading/empty/error; один невдалий блок міг
  перервати рендер або зникнути без пояснення.
- Дві найбільші сторінки: налаштування профілю — 945 рядків, профіль — 880;
  Discord management — 568. Їхня декомпозиція належить наступним етапам.
- Старий аудит стилів враховував споживачів токенів лише в глобальному CSS.
  Він тепер перевіряє структуру/імпорти та token usage також у CSS Modules,
  не трактуючи локальні CSS Module-класи як глобальні селектори.

## Спільні структурні компоненти

| Файл у src/components/page/ | Контракт |
| --- | --- |
| PageContainer.tsx | Глобальна навігація, необов’язковий sidebar, main і content grid |
| PageHeader.tsx | Один h1, опис, breadcrumbs, слот actions і semantic dl metrics |
| FilterToolbar.tsx | Search/filters/actions/result; live result count; нормальний Tab order |
| PageSection.tsx | h2, description/actions та вміст секції |
| DataGrid.tsx | Auto-fit/two/three layout без inline-геометрії |
| DataCard.tsx | Заголовок, опис, badge, дані та footer actions |
| FormSection.tsx | Справжній fieldset/legend і disabled-стан, без вкладеного form |
| EmptyState.tsx | Відмінність «немає даних» та «нічого не знайдено» задає споживач |
| ErrorState.tsx | Зрозуміле повідомлення, retry-slot, без виведення сирого Error |
| PageSkeleton.tsx | Page/cards/rows, bounded count, status/aria-busy, reduced-motion |
| PageErrorBoundary.tsx | Локальне перехоплення клієнтського render error, журналювання, reset |
| PageRefreshButton.tsx | router.refresh з transition/busy, без повторного запису даних |
| StatusBadge.tsx | Семантичні neutral/success/warning/danger/info стани |
| page-system.module.css | Ізольована геометрія й стани виключно через спільні токени |

`src/components/ui/DropdownMenu.tsx` — native details/summary disclosure,
нормальний Tab order, Escape повертає фокус на summary, зовнішній pointer
закриває панель. Disabled destination не рендериться як активне посилання.
Компонент не оголошує role=menu без реалізації повного ARIA menu-контракту.

Нові spacing, typography, border, skeleton та state-параметри централізовано
в tokens.css. У нових CSS немає hex/rgb/hsl-кольорів, довільних px/rem
margin/padding/gap або !important. У нових TSX немає style={...}.
Старі локальні стилі інших розділів залишаються предметом їхньої міграції;
цей крок не видається за виконання глобального zero-drift на всьому продукті.
CSS breakpoints залишаються числовими, бо var() у media/container queries
не є придатною заміною для поточної системи.

## Еталонний /dashboard

Server page отримує актуальну сесію і перевіряє canAccessManagement до
підготовки даних. managementOverviewItems створює мінімальний serializable
DTO з уже дозволених розділів: без повної сесії, permission arrays або
функцій allowed на клієнті. Загальна навігація залишається DashboardIdentity.

```
src/app/dashboard/page.tsx
src/components/page/ (спільні шаблони з таблиці вище)
src/components/ui/DropdownMenu.tsx
src/components/management/overview/ManagementDirectory.tsx
src/components/management/overview/OverviewIntegrations.tsx
src/components/management/overview/OverviewAutomations.tsx
src/components/management/overview/overview.module.css
src/hooks/useManagementDirectoryFilters.ts
src/lib/managementDirectory.ts
src/lib/managementOverviewModel.ts
```

Directory: локальний Unicode-пошук, категорія, сортування, відлік результатів
і reset без навігаційного fetch. q/section/sort записуються в URL з утриманням
наявного history.state та hash; попередня/наступна навігація відновлює фільтри.
Дозволені розділи лишаються єдиним джерелом і для категорій фільтра.

Картка розділу має одну основну дію «Відкрити». Додавати dropdown до кожної
картки без другорядних дій не потрібно. Системні переходи винесено в окремий
DropdownMenu у шапці. Кожна destination повторно перевіряє права на сервері.

Integrations: реальний PageSkeleton замість фальшивих warning-карток;
валідація отриманого DTO; ErrorState/EmptyState; попередні дані зберігаються
під час оновлення чи збою. Використано існуючий targeted background resource
із його TTL, visibility/backoff та single-flight поведінкою.

Automations: async Server Component у Suspense. Відомі permission-scoped
кількість і геометрія карток використовуються для skeleton. Метрики не
підтягуються з Discord на render; збережено існуючий read-only loader.
Owner-only account cleanup і чужі функціональні права відфільтровано ДО JSX.
Помилка читання має явний ErrorState й retry. Оновлення не запускає очистку.

PageErrorBoundary ловить клієнтські render errors у конкретному віджеті.
Server Component errors він не перехоплює: дані automation мають свій
серверний catch/стан, а інші помилки обробляє наявна Next route boundary.
Відомий loading стан інтеграцій містить п’ять карток, як у loader сервісу;
розміри skeleton і DataCard узгоджені. Довгий реальний контент може збільшити
картку, тому абсолютної обіцянки CLS=0 за будь-яких даних немає.

## Прибрано

- src/components/IntegrationStatusPanel.tsx: єдиний споживач повністю замінено
  OverviewIntegrations із явними системними станами.
- Невикористовувані integration-status-* правила, включно з їхніми частинами
  спільних media selectors (правила інших компонентів збережено).
- Невикористовувані management-hub* правила: новий огляд використовує DataGrid.
- Повторний JSX/специфічні поверхні старого огляду.

## Черговість міграції

| Етап | Розділи | Критерій завершення |
| --- | --- | --- |
| 1 — виконано | Архітектура та /dashboard | Шаблони, системні стани, reference page, аудит 45 routes |
| 2 | Групи, доступ, каталог і особисті профілі, очищення профілів | Спільні списки/форми, збереження чернеток, видимість дій за правами |
| 3 | Склад гільдії, заявки, каталоги й деталі рейдів/пулів | Спільні фільтри та щільність, URL/pagination, mobile layout |
| 4 | Створення/редагування, roster, контент, Discord-публікації | FormSection, валідація, preview та безпечні secondary actions |
| 5 | Discord management, Welcome, Статик, журнали, сервер | Системні стани, спільні настройки, permission-scoped diagnostics |
| 6 | Вхід, прийняття правил, legal/error screens, redirects | Спеціалізована композиція зі спільними токенами; фінальна перевірка всіх routes |

Міграція етапу 2 не виконувалася — очікується підтвердження користувача.
Рейдові механіки, публічний доступ і auth flow не змінюються заради єдиного UI.

## Код і перевірки

Усі файли — у вихідному дереві, без пропусків. Повний текст нових компонентів,
CSS, hook, view-model і reference page зібрано також у [PAGE_FOUNDATION_SOURCE.md](PAGE_FOUNDATION_SOURCE.md).

check:page-foundation входить у verify та build:ci: Unicode-фільтри, URL bounds,
server DTO, permission-scoped automation, справжній React SSR компонентів,
доступність системних станів, disabled дії та zero-drift guard.
Browser script перевіряє 1920/1440/1024/768/390px, пошук/URL, reset, disclosure,
фокус, error recovery, reduced-motion та відсутність page overflow.

Браузерний прогін у цьому середовищі заблоковано створенням Unix-сокета Chromium
(Operation not permitted). Bundling fixture завершився, успішного рендеру
в браузері немає. Жодна статична/SSR-перевірка не видається за візуальний аудит.
Реальні OAuth/Discord/production PostgreSQL та VPS deployment не виконувалися.

## Підсумковий протокол

| Перевірка | Результат |
| --- | --- |
| npm run verify | PASS — 104 групи |
| check:page-foundation | PASS — 10/10, включно зі справжнім React SSR |
| check:rbac | PASS — 15/15 у verify |
| npm run lint / typecheck | PASS |
| npm run build | PASS — Next.js 16.3.5, semantic TypeScript |
| check:standalone | PASS — 10/10, включно зі стартом пакетованого сервера |
| audit:styles / audit:ui / check:design-tokens / check:imports | PASS |
| check:page-foundation-browser | BLOCKED — Chromium Unix socket, не видається за PASS |

Перевірки зібрано в docs/validation/step1/. Вихідний архів не містить node_modules,
.next, живих env-файлів чи виробничих даних. Для встановлення збережіть весь
монорепозиторій, включно з shared/, і виконайте npm ci та build:ci в dashboard/.
Міняти production .env чи виконувати руйнівну SQL-міграцію для цього кроку не потрібно.
