# Етап 2 — профілі, доступ і групи: Dashboard 3.24.0

Дата: 14.11.2026. База: Dashboard 3.23.0. Зміни виконано у вихідних файлах.
Поточний крок підтверджено повідомленням «наступний»; етап 3 не розпочато.

## Обсяг

| Маршрут | Нова структура | Перевірка доступу |
| --- | --- | --- |
| `/dashboard/access` | ManagementPage, спільні вкладки, дві незалежні FormSection-форми, пошук ролей | Fresh server session + groups.manage; адміністративні відповідності змінює owner |
| `/dashboard/groups` | Пошук/список груп, master/detail, параметри, згруповані дозволи, меню другорядних дій | Fresh management read; groups.view — читання, groups.manage — редактор; owner-only адміністративні зміни |
| `/dashboard/profiles` | Поточний стан, розклад, preview, розгортуване видалення, історія | Тільки owner; endpoint повторно перевіряє право, lock і preview |
| `/profiles` | PageHeader, FilterToolbar, нативна таблиця, адаптивні рядки, cursor pagination | Live groups.manage перед читанням каталогу; збережено серверну фільтрацію видимості |
| `/profile/[profileId]` | Sidebar, PageHeader, персонажі, приватні рейдові записи | canViewProfile; зміни персонажів і OAuth тільки для власника профілю |
| `/profile/[profileId]/settings` | Sidebar, completion, особисті дані, Discord/нагадування, роль | Власний profileId перевіряється сервером до читання цільового профілю |

Кожен маршрут має локальні loading.tsx та error.tsx. Універсальний PageRouteError
не показує текст exception: лише безпечне пояснення, digest і дію повторення.
Інші маршрути не отримали примусового глобального loading-screen.

## Аудит і виправлення

- Профіль і налаштування мали по 880 і 945 рядків; UI, зовнішні читання,
  повернення до правил і перевірки доступу перебували в одному файлі.
  Виділено server-only services/profileOverview, profileSettings, profileDirectory;
  route-файли тепер композиційні. Приватні об’єкти сесій і токени провайдерів
  не передаються новим клієнтським контролам; для ролей та вибору альтів — мінімальні DTO.
- Посилання початку Battle.net OAuth показувалось також у чужому профілі.
  Дію відображено лише власнику; серверні endpoint-перевірки збережено.
- Помилка читання рейдових записів раніше перетворювалась на порожній список.
  Тепер показується ErrorState з повторним читанням.
- Пошук відповідностей Discord-ролей приховує рядки, але не демонтує select.
  FormData включає всі призначення, а не лише результат пошуку. Пошукове поле
  не має name і не відправляється в policy endpoint; Enter у ньому не зберігає політику.
- Збережено відповідності Discord ID, яких немає у відповіді Discord. Невідома
  поточна група має явну option; вона не замінюється порожнім значенням.
  При помилці Discord API або захищених адміністративних відповідностях
  недоступне збереження непридатної політики. API продовжує перевіряти права.
- Каталог використовує справжні table/tr/th/td і посилання в комірці, замість
  anchor з role=row. У вузькому контейнері — підписані рядки-картки; колонки
  мають min-width:0, table-layout:fixed і перенесення довгого тексту.
- Фільтри працюють через Next navigation без повного перезавантаження.
  Серверний пошук охоплює весь доступний каталог, не поточні 20 записів.
  Cursor, фільтри, saved views і повернення до рядка збережено.
- Збережені Discord raid preferences лишаються в каталозі як згорнутий
  другорядний блок; дані й функціональні розділи не видалено.
- Групи: виділено AccessGroupList, AccessGroupFields, AccessGroupPermissions.
  Контролер чернеток, ізоляція за користувачем, revision/conflict/receipt,
  відновлення після невизначеної відповіді та заборона повторного POST збережені.
  Delete, impersonation і reset згруповано в DropdownMenu з нативними submitter
  та formAction; основна дія збереження лишається видимою.
- Налаштування альтів обмежені двома на клієнті; вибраний альт можна зняти.
  Серверні обмеження та власник профілю залишаються остаточним джерелом прав.
- Повернення до правил, encoded rt, next для OAuth, returnTo у формах,
  candidate bulk form і main/role setup збережено, включно з sidebar-переходами.

## Структура

