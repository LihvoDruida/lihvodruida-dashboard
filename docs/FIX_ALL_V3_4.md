# Fix all v3.4 — internal auth, Discord interactions, roster storage, telemetry

Дата: 2026-09-12.

## Причини, підтверджені журналом

- Docker internal requests ішли на `dashboard:3000`, але частина викликів або блокувалась Host policy, або доходила до route з іншим bearer token.
- `cron` використовував окремий `CRON_SECRET`, bot отримував `INTERNAL_API_TOKEN` з кореневого `.env`, а dashboard міг отримувати інше значення з `dashboard/.env.production`.
- Старі labels `firebase-records` лишилися після переходу document adapter на PostgreSQL і вводили в оману в журналі/інтерфейсі.
- `Number(null)` у structured logger перетворював відсутній HTTP status на `100`, а відсутню duration — на `0 ms`.
- Bot-forwarded `/api/discord/interactions` не був включений у private-host bearer exception.

## Що змінилось

- Канонічний service-to-service secret: кореневий `INTERNAL_API_TOKEN`.
- Compose явно передає його у `dashboard` і `bot`, а `cron` отримує те саме значення як `INTERNAL_CRON_TOKEN`.
- `make up` перевіряє довжину токена, після запуску тестує bot → dashboard і cron → dashboard.
- Додано `make internal-check`.
- Додано bearer-only `/api/internal/health`.
- Internal host policy підтримує bot-forwarded Discord interactions.
- `make up` перевіряє Discord Interactions Endpoint і за замовчуванням автоматично переводить старий Vercel/Worker endpoint на `${DASHBOARD_PUBLIC_URL}/discord/interactions`.
- Guild roster показує реальний `postgres-records` у self-hosted режимі; старий `firebase-records` нормалізується при читанні.
- Structured logger зберігає відсутні status/duration як `null`, а не фіктивні `100 / 0 ms`.
- Proxy та основні internal auth reject events записують реальний HTTP status.
- Proxy додає стабільний request ID і request-start timestamp, тому route-end logs можуть отримувати реальну duration.

## Після оновлення

Повний compose/env fix потребує не лише rebuild dashboard:

```bash
make up
make internal-check
make discord-endpoint-check
make guild-sync
```

`make up` уже запускає internal check і перевірку Discord endpoint автоматично.
