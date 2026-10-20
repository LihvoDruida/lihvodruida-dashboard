# Mistblossom Dashboard 3.16.0

Парний Site — 4.6.3; Bot — 3.6.9. Сумісність із Site 4.6.1 збережена.

**Чинна інструкція:** [встановлення, env, cron, перевірки й відкат](docs/RELEASE_INSTALL_2026-10-19_UA.md).
Спочатку Dashboard, потім cron, потім Site. PostgreSQL — єдине робоче сховище.

Цей випуск захищає профілі від видалення через Discord OAuth 403/таймаути, зберігає повний
Retry-After і паузу Raider.IO після рестарту, передає загальне скасування в монітор стрімерів,
очищає старі метадані YouTube зі збереженням дедуплікації та читає старі ключі подій.

```bash
cd dashboard
npm ci --no-audit --no-fund
npm run verify
npm run build:ci
```

[Конфігурація](docs/CONFIGURATION.md) · [БД](docs/DATABASE.md) · [Експлуатація](docs/OPERATIONS.md).
Опис форм кількох платформ: [STREAMER_MEMBER_PLATFORMS_2026-10-18_UA.md](docs/STREAMER_MEMBER_PLATFORMS_2026-10-18_UA.md).
Попередні нотатки релізів і документи в `docs/archive` — історичні.
