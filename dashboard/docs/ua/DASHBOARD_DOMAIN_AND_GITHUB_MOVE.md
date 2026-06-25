# Перехід з `admin` на `dashboard` без повного переїзду Vercel

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
- `vercel.json` cron перенесено на `/api/dashboard/profiles/orphan-cleanup/apply`.
- `DASHBOARD_URL` і `NEXT_PUBLIC_DASHBOARD_URL` тепер мають пріоритет над legacy alias `ADMIN_DASHBOARD_URL`.

## Vercel: замінити домен без нового проєкту

1. Відкрий Vercel → потрібний project.
2. Перейди в **Settings → Domains**.
3. Додай:

```text
dashboard.lihvodruida.pp.ua
```

4. Для піддомену у DNS реєстратора треба CNAME. Vercel у Domains покаже точне значення, на яке має дивитися CNAME.
5. Після підтвердження нового домену прибери або залиш попередній піддомен тільки як redirect. Якщо залишаєш старий домен у Vercel, він буде вести на цей самий project, а код переведе старі `/admin/*` на `/dashboard/*`.

## NIC.ua / DNS

У DNS-зоні `lihvodruida.pp.ua` створи або зміни запис:

```text
Type: CNAME
Host: dashboard
Value: <значення, яке показує Vercel для цього домену>
TTL: Auto або 300
```

Не копіюй CNAME навмання з чужого проєкту. Правильне target-значення бере саме Vercel у Settings → Domains для твого project.

## Vercel Environment Variables

У Vercel → Project → **Settings → Environment Variables** онови production, preview і development, якщо вони використовуються:

```env
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua
```

Якщо в Vercel ще є старі змінні:

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

Якщо interactions йдуть через Cloudflare Worker, endpoint у Discord не змінюється, але Worker env має знати новий dashboard URL.

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

## Перенесення на новий GitHub без повного переїзду Vercel

Правильний варіант — не створювати новий Vercel project, а перепідключити Git repository в існуючому project.

1. Створи новий GitHub repository.
2. Завантаж поточний код у новий repository:

```bash
git remote -v
git remote set-url origin https://github.com/<owner>/<new-repo>.git
git push -u origin main
```

Якщо хочеш зберегти старий remote:

```bash
git remote rename origin old-origin
git remote add origin https://github.com/<owner>/<new-repo>.git
git push -u origin main
```

3. У Vercel відкрий існуючий project → **Settings → Git**.
4. У Connected Git Repository від’єднай старий repo або зміни підключений repository на новий.
5. Перевір production branch: `main`.
6. Зроби тестовий commit у новий repo. Vercel має створити preview/production deploy із цього repo.

## GitHub env для контенту сайту

Це не Vercel Git integration, а змінні для роботи dashboard із GitHub API. Якщо переносиш сайт/контент у новий GitHub repo, онови:

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
7. Перевірити cron у Vercel: `/api/dashboard/profiles/orphan-cleanup/apply`.

## Коміт

```text
refactor(dashboard): move admin routes to dashboard domain

- move management pages from /admin to /dashboard
- move management API routes from /api/admin to /api/dashboard
- add legacy redirects for old /admin and /api/admin links
- switch canonical dashboard domain to dashboard.lihvodruida.pp.ua
- update Vercel cron, docs and env examples for the new dashboard domain
- keep admin as an access role name, not as the panel URL
```
