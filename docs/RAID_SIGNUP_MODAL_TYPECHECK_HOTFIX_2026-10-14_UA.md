# Hotfix — збірка модального запису в рейд (TS18048)

Дата: 2026-10-14  
Базовий реліз: dashboard 3.8.87, bot 3.6.9  
Причина: зупинка `npm run build:ci` на `npm run typecheck` у Docker builder.

## Проблема

`dashboard/src/lib/raids.ts:6704–6722`: TypeScript повідомляє 8 помилок `TS18048: 'action.page' is possibly 'undefined'`.

`decodeRaidSignupMenuId()` повертає об'єднання типів, у якому `page?: number`, оскільки старі варіанти Discord-дій не мають номера сторінки. Новий обробник `prepareRaidSignupModal()` виконував арифметику з `action.page` без перевірки на `undefined`.

## Виправлено

- Після перевірки власника та ревізії чернетки значення сторінки призначається в локальний `const page = action.page`.
- Дозволено лише режими `character` та `manual` з цілим невід'ємним значенням `page`.
- Після перевірки усі обчислення пагінації та формування `custom_id` використовують гарантовано визначений `page`.
- Алгоритм підтвердження участі, вибір персонажа/спеку, права доступу, стан нагадувань, БД та публічні компоненти не змінювалися.

## Перевірено локально

- `dashboard/scripts/check-raid-signup-menu.cjs`: **13/13**
- `bot/test/raid-signup-modal.test.mjs`, `contract.test.mjs`, `interaction-worker.test.mjs`: **20/20**
- `dashboard/scripts/check-raid-ui.cjs`: **20/20**
- `dashboard/scripts/check-raid-reminders.cjs`: **20/20**
- `dashboard/scripts/check-raid-lifecycle.cjs`: **38/38**
- `dashboard/scripts/check-raid-discord-events.cjs`: **18/18**
- `dashboard/scripts/check-raid-editor.cjs`: **20/20**
- `dashboard/scripts/check-discord-dm-interactions.cjs`: **8/8**
- `dashboard/scripts/check-forms.cjs`: успішно, **64 форми / 271 контроль**
- TypeScript transpilation `dashboard/src/lib/raids.ts`: **0 синтаксичних помилок**.

## Обмеження локальної перевірки

Повний `npm ci` у середовищі підготовки патча не завершився: npm registry не відповів, `EAI_AGAIN`. Тому **повний `npm run typecheck`, `npm run build:ci`, Docker build і запуск на бойовому VPS тут не підтверджені**. На VPS з доступом до registry потрібно повторити `make up` і переконатися, що збірка дійшла до завершення. Інші помилки збірки, якщо вони є після цього етапу, не виключені.

## Встановлення

1. Використати цей архів замість попереднього `lihvodruida-dashboard-v3.8.87-raid-signup-full-modal.zip`.
2. Перед оновленням робочої системи зберегти `.env`, базу даних та інші змінювані поза релізом файли. Не замінювати `.env` шаблоном із архіву.
3. Запустити свій стандартний процес розгортання (`make up`, якщо застосовується саме цей Makefile).
4. Переконатися, що `typecheck` та решта кроків `build:ci` завершилися успішно, після чого перевірити запис у рейд через Discord і вебформу.
