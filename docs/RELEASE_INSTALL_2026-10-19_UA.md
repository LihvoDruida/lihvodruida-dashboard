# Встановлення та оновлення Dashboard 3.21.0 / Site 4.6.3

Основна інструкція встановлення; оновлено 10.11.2026. Bot — 3.6.9 без змін.
Окремий Site 4.6.3 не входить у цей архів. Його блоки стрімерів потрібно прибрати в коді Site.
Порядок: резервна копія → Dashboard → cron → Site → перевірка.
Історичні нотатки інших релізів не задають поточні версії, команди або env.

## Каталоги й конфігурація

| Файл | Вміст |
|---|---|
| `/srv/mistblossom/.env` | Compose: публічний URL Dashboard, пароль PostgreSQL, `DISCORD_PUBLIC_KEY`, `INTERNAL_API_TOKEN`, `PUBLIC_SITE_BRIDGE_TOKEN` |
| `/srv/mistblossom/dashboard/.env.production` | Discord bot/OAuth, guild ID, Battle.net, `SESSION_SECRET`, параметри Dashboard |
| `/srv/mistblossom/bot/.env.production` | Параметри interaction-worker, без копіювання OAuth-секретів |
| `/srv/lihvodruida-site/.env` | URL Site/Dashboard, `DASHBOARD_INTERNAL_URL=http://dashboard:3000`, `PUBLIC_SITE_BRIDGE_TOKEN`, CurseForge |

`PUBLIC_SITE_BRIDGE_TOKEN` однаковий у root Dashboard `.env` та Site `.env`.
`INTERNAL_API_TOKEN` — окремий секрет bot/cron/Dashboard; у cron Compose передає його як `INTERNAL_CRON_TOKEN`.
Для Compose канонічне джерело internal token — root `.env`; значення з пакетних env не повинні його перевизначати.
Для локальної розробки можна задати internal token у `dashboard/.env.local`.
Не переносити робочі `.env`, PostgreSQL volume із чужого комплекту.
PostgreSQL є єдиним runtime-сховищем; без `DATABASE_URL` немає резервного зовнішнього сховища.

## Нове встановлення

Потрібні Docker Engine з Compose v2, Make, Python 3, DNS двох доменів і TLS-сертифікати для Nginx.
Node 24 потрібний лише для локальних перевірок поза Docker.
Розпакувати каталоги `mistblossom` та `lihvodruida-site` в `/srv`.
Для нового встановлення створити env із шаблонів; на чинному сервері ці команди не запускати поверх робочих env:

```bash
cd /srv/mistblossom
cp .env.example .env
cp dashboard/.env.example dashboard/.env.production
cp bot/.env.example bot/.env.production
chmod 600 .env dashboard/.env.production bot/.env.production
cd /srv/lihvodruida-site
cp .env.example .env
chmod 600 .env
```

Заповнити налаштування з таблиці. У root задати справжній `DASHBOARD_PUBLIC_URL` до збірки;
у Dashboard узгодити `DASHBOARD_URL`, `NEXT_PUBLIC_DASHBOARD_URL`, `DASHBOARD_ALLOWED_HOSTS`.
Зареєструвати в Discord точний callback `${DASHBOARD_URL}/api/auth/discord/callback`
зі scopes `identify email guilds.members.read`. Налаштувати bot token та правильний `DISCORD_GUILD_ID`.
Серверний CurseForge key задається лише в Site `.env`.

```bash
cd /srv/mistblossom
python3 deploy/prepare-unified-env.py --site-dir /srv/lihvodruida-site
make check
```

TLS: для Cloudflare Origin Certificate використати `make cert-origin CERT=/path/origin.pem KEY=/path/origin.key`;
для Let's Encrypt — `make cert` після заповнення `LETSENCRYPT_EMAIL` і відкриття HTTP-01.
Домени та шляхи сертифікатів у `deploy/nginx/dashboard.conf` і `deploy/nginx/public-site.conf`
мають відповідати своїм сертифікатам. Cloudflare SSL/TLS — Full (strict).
Далі виконати порядок запуску нижче. `make up` запускає PostgreSQL і застосовує схему.

## Оновлення чинного сервера та запуск

Перед заміною коду:

```bash
cd /srv/mistblossom
make backup
```

Зберегти резервні копії чотирьох env, старого вихідного коду й образів.
Завантажити новий код зі збереженням робочих env і даних. Не використовувати `docker compose down -v`.
Для першої інсталяції цей етап резервної копії порожньої БД пропускається.

```bash
cd /srv/mistblossom
python3 deploy/prepare-unified-env.py --site-dir /srv/lihvodruida-site
make check
make up
docker compose up -d --no-deps --force-recreate cron
make ps
docker compose logs --tail=100 cron
cd /srv/lihvodruida-site
make check
make deploy
curl --fail --max-time 15 https://lihvodruida.pp.ua/site-api/v1/status
```

`make up` оновлює повний Dashboard/Bot-стек. Пересоздання cron потрібне для актуального
планувальника. Звірити фактичні домени зі своїм env, якщо відрізняються від прикладу.
Site readiness має пройти до заміни здорового контейнера. У статусі перевірити доступність
контрактів, а не лише HTTP 200; публічні API повинні повертати JSON без login/challenge HTML.
Перевірити живий Discord-вхід і приватний bridge на VPS, не виводячи значення токенів.

## Поведінка цього випуску

- Помилки OAuth 401/403/429/timeout не видаляють профіль. Вихід підтверджується свіжими bot-read guild/member та кодом 10007.
- OAuth upstream має спільний бюджет 25 с і до 10 с на окреме читання. Одноразовий code автоматично не повторюється.
- Повний `Retry-After` доступний як `retryAt`; довга пауза повертається worker замість тримання запиту. Raider.IO guild worker зберігає паузу в PostgreSQL.
- Стріми та відеосповіщення видалені. Відеофон входу та прийняття правил збережено. Старі дані очищаються за [окремою інструкцією](MEDIA_REMOVAL_2026-11-10_UA.md).

## Локальні перевірки

```bash
cd /srv/mistblossom/dashboard
npm ci --no-audit --no-fund
npm run check:release-docs
npm run check:audit-hardening
npm run check:media-removal
npm run build:ci
cd /srv/lihvodruida-site
npm ci --no-audit --no-fund
npm run build:ci
```

На тестовій БД окремо виконати PostgreSQL/upgrade перевірки. PGlite-тести не підтверджують
конфігурацію production PostgreSQL, Cloudflare, зовнішні квоти чи доставку в реальний Discord.

## Відкат

До очищення БД можна повернути попередній перевірений код/образи та відповідний cron.
Після очищення дані видаленого модуля відновлюються лише з резервної копії.
Не запускати старий моніторинг із порожніми квитанціями: він може повторити повідомлення.
Не видаляти квитанції `discordPublications` решти модулів або cooldown Battle.net/Raider.IO.
