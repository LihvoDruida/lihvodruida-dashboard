# Інструкція розгортання

## 1. Що це

Mistblossom Vanguard Dashboard — приватна панель керування гільдією. Вона відповідає за:

- Discord login і рольовий доступ;
- заявки з Firebase Firestore;
- профілі учасників;
- Battle.net персонажів;
- Discord server nickname format;
- рейди, склади та Discord-кнопки запису;
- Discord embed/rules editor;
- контент сайту;
- статуси інтеграцій.

## 2. Технології

- Next.js 16 App Router;
- React 19;
- TypeScript;
- Firebase Admin SDK / Firestore;
- GitHub REST API;
- Discord OAuth + Bot API;
- Battle.net OAuth + WoW Profile API;
- власний сервер під Docker (Nginx + Next.js standalone) для dashboard;
- контейнер `bot` для Discord-взаємодій.

## 3. Підготовка сервісів

### Discord

1. Створи Discord Application.
2. Додай OAuth2 redirect:

```text
https://dashboard.lihvodruida.pp.ua/api/auth/discord/callback
```

3. Створи bot і додай його на сервер.
4. Дай bot permissions:
   - View Channels;
   - Send Messages;
   - Embed Links;
   - Read Message History;
   - Manage Roles;
   - Manage Nicknames;
   - Kick Members, якщо використовується кнопка “Відмовитись” у правилах.
5. Роль бота має бути вище ролей, які він видає, і вище ролей користувачів, яких він має перейменовувати.
6. Власника сервера бот перейменувати не може — це обмеження Discord.

### Discord Interaction Endpoint

Якщо interactions обробляє Worker:

```text
https://<worker-domain>/api/discord-interactions
```

Якщо interactions обробляє Next.js fallback:

```text
https://dashboard.lihvodruida.pp.ua/api/discord/interactions
```

У тому середовищі, яке приймає interactions, має бути `DISCORD_PUBLIC_KEY`.

### Battle.net

1. Створи Battle.net Developer Application.
2. Додай redirect URI:

```text
https://dashboard.lihvodruida.pp.ua/api/auth/battlenet/callback
```

3. Заповни `BATTLENET_CLIENT_ID` і `BATTLENET_CLIENT_SECRET`.
4. Для Mistblossom Vanguard зазвичай достатньо:

```env
BATTLENET_ENABLED_REGIONS=eu
BATTLENET_DEFAULT_REGION=eu
BATTLENET_LOCALE=en_GB
WOW_GUILD_NAME=Mistblossom Vanguard
```

### GitHub

Потрібен token із доступом:

- доступ читання/запису до Firestore-колекції заявок;
- Contents read/write, якщо використовується керування контентом.

Змінні:

```env
GITHUB_OWNER=LihvoDruida
GITHUB_REPO=lihvodruida.github.io
GITHUB_TOKEN=...
GUILD_APPLICATIONS_LABEL=guild-application
GITHUB_CONTENT_BRANCH=main
```

### Firebase

1. Створи Firebase project.
2. Увімкни Firestore.
3. Створи Service Account key.
4. Заповни:

