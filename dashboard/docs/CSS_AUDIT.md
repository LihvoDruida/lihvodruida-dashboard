# CSS / UI audit — Mistblossom Vanguard

## Мета

Desktop-версія dashboard зведена до однієї системи геометрії без зміни темної теплої палітри та WoW/Mistblossom характеру. Базова геометрія сторінки, контролів і поверхонь тепер визначається спільними токенами, а доменні CSS-файли залишають тільки специфіку конкретного екрану.

## Єдина структура

- Робочі сторінки: `container app-page`.
- Основний stack: `dashboard-shell content-shell app-page-stack`.
- Максимальна ширина desktop: `--page-max: 1520px`.
- Єдиний page gutter: `--page-gutter`.
- Page gap: `--page-gap`.
- Section gap: `--section-gap`.
- Sidebar профілю: `--sidebar-width`.
- Topbar використовує той самий `--page-max`, що й контент.

## Контроли

- Основна висота кнопки/input/select: `42px`.
- Compact control: `34px`.
- Control radius: `10px`.
- Card radius: `14px` через `--card-radius`.
- Звичайні кнопки використовують `.btn` + tone/size modifiers.
- Rich/select/tab/nav controls лишаються спеціалізованими тільки там, де звичайна кнопка семантично не підходить.
- Logout має `.btn` за замовчуванням, тому більше не може деградувати до native browser button.

## Виправлення профілю зі скріну

- Список персонажів переведений на `auto-fit`; порожні grid-треки праворуч більше не резервуються.
- Character cards на desktop використовують доступну ширину main-column.
- Artwork-картка лишається edge-to-edge і не отримує глобальний padding.
- Порожні квадратні псевдоіконки замінені реальними inline SVG.
- `Зробити мейном`, `Raider.IO`, `Видалити` переведені на спільні `.btn` variants.
- Logout стилізує сам `<button>`, а не тільки `<form>`.
- Профільна UI-типографіка використовує читабельний display/UI font; brand serif лишився для бренду.

## Захист від глобального CSS-конфлікту

Fallback-правила для доменних `*-card`, `__card`, `*-panel`, `__panel`, `*-grid` і `*-layout` використовують `:where()` з нульовою специфічністю. Це дає єдині defaults, але не перетирає свідомо задану композицію складного компонента.

## Автоматичний контроль

Фінальний аудит:

- 37 page routes.
- 81 API routes.
- 117 `<button>`: 95 shared `.btn`, 22 спеціалізовані semantic controls.
- 59 action-like `<a>`: 57 shared `.btn`, 2 явно дозволені rich CTA.
- 105 internal navigation refs.
- 1024 local import/export refs.
- 251 TS/TSX files — syntax transpile без помилок.
- 980 CSS class selectors у 16 CSS-файлах.
- 8 ID selectors.
- 114 CSS custom properties.
- 3 keyframes.
- Консервативно підтверджених unused class/ID selectors, custom properties або keyframes: 0.
- `inspect-ci`: 0 blocking issues.
- Discord bot regression: 18/18.
- Shell syntax: 7/7.
- JSON parse: 8/8.
- `docker-compose.yml` parse: OK.

`audit:styles` і `audit:ui` включені в `verify` та `build:ci`, тому повернення мертвих стилів або випадкових нестандартизованих кнопок тепер ловиться до production build.

## Межа перевірки

У локальному робочому середовищі немає встановленого dashboard `node_modules`, тому повний `next build`/TypeScript semantic typecheck тут не видається за пройдений. Структурні, route, import, CSS, UI і TS/TSX syntax-перевірки виконані; production Docker `build:ci` додатково запускає повний typecheck перед Next build.
