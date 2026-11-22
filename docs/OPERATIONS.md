# Експлуатація

[Чинна інструкція встановлення й оновлення](RELEASE_INSTALL_2026-10-19_UA.md).

| Команда з кореня Dashboard | Призначення |
|---|---|
| `make ps` | Стан контейнерів |
| `make logs` | Потік журналів |
| `make backup` | Резервна копія БД |
| `make internal-check` | Узгодженість bot/cron/Dashboard |
| `make discord-check` | Діагностика Discord |
| `make resources` | Ресурси VPS |
| `docker compose logs --tail=100 cron` | Останні результати автоматизацій |

Контролювати останні успішні ticks, відкладені задачі, строки cooldown, стан БД, backlog
retention та `uncertain` доставки. `GET /api/health` підтверджує лише живість процесу.
Публічний `/site-api/v1/status` має повертати JSON; HTML challenge означає несправний шлях.

Не очищати квитанції, щоб повторити невизначений POST/DELETE. Не робити реальних виключень
учасників для перевірки захисту. Не включати значення env, access/refresh token або дамп БД у звіт.
Відновлення й конкурентність перевіряти на ізольованій БД тієї самої major-версії.

## Оновлення і самовідновлення сервісів

`make deploy` виконує кроки в такому порядку:

1. `git pull --ff-only`. Якщо змінився сам `deploy.sh`, скрипт перезапускається вже у новій версії.
2. Rollback-теги поточних образів, `start.sh --check`, збірка `dashboard` і `bot`.
3. `nginx -t` для нового конфігу в тимчасовому контейнері. Помилка зупиняє деплой, і старий nginx далі обслуговує трафік.
4. Схема БД: `schema.sql` з `ON_ERROR_STOP` до старту нового dashboard.
5. `up` стеку, примусове перестворення `cron` (bind-mounted скрипти) і `nginx -s reload` (bind-mounted конфіги).
6. Очікування health для `dashboard`, `bot`, `nginx` і `cron`. Якщо хоч один сервіс не здоровий, виконується rollback образів.

Healthcheck сервісів:

| Сервіс | Перевірка |
| --- | --- |
| dashboard | `/api/health` (liveness, без зовнішніх викликів; містить `settingsSync`) |
| bot | `/healthz` |
| nginx | `http://127.0.0.1:8081/nginx-health`, лише loopback контейнера |
| cron | heartbeat диспетчера і циклу member-cleanup (`deploy/cron/healthcheck.sh`, ≤ 180 с) |

Cron працює під `init: true` (tini), тому завершені worker-процеси прибираються. Збій окремої задачі не зупиняє диспетчер, а загиблий цикл member-cleanup диспетчер піднімає сам. Discord Gateway бота перепідключається:

- після `op 7` і пропущеного heartbeat ACK, не чекаючи `close` мертвого сокета;
- якщо handshake не завершився за 45 с (`DISCORD_GATEWAY_HANDSHAKE_TIMEOUT_MS`).

Події від заміненого сокета ігноруються, тож паралельних сесій не буває.