```env
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## 4. Локальний запуск

```bash
npm install
cp .env.example .env.local
npm run dev
```

Після цього відкрий:

```text
http://localhost:3000
```

Для локального тесту не вмикай:

```env
SECURITY_REQUIRE_CLOUDFLARE=false
```

## 5. Production deploy на власному сервері

Повний покроковий гайд — [`SELF_HOSTING.md`](SELF_HOSTING.md). Тут — стисла
версія для тих, у кого сервер уже підготовлений.

```bash
cd /srv/mistblossom
git pull
cp dashboard/.env.example dashboard/.env.production   # один раз, далі — правити
nano dashboard/.env.production
./deploy/scripts/deploy.sh
```

`deploy.sh` збирає образ, піднімає стек і чекає, поки `/api/health` відповість.
Якщо новий образ не піднявся, скрипт повертає попередній — панель не лишається
лежати через невдалий деплой.

### Що має бути в оточенні

`.env.production` читає контейнер під час старту. Виняток —
`NEXT_PUBLIC_DASHBOARD_URL`: Next вшиває його в клієнтський бандл ще на збірці,
тому він передається як build-arg через `DASHBOARD_PUBLIC_URL` у `.env` поруч
із `docker-compose.yml`.

```env
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua
```

Домен має збігатися в усіх трьох місцях. `DASHBOARD_ALLOWED_HOSTS` перевіряє
`Host` кожного POST-запиту: якщо там чужий домен, усі форми панелі почнуть
відповідати 403.

### Домен і TLS

A-запис (і AAAA за наявності) на IP сервера. Сертифікат Let's Encrypt видає
`certbot` із того самого compose-стека, Nginx віддає ACME-виклик із
`/.well-known/acme-challenge/`. Продовження — systemd-таймер
`mistblossom-certbot.timer`.

### Планові задачі

Замість Cron Jobs — контейнер `cron` у стеку. Він стукає в ті самі ендпоїнти
внутрішньою мережею з `Authorization: Bearer $CRON_SECRET`:

| Розклад | Ендпоїнт | Що робить |
|---------|----------|-----------|
| `*/10 * * * *` | `/api/raids/lifecycle` | публікація й закриття рейдів |
| `*/5 * * * *` | `/api/polls/close-due` | автозакриття рейд-пулів |
| `0 4 * * *` (Київ) | `/api/dashboard/profiles/orphan-cleanup/apply` | чистка акаунтів |

`CRON_SECRET` має збігатися зі значенням у `.env.production` — його перевіряє
`verifyInternalBearerToken`.

## 6. Cloudflare Access / Zero Trust

Cloudflare Access можна використовувати як додатковий зовнішній бар’єр.

Рекомендації:

- Protect application: `dashboard.lihvodruida.pp.ua`;
- Session duration: 12–24h;
- Allow only потрібні email або IdP groups;
- Не замінює внутрішню Discord-role авторизацію, а тільки додає зовнішній захист.

Якщо весь production traffic точно йде через Cloudflare, можна увімкнути:

```env
SECURITY_REQUIRE_CLOUDFLARE=strict
```

На стейджингу без Cloudflare це не вмикати: панель почне відхиляти всі запити.

## 7. Worker deploy

Worker приймає Discord interactions, кнопки правил і рейдів. Він лишається на Cloudflare: стоїть перед Discord, безкоштовний, і його переїзд на власний сервер нічого не дає.

У Worker мають бути ті самі shared secrets:

```env
DISCORD_PUBLIC_KEY=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_RULES_STATS_TOKEN=...
WORKER_STATS_TOKEN=...
INTERNAL_PROFILE_LOOKUP_TOKEN=...
```

Для Firebase-модерації заявок додай також:

```env
GITHUB_OWNER=...
GITHUB_REPO=...
GITHUB_TOKEN=...
GUILD_APPLICATIONS_LABEL=...
```

Якщо Worker викликає dashboard lookup:

```http
GET https://dashboard.lihvodruida.pp.ua/api/profile/discord-lookup?discord_id=...
Authorization: Bearer <INTERNAL_PROFILE_LOOKUP_TOKEN>
```

## 8. Локальні перевірки перед merge

Для повної локальної/CI-перевірки запускай:

```bash
npm run verify
npm run build:ci
```

Збірка образу навмисно не запускає `typecheck` і `lint` (`ignoreBuildErrors: true` у `next.config.mjs`), щоб деплой не витрачав хвилини на перевірки, які вже зробив CI. Строгий шлюз — `npm run build:ci`.

## 9. Post-deploy checklist

### Login

- Відкрити `/login`.
- Увійти через Discord.
- Перевірити роль: member/moderator/admin.
- Перевірити, що member не бачить адмінські розділи.

### Profile

- Відкрити `/profile`.
- Підключити Battle.net.
- Додати персонажа.
- Обрати мейна.
- Встановити raid role preference.
- Задати ім’я.
- Перевірити Discord nickname preview.

### Raids

- Створити тестовий рейд.
- Зберегти чернетку.
- Опублікувати в Discord.
- Натиснути Discord-кнопку запису.
- Перевірити, що оновлюється тільки це рейдове повідомлення.
- Перевірити live sync на сторінці рейду.

### Applications

- Перевірити список заявок.
- Перевірити live фільтри.
- Прийняти/відхилити тестову заявку.
- Перевірити GitHub labels.

### Discord editor

- Створити тестовий embed.
- Завантажити існуюче message link.
- Перевірити preview ПК/Телефон.
- Перевірити ліміти Discord.

### Integrations

- Відкрити dashboard.
- Перевірити “Стан системи”.
- Discord, Battle.net, GitHub, Firebase мають бути `ok` або мати зрозуміле попередження.

## 9. Команди

```bash
npm run dev        # local dev
npm run build      # production build
npm run start      # start built app
npm run typecheck  # TypeScript check
npm run lint       # lint, якщо next lint доступний у версії Next.js
```

## 10. Типові проблеми

### Discord login не працює

Перевір:

- `DISCORD_OAUTH_CLIENT_ID`;
- `DISCORD_OAUTH_CLIENT_SECRET`;
- redirect URI у Discord Developer Portal;
- `DASHBOARD_URL`;
- `DASHBOARD_ALLOWED_HOSTS`.

### Бот не змінює nickname

Причини:

- бот не має `Manage Nicknames`;
- роль бота нижче ролі користувача;
- користувач — власник сервера;
- неправильний `DISCORD_GUILD_ID`;
- неправильний `DISCORD_BOT_TOKEN`.

### Battle.net не показує персонажів

Перевір:

- Battle.net redirect URI;
- `BATTLENET_ENABLED_REGIONS`;
- `WOW_GUILD_NAME`;
- чи персонаж справді в гільдії;
- locale/realm filter.

### Firebase помилка private key

У `.env.production` private key має бути одним рядком з escaped newlines (код сам перетворює `\\n` на справжні переноси):

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Worker не може викликати dashboard

Перевір, що token однаковий:

```env
INTERNAL_PROFILE_LOOKUP_TOKEN=...
```

і що Worker відправляє:

```http
Authorization: Bearer <token>
```
