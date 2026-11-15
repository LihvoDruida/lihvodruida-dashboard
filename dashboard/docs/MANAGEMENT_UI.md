# Management UI structure

All `/dashboard/*` management pages now use the same desktop hierarchy:

1. `DashboardIdentity` — global app navigation.
2. `AdminPageHeader` — compact title, description and status metrics.
3. `AdminTabs` — one consistent management section switcher.
4. Page content — panels/forms using the shared control and spacing system.

The management header intentionally replaces the older large `hero +
HeroSidePanel` composition.  It reduces vertical waste on desktop and keeps
important state visible without turning every settings page into a landing
page.

The Discord management page uses a 300–360 px utility column on the left and
the main bulk operations column on the right.  Logs use a compact filter
column plus the wider Discord-log configuration panel.

Server monitoring uses two refresh speeds:

- fast snapshot every 2 seconds: CPU, per-core usage, RAM, Swap, disk, uptime;
- slow snapshot every 60 seconds: Docker/BuildKit file snapshot refresh.

Background refresh does not toggle the manual button into a loading state,
pauses while the tab is hidden, resumes immediately when visible, aborts stale
requests and backs off after errors.

## 3.22.0

Спільний ManagementShell, бічна desktop-навігація та один каталог розділів у src/lib/navigation/management.ts. Усі 10 management-сторінок використовують цей shell; groups.view відкриває режим читання. Деталі: [REFACTOR_3.22.0_UA.md](REFACTOR_3.22.0_UA.md).

## 3.23.0 — reference page

/dashboard використовує універсальний PageContainer та PageHeader, ізольовані від legacy admin CSS. Додано пошук і категорії розділів, URL filters, permission-scoped automation, skeleton/empty/error та secondary-action disclosure. Інші management-сторінки лишаються на ManagementShell до наступних етапів.

## 3.24.0 — етап 2

/dashboard/access, /dashboard/groups, /dashboard/profiles тепер на ManagementPage (PageContainer/PageHeader/AdminTabs). Решта management-сторінок продовжують використовувати ManagementShell. Чернетки, native submitters, owner-only cleanup та read-only groups.view збережено. Деталі: [PAGE_ARCHITECTURE_STEP2_UA.md](PAGE_ARCHITECTURE_STEP2_UA.md).

## 3.25.0 — етап 3

Уніфіковано робочі розділи поза /dashboard: заявки з живою чергою статусів, публічний read-only roster/рейди/пули, контролі з перевірками прав і спільні меню. Видалення лише власником, recovery доставки за правами модерації та приватність контактів збережено. Деталі: [PAGE_ARCHITECTURE_STEP3_UA.md](PAGE_ARCHITECTURE_STEP3_UA.md).
