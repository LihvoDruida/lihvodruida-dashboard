# dashboard

Next.js-панель Mistblossom Vanguard: бізнес-логіка, база, сторінки, API.

Документація проєкту централізована в [`../docs/`](../docs/) — тут лише те,
що стосується цього пакета.

## Локальний запуск

```bash
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000 або http://0.0.0.0:3000
```

Панелі потрібен сусідній пакет `../shared` (`@mistblossom/discord-contract`),
на який `package.json` посилається як `file:../shared`. Тому репозиторій
клонується цілком, а не одним каталогом.

### HTTP smoke локального сайту

Коли `npm run dev` уже запущений, в іншому терміналі:

```bash
npm run smoke:http
```

Smoke перевіряє `/api/health` і всі статичні `page`-маршрути без виконання руйнівних POST/DELETE дій. Захищені сторінки можуть коректно відповідати редіректом на login; помилками вважаються `404`, `405`, `5xx` і недоступний сервер. Для динамічних сторінок можна передати `SMOKE_PROFILE_ID`, `SMOKE_RAID_ID`, `SMOKE_POLL_ID`, `SMOKE_CHARACTER_KEY` та `SMOKE_ADMIN_PATH`; для авторизованої перевірки — `SMOKE_COOKIE`.

`0.0.0.0` підтримується як локальний host у development. Для Discord/Battle.net OAuth використовуй саме той callback origin, який зареєстрований у відповідному developer portal (часто це `localhost` або публічний домен), а не підміняй його автоматично на `0.0.0.0`.

## Команди

| Команда | Що робить |
|---------|-----------|
| `npm run dev` | режим розробки |
| `npm run build` | продакшн-збірка (`output: standalone`) |
| `npm run typecheck` | перевірка типів |
| `npm run lint` | ESLint |
| `npm run verify` | typecheck + lint + API/page/button/import перевірки CI |
| `npm run check:imports` | перевіряє всі локальні `@/` та relative imports |
| `npm run smoke:http` | безпечний GET-smoke запущеного сайту (за замовчуванням `http://0.0.0.0:3000`) |
| `npm run db:init` | застосувати схему бази |
| `npm run db:migrate-dry-run` | пробне перенесення з Firestore |

## Документація

- [Архітектура](../docs/ARCHITECTURE.md)
- [Розгортання](../docs/DEPLOYMENT.md)
- [Налаштування](../docs/CONFIGURATION.md)
- [Експлуатація](../docs/OPERATIONS.md)
- [База даних](../docs/DATABASE.md)
- [Довідник API](../docs/reference/API.md)
