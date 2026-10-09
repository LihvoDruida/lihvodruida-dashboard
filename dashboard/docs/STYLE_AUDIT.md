# Аудит стилів і desktop-перебудова

## Що змінено

- Стару головну сторінку видалено повністю. Маршрут `/` більше не рендерить окремий UI: авторизованого користувача переводить у `/profile`, неавторизованого — у `/login`.
- Видалено home-only компоненти `HomeDashboardLiveSync`, `HomeLocalTime`, `HomeUpcomingRaidList` і весь набір `home-*` стилів.
- Desktop-навігацію перебудовано з вузької плаваючої «пігулки» на app-style topbar: бренд, адаптивна рейка розділів, overflow-меню «Ще» та окреме меню профілю.
- Для ПК додано окремий шар `desktop.css` (`min-width: 1001px`): ширший робочий простір, компактні contextual hero, щільніші форми, зрозуміліші таблиці, панелі та двоколонкові layout-и. Мобільна версія цим шаром не переписується.
- Кольорова концепція збережена: темна тепла база, amber/orange accent, ті самі семантичні success/warning/danger стани.

## Результат чистки

Порівняння зроблено зі snapshot стилів перед видаленням legacy/unused правил, але вже після додавання нового desktop-шару. Тобто зменшення — це саме чистка, а не результат відсутності нового CSS.

| Метрика | До чистки | Після |
| --- | ---: | ---: |
| CSS-файлів | 16 | 16 |
| Рядків CSS | 14 378 | 13 983 |
| Унікальних class-селекторів | 1 066 | 982 |
| CSS custom properties | 156 | 108 |
| ID-селекторів | 1 | 8 |
| `@keyframes` | 3 | 3 |

- Із class namespace прибрано **84** назви.
- Із них **7** були не зайвими стилями, а помилковими `.class`-селекторами для елементів, які реально мають `id`; їх виправлено на `#id`, тому оформлення тепер дійсно застосовується.
- Решта **77 class-селекторів** видалені як підтверджено незадіяні/legacy.
- Видалено **48** custom properties, які не мали жодного `var(...)`-споживача або runtime-споживача.
- Прибрано надлишкові порожні блоки/відступи після legacy-видалень.

Найбільші групи видаленого legacy CSS: **29 `home-*`**, **36 старих `rules-*`**, старі `directory-*`, `profile-*`, `page-*`, а також непотрібні generic aliases `.field`, `.error`, `.muted`.

## Виправлені «мертві, але потрібні» стилі

Ці правила раніше не працювали, бо CSS використовував class-селектор, а JSX — `id`:

- `.guild-roster-search` → `#guild-roster-search`
- `.profile-gender-settings` → `#profile-gender-settings`
- `.rules-complete-help` → `#rules-complete-help`
- `.rules-profile-candidate-bulk-add` → `#rules-profile-candidate-bulk-add`
- `.rules-profile-name` → `#rules-profile-name`
- `.rules-public-action-help` → `#rules-public-action-help`
- `.rules-public-action-title` → `#rules-public-action-title`

Також видалено `.guild-roster-cache-sync`: така назва існувала як технічний API/action identifier, але не як UI class.

## Автоматичний аудит

Додано `npm run audit:styles`, і він входить у `verify` та `build:ci`.

Перевірка аналізує:

- усі 16 CSS-файлів і чи вони реально імпортовані/згадані runtime-кодом;
- class-селектори проти JSX `className`, `*ClassName` props, `classList.*`, selector API та динамічних class prefixes;
- runtime JavaScript у `public/`, а не лише React/TypeScript у `src/`;
- ID-селектори;
- CSS custom properties;
- `@keyframes` і наявність їх споживача.

Поточний результат:

```text
STYLE AUDIT: 982 class selectors across 16 CSS files.
STYLE AUDIT: 1251 explicit runtime class names + 39 dynamic prefixes.
STYLE AUDIT: 8 ID selectors, 108 custom properties, 3 keyframe animation(s).
STYLE AUDIT: no conservatively confirmed unused class/ID selectors, custom properties, or keyframes.
```

Аудит навмисно консервативний для runtime-модифікаторів `is-*`, `has-*`, `status-*`, `tone-*`, `role-*`, `diff-*`: їх не можна безпечно видаляти лише за статичним пошуком, якщо клас формується з даних під час роботи застосунку.

## Важливе обмеження перевірки

Статичний аудит може довести, що селектор має runtime-споживача, але не може без браузерного рендеру гарантувати, що кожен екран візуально ідеальний при будь-яких реальних даних. Тому `audit:styles` захищає від накопичення очевидного мертвого CSS, а responsive/visual regression потрібно додатково перевіряти на запущеному Next.js застосунку.