```text
src/
  app/
    dashboard/{access,groups,profiles}/{page,loading,error}.tsx
    profiles/{page,loading,error}.tsx
    profile/[profileId]/{page,loading,error}.tsx
    profile/[profileId]/settings/{page,loading,error}.tsx
  services/
    profileOverview.ts
    profileSettings.ts
    profileDirectory.ts
  components/
    page/{Notice,Progress,FilterNavigationForm,PageRouteError}.tsx
    management/ManagementPage.tsx
    management/access/{AccessPolicyForms,RoleMappingsEditor}.tsx
    management/cleanup/ProfileCleanupForms.tsx
    access-groups/{AccessGroupList,AccessGroupFields,AccessGroupPermissions}.tsx
    access-groups/groupLabels.ts
    profile/{ProfileOverviewView,ProfileSidebar,ProfileBattleNetPanel,ProfileRaidSignups}.tsx
    profile/settings/{ProfileSettingsView,ProfileCompletion,ProfilePreferences,NicknameSelection}.tsx
    profile/directory/{ProfileDirectoryView,ProfileDirectoryFilters,ProfileDirectoryTable,DiscordRaidPreferences}.tsx
  lib/profileDirectoryNavigation.ts
```

Типи view-model виводяться з server-only завантажувачів через Awaited<ReturnType>.
Клієнти імпортують такі типи через import type; повні серверні моделі
залишаються на серверній межі. Нові CSS Modules — токени кольорів, типографіки
й відступів; жодних style= у нових workspace-компонентах.

Додатково розширено спільні DataTable (className/tableClassName), DropdownMenu
(нативні child submitters) і ManagementSections (universal variant). Старий
варіант вкладок залишено для розділів наступних етапів.

## Очищення

Видалено 599 невикористовуваних CSS-правил для 227 class names у дев’яти
глобальних stylesheet, а також невикористаний --sidebar-width. Змішані селектори
очищені зі збереженням живих гілок. Повний список: CSS_CLEANUP_STEP2.json.
Стилі живих доменних компонентів персонажів, імені й revision-aware редакторів
залишено. Це не твердження, що весь старий CSS усіх сторінок уже мігровано.

Профілі, групи, записи в БД та активні налаштування не видалялись.
Залежності, production .env, middleware/RBAC-модель і API-контракти не змінювались.
Для цього кроку не потрібна SQL-міграція або запуск очищення акаунтів.

## Перевірки та межі

Поточний протокол: docs/validation/step2/VALIDATION.md.
check:identity-workspaces входить у verify і build:ci: 14 поведінкових сценаріїв
на реальних server loaders та React SSR з контрольованими зовнішніми межами.
Існуючі перевірки тепер проходять дерево справжніх імпортів компонентів/сервісів,
замість вимагати повернення монолітної розмітки в page.tsx.

Browser fixture з production-компонентами успішно зібрано; Chromium не стартує
через socket(): Operation not permitted. Браузерний рендер, візуальний аудит,
розміри екранів і клавіатурні взаємодії не позначаються PASS.
Production PostgreSQL, Discord, OAuth і VPS не тестувались наживо.

## Наступний етап

Завершено 7 із 42 UI-сторінок: /dashboard на етапі 1 та шість сторінок тут.
Етап 3 після підтвердження: /guild, /applications, /raids, /raids/[raidId],
/polls, /polls/[pollId]. Зберігаємо всі дані, URL-повернення, composition,
attendance і Discord-only signup; спочатку уніфікуємо списки/фільтри й деталі.

Повний код змінених runtime-файлів: PAGE_IDENTITY_SOURCE.md та дерево src/.
Збірка: npm ci, npm run build:ci у dashboard/ з усім монорепозиторієм поруч,
включно зі shared/. Це повний архів, не окрема папка dashboard.

Додатково видалено 65 старих правил груп: їх перенесено в ізольований groups.module.css із токенами. Разом прибрано 664 глобальні правила. Дві залишкові змінні доменних character cards замінено центральними --section-gap і --card-radius.

Підсумок: verify — 105/105 груп; production build — PASS; standalone — 10/10. Повний протокол і логи: validation/step2/.

Live-область повідомлень груп залишається змонтованою, щоб допоміжні технології отримували результати дій; порожній стан не займає місця.
