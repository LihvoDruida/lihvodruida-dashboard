# Зміна канонічного домену панелі

## Ціль

Панель має відкриватися за новою адресою:

```text
https://dashboard.lihvodruida.pp.ua
```

Попередній `admin`-піддомен більше не є канонічним. Код залишає legacy redirect для старих шляхів `/admin/*` і `/api/admin/*`, але нові посилання, env, Discord OAuth, Battle.net OAuth, cron і Worker мають використовувати `dashboard`.

## Що змінено в коді

- Сторінки панелі перенесені з `src/app/admin/*` у `src/app/dashboard/*`.
- API панелі перенесені з `src/app/api/admin/*` у `src/app/api/dashboard/*`.
- Додано redirect-сумісність:
  - `/admin` → `/dashboard`;
  - `/admin/<path>` → `/dashboard/<path>`;
  - `/api/admin/<path>` → `/api/dashboard/<path>` з HTTP `307`, щоб не губити метод POST/PUT/PATCH/DELETE.
- Canonical URL замінено на `https://dashboard.lihvodruida.pp.ua`.
- планова чистка акаунтів ходить на `/api/dashboard/profiles/orphan-cleanup/apply` (розклад — у `deploy/cron/run-cron.sh`).
- `DASHBOARD_URL` і `NEXT_PUBLIC_DASHBOARD_URL` тепер мають пріоритет над legacy alias `ADMIN_DASHBOARD_URL`.

## DNS, Nginx і сертифікат

1. У DNS-реєстратора (або Cloudflare) додай запис на IP сервера:

```text
Type: A       Name: dashboard    Value: <IP сервера>
Type: AAAA    Name: dashboard    Value: <IPv6, якщо є>
```

2. У `deploy/nginx/dashboard.conf` заміни домен у трьох місцях: `server_name`
   в обох блоках і шляхи до сертифікатів.

3. Випусти сертифікат на новий домен:

```bash
cd /srv/mistblossom
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d dashboard.lihvodruida.pp.ua
docker compose exec nginx nginx -s reload
```

4. Старий піддомен можна лишити в DNS і додати окремий `server`-блок із
   `return 301 https://dashboard.lihvodruida.pp.ua$request_uri;`. Код усе одно
   переводить старі `/admin/*` на `/dashboard/*`, але зовнішній redirect
   економить один зайвий перехід.

## Змінні середовища

У `dashboard/.env.production` на сервері онови:

```env
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua
```

Якщо у файлі ще лишились старі змінні:

```env
ADMIN_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_ADMIN_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
```

їх краще видалити або замінити на `https://dashboard.lihvodruida.pp.ua`. Код підтримує їх як fallback, але вони більше не мають бути основними.

Якщо тимчасово залишаєш обидва домени, дозволені hosts можна вказати так:

```env
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua,<попередній-піддомен>
```

Коли переконаєшся, що все працює через `dashboard`, прибери попередній піддомен з allowlist.

## Discord Developer Portal

Онови OAuth2 redirect URL:

```text
https://dashboard.lihvodruida.pp.ua/api/auth/discord/callback
```

Якщо Discord interactions йдуть напряму в Next.js fallback, endpoint має бути:

```text
https://dashboard.lihvodruida.pp.ua/api/discord/interactions
```

Взаємодії приймає сервіс бота; endpoint у Discord не змінюється, але `bot/.env.production` має знати новий адрес панелі.

## Battle.net Developer Portal

Онови redirect URI:

```text
https://dashboard.lihvodruida.pp.ua/api/auth/battlenet/callback
```

## Cloudflare Access / Zero Trust

Якщо використовується Cloudflare Access, у protected application заміни host:

```text
dashboard.lihvodruida.pp.ua
```

Попередній піддомен краще тримати окремо тільки як тимчасовий redirect або прибрати повністю після перевірки.

## Worker / Discord buttons / rules buttons

У Worker secrets/env онови всі значення, які посилаються на dashboard:

```env
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
```

Якщо у Worker лишився hardcoded URL старої панелі, заміни його на `https://dashboard.lihvodruida.pp.ua`.

## Перенесення на новий GitHub

Панель більше не привʼязана до Git-провайдера: деплой робить `deploy.sh` на
сервері, а не хук платформи. Тому переїзд репозиторію — це просто зміна remote.

```bash
git remote rename origin old-origin
git remote add origin https://github.com/<owner>/<new-repo>.git
git push -u origin main
```

На сервері:

```bash
cd /srv/mistblossom
git remote set-url origin https://github.com/<owner>/<new-repo>.git
git pull
./deploy/scripts/deploy.sh
```

## GitHub env для контенту сайту

Це змінні для роботи панелі з GitHub API (контент сайту), не для деплою. Якщо переносиш сайт/контент у новий GitHub repo, онови:

```env
GITHUB_OWNER=<новий owner>
GITHUB_REPO=<новий repo>
GITHUB_CONTENT_BRANCH=main
GITHUB_TOKEN=<token із доступом до нового repo>
```

Якщо сайт `lihvodruida.pp.ua` лишається у старому repo `lihvodruida.github.io`, ці змінні не чіпай.

## Перевірка після деплою

1. Відкрити `https://dashboard.lihvodruida.pp.ua/login`.
2. Увійти через Discord.
3. Відкрити `/dashboard`, `/dashboard/groups`, `/dashboard/discord`, `/dashboard/logs`.
4. Перевірити, що `/admin` автоматично перекидає на `/dashboard`.
5. Перевірити, що `/api/dashboard/profiles/orphan-cleanup` доступний тільки з правильним bearer/token або авторизованою сесією.
6. Перевірити OAuth:
   - Discord login callback;
   - Battle.net callback;
   - rules accept flow.
7. Перевірити планові задачі: `docker compose logs -f cron` — у логах мають бути рядки `OK /api/...`.

## Коміт

```text
refactor(dashboard): move admin routes to dashboard domain

- move management pages from /admin to /dashboard
- move management API routes from /api/admin to /api/dashboard
- add legacy redirects for old /admin and /api/admin links
- switch canonical dashboard domain to dashboard.lihvodruida.pp.ua
- update cron schedule, docs and env examples for the new dashboard domain
- keep admin as an access role name, not as the panel URL
```
