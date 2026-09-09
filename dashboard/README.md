# dashboard

Next.js-панель Mistblossom Vanguard: бізнес-логіка, база, сторінки, API.

Документація проєкту централізована в [`../docs/`](../docs/) — тут лише те,
що стосується цього пакета.

## Локальний запуск

```bash
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

Панелі потрібен сусідній пакет `../shared` (`@mistblossom/discord-contract`),
на який `package.json` посилається як `file:../shared`. Тому репозиторій
клонується цілком, а не одним каталогом.

## Команди

| Команда | Що робить |
|---------|-----------|
| `npm run dev` | режим розробки |
| `npm run build` | продакшн-збірка (`output: standalone`) |
| `npm run typecheck` | перевірка типів |
| `npm run lint` | ESLint |
| `npm run verify` | typecheck + lint + перевірки CI |
| `npm run db:init` | застосувати схему бази |
| `npm run db:migrate-dry-run` | пробне перенесення з Firestore |

## Документація

- [Архітектура](../docs/ARCHITECTURE.md)
- [Розгортання](../docs/DEPLOYMENT.md)
- [Налаштування](../docs/CONFIGURATION.md)
- [Експлуатація](../docs/OPERATIONS.md)
- [База даних](../docs/DATABASE.md)
- [Довідник API](../docs/reference/API.md)
