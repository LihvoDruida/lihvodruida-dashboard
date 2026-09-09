# Mistblossom Vanguard Dashboard

Приватна dashboard-панель для керування гільдією **Mistblossom Vanguard**: заявки, профілі, персонажі Battle.net, рейди, Discord-повідомлення, правила, контент сайту й статуси інтеграцій.

## Що вміє

- Discord login із рольовим доступом: учасник, наставник новачків, офіцер, гільдмайстер.
- Профілі учасників із Battle.net персонажами.
- Вибір мейн-персонажа й рейдової ролі.
- Стандартизація серверного Discord nickname у форматі `Ім’я [Мейн, Альт1, Альт2]`.
- Автооновлення даних персонажів перед записом на рейд.
- Рейдові оголошення з Discord-кнопками запису.
- Live-оновлення сторінки рейду без ручного F5.
- Заявки до гільдії через Firebase Firestore.
- Динамічні фільтри заявок без повного reload.
- Discord embed/rules editor із live preview, лімітами й mobile/desktop preview.
- Керування контентом для новин і гайдів сайту.
- Компактний статус Discord, Battle.net, GitHub і Firebase.

## Технології

- Next.js 15 App Router;
- React 19;
- TypeScript;
- Firebase Admin SDK / Firestore;
- GitHub REST API;
- Discord OAuth + Bot API;
- Battle.net OAuth + WoW Profile API;
- Docker + Nginx на власному сервері;
- Сервіс бота (`bot/`) — приймає Discord-взаємодії; панель їх з інтернету не приймає.

## Швидкий старт

```bash
npm install
cp .env.example .env.local
npm run dev
```

Відкрити:

```text
http://localhost:3000
```

## Production

```bash
npm run verify
npm run build
npm run start
```

`npm run verify` запускає TypeScript typecheck і ESLint через сучасний ESLint CLI.

Продакшн збирається в Docker-образ (`output: "standalone"`) і піднімається через `docker compose`. Покроково — [`docs/ua/SELF_HOSTING.md`](docs/ua/SELF_HOSTING.md).

## Основні env variables

Мінімально для production потрібні:

```env
SESSION_SECRET=
DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.lihvodruida.pp.ua
DASHBOARD_ALLOWED_HOSTS=dashboard.lihvodruida.pp.ua

DISCORD_OAUTH_CLIENT_ID=
DISCORD_OAUTH_CLIENT_SECRET=
DISCORD_GUILD_ID=
# Access groups are configured in Firebase from /dashboard/groups.
# System group IDs: admin=1, moderator=2, mentor=3, member=99. Only 1, 2 and 99 have fixed IDs.
DISCORD_LIVE_ACCESS_SYNC_SECONDS=90
DISCORD_ROLES_CACHE_SECONDS=300
DISCORD_BOT_TOKEN=

GITHUB_OWNER=LihvoDruida
GITHUB_REPO=lihvodruida.github.io
GITHUB_TOKEN=
GUILD_APPLICATIONS_LABEL=guild-application

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

BATTLENET_CLIENT_ID=
BATTLENET_CLIENT_SECRET=
BATTLENET_ENABLED_REGIONS=eu
WOW_GUILD_NAME=Mistblossom Vanguard

RAID_RULES_URL=
RAID_IMAGES_BRANCH=live
RAID_IMAGES_DIRECTORY=assets/img/raids-img
RAID_IMAGES_PUBLIC_BASE_URL=https://lihvodruida.pp.ua
RAID_TIME_ZONE=Europe/Kyiv
NEXT_PUBLIC_RAID_TIME_ZONE=Europe/Kyiv
```

Повний список є у документації.

## Документація

- [Опис функціоналу](docs/ua/FUNCTIONALITY.md)
- [API документація](docs/ua/API.md)
- [Змінні середовища](docs/ua/ENVIRONMENT_VARIABLES.md)
- [Інструкція розгортання](docs/ua/DEPLOYMENT.md)
- [Перехід admin → dashboard і новий GitHub](docs/ua/DASHBOARD_DOMAIN_AND_GITHUB_MOVE.md)
- [English README](README.md)

## Ролі доступу

