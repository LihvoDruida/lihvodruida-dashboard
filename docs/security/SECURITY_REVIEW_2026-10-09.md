# Аудит безпеки Dashboard + Discord (2026-10-09)

## Межі перевірки
Статичний огляд архіву v3.8.65, без доступу до production-секретів, Cloudflare-конфігурації чи реального Discord API. Це не penetration test і не сертифікація.

## Уже реалізовано
- Ed25519-перевірка Discord interactions перед JSON.parse.
- Обмеження тіла interaction 256 KiB, анти-replay кеш (лише в пам'яті процесу).
- CSP у Next.js proxy, CSRF та RBAC для API.
- Docker read-only root filesystem та cap_drop для частини сервісів.
- HTTP no-store для JSON-відповідей бота.

## Зміни в цьому релізі
- Додаткові заголовки для відповідей Discord transport: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
- Явний `Cache-Control: no-store, max-age=0`.
- Регресійний тест на заголовки.

## Пріоритетні наступні роботи (НЕ реалізовано)
1. **Високий:** захист від replay між репліками. Поточний `replayGuard` використовує Map у пам'яті одного процесу. Для масштабування на кілька реплік потрібен атомарний спільний claim у PostgreSQL/Redis з TTL. Для однієї репліки ризик нижчий.
2. **Високий:** перевірка прав Discord-ролей на кожну критичну мутацію, включно з видаленням порушення, редагуванням правил і перевидачею ролі; протестувати втрату ролі під час відкритої сесії.
3. **Високий:** незалежний аудит посилань запрошення Статика: одноразовість чи повторне використання, зв'язування з Discord user ID, 24-годинний TTL, відгук токена, заборона потрапляння токена в access-логи/Referer.
4. **Середній:** перевірити налаштування Cloudflare WAF, rate limits, DNS та реальну доступність `/api/health` ззовні; не покладатися лише на локальний healthcheck.
5. **Середній:** забезпечити ротацію `DISCORD_BOT_TOKEN`, `SESSION_SECRET`, internal service token із перехідним періодом; секрети не повинні потрапляти в журнали.
6. **Середній:** CI: npm audit з triage, secret scanning, SAST, SBOM, image scan, тести авторизації та деплой із rollback.
7. **Середній:** переглянути безпеку адміністративного токена: MFA/Discord OAuth2 для адміністраторів, короткі сесії, аудит усіх мутацій.

## Перевірки
- `node --test bot/test/security-headers.test.mjs bot/test/replay-guard.test.mjs`: 5/5 PASS.
- Повний `node --test bot/test/*.test.mjs`: 14 PASS, 4 FAIL через нерозв'язані залежності workspace у розпакованому архіві; це не доказ помилок продукту, але і не підтвердження повної регресії.
- Production build, інтеграція Discord і pentest не виконані.
