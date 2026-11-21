# Mistblossom Vanguard UI system

Цей файл фіксує правила, за якими dashboard має оформлюватися однаково на всіх сторінках. Базову геометрію не потрібно копіювати у доменні CSS-файли.

## Каркас сторінки

Стандартна робоча сторінка використовує `container app-page`, а її основний shell — `dashboard-shell content-shell app-page-stack`. Максимальна ширина, зовнішній gutter і вертикальний ритм задаються токенами `--page-max`, `--page-gutter`, `--page-gap`.

Редіректи, login та спеціальні problem screens можуть не використовувати цей каркас, якщо вони не є робочою сторінкою застосунку.

## Поверхні

- `.panel` — велика секція сторінки, `--panel-padding`.
- `.card` — звичайна картка, `--card-padding`.
- Доменні `*-card`, `__card`, `*-panel`, `__panel` зберігають свою внутрішню композицію. Desktop fallback задає їм лише спільний radius/border з нульовою специфічністю через `:where()`, тому складні картки не ламаються глобальним padding.
- `--card-radius` — єдиний базовий radius робочих поверхонь.

## Кнопки

Звичайна дія завжди використовує `.btn`:

- `.btn.primary` — основна дія;
- `.btn.subtle` / `.btn.secondary` — другорядна;
- `.btn.ghost` — тиха дія;
- `.btn.danger`, `.warning`, `.success` — статусні дії;
- `.btn-sm` — компактний варіант;
- `.btn-icon` — квадратна icon-only дія;
- `.btn__icon` — контейнер SVG у кнопці.

Базова висота — `--control-height`, компактна — `--control-height-sm`, radius — `--control-radius`. Не задавати власні height/padding/radius для звичайної кнопки в CSS конкретної сторінки.

Складені контролі на кшталт tab, nav trigger, image picker або multi-line OAuth CTA можуть мати власну семантичну геометрію. Вони мають бути явно внесені в `scripts/audit-ui.cjs`, а не залишені випадковим native `<button>`.

## Форми

`input`, `select`, `textarea` мають спільні border/background/focus/radius. Desktop input/select дорівнює висоті звичайної кнопки. Checkbox/radio — окремі компактні контролі.

## Типографіка

Робочі `h1/h2/h3` використовують `--font-display` і не отримують глобальний uppercase або gradient text. `--font-brand` використовується тільки в брендових/декоративних місцях, наприклад назві гільдії.

## Сітки й відступи

Основні значення беруться зі spacing scale в `tokens.css`. Desktop fallback для `*-grid`/`__grid` та `*-layout`/`__layout` має нульову специфічність: він дає стандартний ритм, але не перекриває свідомо задану доменну сітку.

## Профіль

Профіль акаунту (`/profile/[id]`) і його налаштування (`/profile/[id]/settings`) — дві сторінки зі спільною шапкою `AccountHero`: обкладинка, аватар, імʼя, позначки (група, статус, роль), ключові цифри та вкладки. Праворуч від вмісту профілю — `AccountCard` (Discord, Battle.net, група, роль, вихід). Налаштування мають навігацію по розділах і компактну смугу заповнення; якорі форм (`#profile-name-settings`, `#profile-gender-settings`, `#profile-nickname-settings`, `#profile-role-settings`) стабільні — на них посилаються правила й реєстрація. Стилі — лише `components/account/account.module.css`; колір класу передається inline як `--guild-class-color`.

## Каскад стилів

Порядок шарів оголошено першим рядком `tokens.css`: `@layer base, patterns, adaptive;`.

- `base` — скидання та стилі елементів (`input[type=…]`, `select`, `label > span`, чекбокси, `details`). Будь-яке іменне правило сильніше.
- `patterns` — суфіксні заглушки (`[class$="-row"]`, `[class*="-card "]`…). Вони не торкаються елементів CSS-модулів: кожна атрибутна перевірка має `:where(:not([class*="-module__"]))`.
- `adaptive` — desktop-заглушки з `:where()` у `desktop.css`.
- Усе іменне (компоненти, сторінки, CSS-модулі) лежить поза шарами й завжди перемагає шари, незалежно від специфічності та порядку файлів.

Нове правило для конкретного компонента пишеться поза шарами; нова загальна заглушка — лише в `@layer patterns`. Глобальні класи всередині CSS-модуля пишуться як `:global(.btn)`, інакше модуль робить їх локальними й правило не спрацьовує.

Брейкпоінти: `max-width` 1320 / 1240 / 1000 / 860 / 760 / 640 / 520 / 420px (парні `min-width` 1001 / 641). Відступи — шкала `--space-*` (4px), кольори — токени; `backdrop-filter` пишеться лише без префікса (збирач додає `-webkit-` сам, ручний префікс він «зливає» в нечинний для Chrome варіант).

## Автоматичні перевірки

`npm run audit:styles` ловить консервативно підтверджені невикористані class/ID selectors, custom properties і keyframes.

`npm run audit:ui` перевіряє стандартний page shell, класифікує всі `<button>` як shared `.btn` або свідомий спеціалізований control, а також перевіряє action-like `<a>`: вони мають бути `.btn` або одним із явно дозволених rich CTA.

Обидві перевірки входять у `verify` та `build:ci`. Якщо додається новий тип кнопки або сторінки, спочатку треба вирішити, чи це справді новий UI-патерн, а не локальна копія вже існуючого.

## Спільні React-примітиви (3.22.0)

Використовуйте components/ui/Button, FormField і DataTable та components/management/ManagementShell. Вони працюють зі спільними CSS-токенами. Не додавайте глобальне локальне перевизначення .btn для конкретної групи сторінок. Приклади впроваджені в ManagementSections, /dashboard/access і read-only /dashboard/groups.

## 3.23.0 — універсальні сторінки

Новий стандарт: components/page/PageContainer, PageHeader, PageSection, FilterToolbar, DataGrid, DataCard, FormSection, PageSkeleton, EmptyState, ErrorState, PageErrorBoundary та StatusBadge. На цьому етапі мігровано лише /dashboard. Нові сторінки використовують page-system.module.css і центральні токени; перелік та план: [PAGE_ARCHITECTURE_STEP1_UA.md](PAGE_ARCHITECTURE_STEP1_UA.md). Старі сторінки мігруються поетапно після підтвердження.

## 3.24.0 — етап 2

ManagementPage, ProfileSidebar і shared page primitives застосовано до access/groups/cleanup та трьох profile routes. Нові Notice, Progress, FilterNavigationForm, PageRouteError — спільні; локальні error/loading не зачіпають інші розділи. Деталі: [PAGE_ARCHITECTURE_STEP2_UA.md](PAGE_ARCHITECTURE_STEP2_UA.md).

## 3.25.0 — етап 3

Шість сторінок /guild, /applications, /raids, /raids/[raidId], /polls, /polls/[pollId] переведено на PageContainer/PageHeader, FilterToolbar, DataCard/DataGrid і системні стани. Токен --management-sidebar-width замінює історичний --sidebar-width для актуального page shell. Деталі: [PAGE_ARCHITECTURE_STEP3_UA.md](PAGE_ARCHITECTURE_STEP3_UA.md).