- **Учасник:** профіль, персонажі, рейди, запис, правила.
- **Наставник новачків:** усі права учасника + перегляд заявок без BattleTag і без посилання на джерело заявки. Адмін і модератор бачать повні дані заявки, включно з BattleTag.
- Live-sync ролей потребує `DISCORD_BOT_TOKEN` і `DISCORD_GUILD_ID`; якщо Discord тимчасово недоступний, admin/moderator/mentor-сесії знижуються до member до наступної успішної перевірки.
- Discord-авторизація перевіряє членство на сервері, бан і дублікати персонажів перед входом. Live-перевірка сесії також видаляє Firebase-профіль, якщо користувач уже не на сервері. Бот має мати доступ до читання банів сервера.
- **Офіцер:** заявки, профілі, рейди, склади, модерація, Discord embed.
- **Гільдмайстер:** повний доступ, правила, контент, системні статуси.

## Важливі нюанси

- Бот не може змінити nickname власнику сервера Discord.
- Для зміни nickname роль бота має бути вище ролі користувача.
- Якщо Discord interactions обробляє Worker, Interaction Endpoint у Discord Developer Portal має вести на Worker.
- Якщо Worker викликає dashboard, shared tokens мають збігатися.
- `FIREBASE_PRIVATE_KEY` у `.env.production` зберігай одним рядком з escaped `\n` — код сам перетворить їх у переноси.

## Склад гільдії `/guild`

Сторінка `/guild` доступна всім авторизованим ролям dashboard: учасникам, наставникам новачків, офіцерам і гільдмайстру. Картка персонажа веде на профіль власника тільки тоді, коли персонаж однозначно привʼязаний до одного профілю; дублікати навмисно не лінкуються.
Вона показує живий склад гільдії з Battle.net Guild Roster API та Raider.IO: RIO `ALL`, `DPS`, `HEALER`, `TANK`, item level, клас, спек, роль, фракцію та посилання Raider.IO.

Дані більше не залежать від `scripts/update_guild.py` або згенерованих файлів. Dashboard сам отримує склад через серверну інтеграцію, кешує результат у Firebase, а якщо Firebase не налаштований — використовує короткий in-memory cache поточного runtime.

Основні змінні:

```env
GUILD_ROSTER_REGION=eu
GUILD_ROSTER_REALM=terokkar
GUILD_ROSTER_NAME=Mistblossom Vanguard
GUILD_ROSTER_CACHE_TTL_SECONDS=1800
PROFILE_CHARACTER_LINK_CACHE_SECONDS=120
GUILD_ROSTER_REFRESH_CONCURRENCY=6
GUILD_ROSTER_MEMBER_LIMIT=500
RAIDERIO_ACCESS_KEY=
```

`BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET` або `BATTLENET_CLIENT_ID` / `BATTLENET_CLIENT_SECRET` потрібні для Battle.net application token. Кнопка “Оновити склад” викликає `/api/guild/refresh` і примусово перезбирає кеш з Battle.net + Raider.IO.

## Обмеження авторизації за Discord-роллю

У `/dashboard` → `Керування` є блок **Авторизація та реєстрація**. Там можна вибрати Discord-роль, без якої користувач не зможе увійти в dashboard або пройти реєстрацію через кнопку правил.

Значення зберігаються у Firebase:

```text
/dashboardSettings/authAccessPolicy
```

Fallback через env:

```env
AUTH_ACCESS_RESTRICTIONS_ENABLED=true
AUTH_ACCESS_REQUIRE_CONFIGURED_ROLE=true
AUTH_ACCESS_ALLOW_SERVER_OWNER=true
AUTH_ACCESS_ALLOW_EMERGENCY_TOKEN_LOGIN=false
AUTH_ACCESS_REQUIRED_ROLE_IDS=
```

Безпечний режим увімкнений за замовчуванням: `AUTH_ACCESS_REQUIRE_CONFIGURED_ROLE=true`. Якщо роль не вибрана, не-власники сервера не пройдуть Discord OAuth. `AUTH_ACCESS_ALLOW_EMERGENCY_TOKEN_LOGIN=false` не дає резервному token-входу обходити перевірку Discord-сервера і ролей.
