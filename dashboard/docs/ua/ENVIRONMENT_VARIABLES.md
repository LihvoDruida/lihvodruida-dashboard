# Змінні середовища

Усі secrets мають бути тільки server-side. Значення з `NEXT_PUBLIC_*` доступні в браузері, тому не клади туди токени, private keys або OAuth secrets.

## Мінімальний production-набір

Для повного production потрібні: `SESSION_SECRET`, `DASHBOARD_URL`, `NEXT_PUBLIC_DASHBOARD_URL`, `DASHBOARD_ALLOWED_HOSTS`, `DISCORD_OAUTH_CLIENT_ID`, `DISCORD_OAUTH_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_APPLICATIONS_COLLECTION`, `BATTLENET_CLIENT_ID`, `BATTLENET_CLIENT_SECRET`, `WOW_GUILD_NAME`, `RAID_RULES_URL`, `RAID_TIME_ZONE`, `NEXT_PUBLIC_RAID_TIME_ZONE`.

## Спільні з Cloudflare Worker

Передавай у Worker тільки те, що Worker реально виконує. Якщо Worker обробляє Discord interactions, rules buttons або raid buttons, тоді частина значень має бути однакова в dashboard і Worker.

| Variable | Статус | Навіщо | Worker |
|---|---|---|---|
| `DISCORD_PUBLIC_KEY` | required для interactions | Перевірка Ed25519 Discord interaction signature. | Так, якщо Worker приймає interactions. |
| `DISCORD_BOT_TOKEN` | required для Discord REST | Ролі, kick, nickname, embed, повідомлення рейдів. | Так, якщо Worker виконує Discord REST. |
| `DISCORD_GUILD_ID` | required | ID сервера. | Так, якщо Worker працює з сервером. |
| `DISCORD_RULES_STATS_TOKEN` | optional shared secret | Захист stats/raid Worker endpoints. | Так, має збігатися. |
| `WORKER_STATS_TOKEN` | optional alias | Alias для shared Worker token. | Так, має збігатися. |
| `INTERNAL_PROFILE_LOOKUP_TOKEN` | required для lookup | Worker викликає `/api/profile/discord-lookup` або raid action endpoint. | Так, має збігатися. |
| `DISCORD_ROLE_ASSIGN_CONCURRENCY` | optional | Concurrency видачі ролей. | Якщо Worker видає ролі. |
| `DISCORD_ROLE_ASSIGN_MAX_CONCURRENCY` | optional | Max concurrency видачі ролей. | Якщо Worker видає ролі. |
| `FIREBASE_PROJECT_ID` | required для заявок | Firebase project id. | Так, якщо Worker створює/модерує заявки. |
| `FIREBASE_CLIENT_EMAIL` | required secret | Service account email. | Так, якщо Worker створює/модерує заявки. |
| `FIREBASE_PRIVATE_KEY` | required secret | Service account private key. | Так, якщо Worker створює/модерує заявки. |
| `FIREBASE_APPLICATIONS_COLLECTION` | optional | Firestore-колекція заявок, default `guildApplications`. | Так, якщо потрібно відрізнити колекцію. |
| `RAID_RULES_URL` | conditional | Посилання на правила рейдів у відповідях. | Якщо Worker відповідає на raid buttons. |
| `RAID_TIME_ZONE` | conditional | Timezone рейдів. | Якщо Worker формує Discord timestamps. |
| `DASHBOARD_URL` | conditional | Посилання назад у dashboard. | Якщо Worker показує dashboard links. |

## Повний список змінних

### Core, session, security

| Variable | Обов’язковість | Опис |
|---|---|---|
| `SESSION_SECRET` | required | Секрет для підпису session cookie, мінімум 32 символи. |
| `NEXTAUTH_SECRET` | alias | Legacy fallback для `SESSION_SECRET`. |
| `SESSION_MAX_AGE_SECONDS` | optional | Час життя сесії, default 7 днів, max 30 днів. |
| `DASHBOARD_URL` | required | Канонічний server-side URL dashboard. |
| `NEXT_PUBLIC_DASHBOARD_URL` | required | Публічний URL dashboard для клієнта. |
| `ADMIN_DASHBOARD_URL` | alias | Alias для redirect у рейдових routes. |
| `NEXT_PUBLIC_ADMIN_DASHBOARD_URL` | alias | Public alias для redirect у рейдових routes. |
| `NEXTAUTH_URL` | alias | Legacy fallback для URL dashboard. |
| `DASHBOARD_ALLOWED_HOSTS` | required | Дозволені hostnames через кому. |
| `SECURITY_REQUIRE_CLOUDFLARE` | optional | `false/off` — вимкнено; `true/warn` — лише логувати відсутність Cloudflare headers; `strict` — блокувати запити без Cloudflare headers у production. |
| `SECURITY_STRICT_ORIGIN_CHECKS` | optional | Додаткові origin checks, вмикати обережно. |
| `SECURITY_HSTS_HEADER` | optional | Кастомне значення HSTS. |
| `DASHBOARD_DEBUG_LOGS` | optional | Детальні dashboard logs. |
| `SECURITY_DEBUG_LOGS` | optional | Детальні security logs. |
| `ADMIN_DASHBOARD_TOKEN` | optional secret | Аварійний admin login. Ротувати після використання. |
| `NODE_ENV` | system | Runtime mode, задається платформою. |

### Discord OAuth, ролі, бот

| Variable | Обов’язковість | Опис |
|---|---|---|
| `DISCORD_OAUTH_CLIENT_ID` | required | Discord OAuth client id. |
| `DISCORD_OAUTH_CLIENT_SECRET` | required secret | Discord OAuth client secret. |
| `DISCORD_CLIENT_ID` | alias | Legacy alias для client id. |
| `DISCORD_CLIENT_SECRET` | alias secret | Legacy alias для client secret. |
| `DISCORD_GUILD_ID` | required | Discord server id. |
| `DISCORD_GUILD_NAME` | optional | Fallback назва гільдії/сервера. |
| `DISCORD_LIVE_ACCESS_SYNC_SECONDS` | optional | Інтервал live-перевірки Discord-ролей для авторизованих користувачів. Потребує `DISCORD_BOT_TOKEN` + `DISCORD_GUILD_ID`. Підвищені сесії знижуються до member, якщо Discord тимчасово недоступний. За замовчуванням: `90`. |
| `DISCORD_ROLES_CACHE_SECONDS` | optional | TTL кешу назв Discord-ролей для превʼю доступу в профілі. За замовчуванням: `300`. |
| `DISCORD_ALLOW_GUILD_MEMBERS` | optional | Якщо true і member ролі не задані, пускає будь-якого учасника сервера. |
| `DISCORD_BOT_TOKEN` | required для Discord actions | Bot token для Discord REST. Потрібен також для перевірки банів/членства під час авторизації; бот має мати доступ до читання банів сервера. |
| `DISCORD_CHANNEL_ID` | optional | Default канал для старих/default publish flows. |
| `DISCORD_PUBLIC_KEY` | required для interactions | Discord application public key. |
| `DISCORD_INTERACTIONS_ENDPOINT` | required якщо є Worker | Base URL Worker interactions. |
| `DISCORD_RULES_STATS_ENDPOINT` | optional | Worker endpoint статистики правил. |
| `DISCORD_RAID_RULES_STATS_ENDPOINT` | optional | Worker endpoint статистики raid rules. |
| `DISCORD_RAID_RULES_SIGNUPS_ENDPOINT` | optional | Worker endpoint підписів raid rules. |
| `DISCORD_RULES_STATS_TOKEN` | optional shared secret | Shared token dashboard ↔ Worker. |
| `WORKER_STATS_TOKEN` | optional shared alias | Alias shared token. |
| `DISCORD_RAID_MESSAGE_ENDPOINT` | optional | Worker endpoint для публікації/оновлення рейдових повідомлень. |
| `DISCORD_GUILD_CHANNELS_ENDPOINT` | optional | Worker endpoint для читання списку текстових каналів. Dashboard додає `guild_id`, а якщо endpoint недоступний, використовує `DISCORD_CHANNEL_ID` або ручний ID у формі рейду. |
| `DISCORD_CHANNELS_CACHE_SECONDS` | optional | TTL кешу списку Discord-каналів. За замовчуванням: `300`. |
| `DISCORD_ROLE_ASSIGN_CONCURRENCY` | optional | Concurrency видачі Discord ролей. |
| `DISCORD_ROLE_ASSIGN_MAX_CONCURRENCY` | optional | Max concurrency видачі Discord ролей. |

### GitHub-контент і Firebase-заявки

| Variable | Обов’язковість | Опис |
|---|---|---|
| `GITHUB_OWNER` | required | GitHub owner/org. |
| `GITHUB_REPO` | required | GitHub repository. |
| `GITHUB_TOKEN` | required secret | Token для керування контентом GitHub Pages. |
| `FIREBASE_APPLICATIONS_COLLECTION` | optional | Firestore-колекція нових заявок, default `guildApplications`. |
| `GITHUB_CONTENT_BRANCH` | required для контенту | Гілка для news/guides/images. |
| `GITHUB_BRANCH` | alias | Fallback alias для content branch. |
| `NEXT_PUBLIC_SITE_BASE_URL` | required для preview | Публічний URL сайту. |
| `SITE_BASE_URL` | required для server-side | Server-side URL сайту. |
| `GITHUB_STATUS_CLEANUP_CONCURRENCY` | optional | Concurrency очищення status labels. |
| `APPLICATION_BULK_STATUS_CONCURRENCY` | optional | Concurrency масової модерації заявок. |
| `APPLICATION_BULK_STATUS_MAX_CONCURRENCY` | optional | Max concurrency масової модерації. |

### Firebase profiles/raids/applications

| Variable | Обов’язковість | Опис |
|---|---|---|
| `FIREBASE_PROJECT_ID` | required | Firebase project id. |
| `FIREBASE_CLIENT_EMAIL` | required secret | Service account email. |
| `FIREBASE_PRIVATE_KEY` | required secret | Service account private key, зазвичай з `\\n`. |
| `PROFILE_ID_SECRET` | optional secret | Секрет для stable profile id, fallback на `SESSION_SECRET`. |

### Battle.net / WoW

| Variable | Обов’язковість | Опис |
|---|---|---|
| `BATTLENET_CLIENT_ID` | required | Battle.net OAuth client id. |
| `BATTLENET_CLIENT_SECRET` | required secret | Battle.net OAuth client secret. |
| `BATTLE_NET_CLIENT_ID` | alias | Legacy alias. |
| `BATTLE_NET_CLIENT_SECRET` | alias secret | Legacy alias. |
| `BLIZZARD_CLIENT_ID` | alias | Legacy alias. |
| `BLIZZARD_CLIENT_SECRET` | alias secret | Legacy alias. |
| `BATTLENET_LOCALE` | optional | Locale WoW API, наприклад `en_GB`. |
| `BATTLE_NET_LOCALE` | alias | Legacy alias. |
| `BLIZZARD_LOCALE` | alias | Legacy alias. |
| `BATTLENET_ENABLED_REGIONS` | required | Regions у UI, для гільдії зазвичай `eu`. |
| `BATTLENET_REGIONS` | alias | Fallback alias. |
| `BATTLENET_DEFAULT_REGION` | optional | Default region. |
| `BATTLE_NET_DEFAULT_REGION` | alias | Legacy alias. |
| `WOW_REGION` | alias | Legacy fallback region. |
| `BATTLENET_REQUEST_TIMEOUT_MS` | optional | Timeout Battle.net API. |
| `BATTLENET_SCAN_CONCURRENCY` | optional | Concurrency сканування, `0` — adaptive. |
| `BATTLENET_SCAN_MAX_CONCURRENCY` | optional | Max concurrency сканування. |
| `BATTLENET_CANDIDATE_TTL_MINUTES` | optional | Час життя тимчасового списку Battle.net кандидатів після OAuth. Типово `30` хвилин. |
| `BATTLENET_SIGNUP_REFRESH_CONCURRENCY` | optional | Concurrency автооновлення перед рейдом. |
| `BATTLENET_SIGNUP_REFRESH_REST_LIMIT` | optional | Скільки альтів оновлювати після мейна перед рейдом. |
| `WOW_GUILD_NAME` | required | Назва гільдії для фільтрації персонажів. |
| `WOW_GUILD_REALM` | optional | Строгий realm filter. |
| `BATTLENET_ALLOWED_GUILD_NAME` | alias | Legacy alias для `WOW_GUILD_NAME`. |
| `BATTLENET_ALLOWED_GUILD_REALM` | alias | Legacy alias для `WOW_GUILD_REALM`. |
| `GUILD_ROSTER_REGION` | optional | Region для live-сторінки складу гільдії `/guild`, fallback на `WOW_REGION`. |
| `GUILD_ROSTER_REALM` | optional | Realm slug для Battle.net Guild Roster API, fallback на `WOW_REALM` / `WOW_GUILD_REALM`. |
| `GUILD_ROSTER_NAME` | optional | Назва гільдії для live-складу, fallback на `WOW_GUILD_NAME`. |
| `GUILD_ROSTER_CACHE_TTL_SECONDS` | optional | TTL кешу складу гільдії у Firebase/in-memory, default 1800 секунд. |
| `GUILD_ROSTER_REFRESH_CONCURRENCY` | optional | Concurrency оновлення персонажів Raider.IO для `/guild`. |
| `PROFILE_CHARACTER_LINK_CACHE_SECONDS` | optional | TTL кешу привʼязок персонаж -> профіль на `/guild`. Дублікати навмисно не лінкуються. За замовчуванням: `120`. |
| `GUILD_ROSTER_MEMBER_LIMIT` | optional | Максимум персонажів для одного оновлення складу. |

### Raider.IO і продуктивність

| Variable | Обов’язковість | Опис |
|---|---|---|
| `RAIDERIO_ACCESS_KEY` | optional secret | Raider.IO access key для стабільнішого live-оновлення складу і заявок. |
| `RAIDERIO_ENABLED` | optional | Вмикає Raider.IO enrichment. |
| `RAIDERIO_CONCURRENCY` | optional | Legacy/general concurrency Raider.IO. |
| `RAIDERIO_LOOKUP_CONCURRENCY` | optional | Adaptive lookup concurrency. |
| `RAIDERIO_LOOKUP_MAX_CONCURRENCY` | optional | Max lookup concurrency. |
| `DASHBOARD_MAX_CONCURRENCY` | optional | Глобальний adaptive concurrency cap. |
| `CONTENT_READ_CONCURRENCY` | optional | Concurrency читання контенту. |
| `CONTENT_READ_MAX_CONCURRENCY` | optional | Max concurrency читання контенту. |


### Рейди

| Variable | Обов’язковість | Опис |
|---|---|---|
| `RAID_ANNOUNCEMENTS_ENABLED` | optional | Feature flag рейдових оголошень. |
| `RAID_RULES_URL` | required | Discord-посилання на правила рейдів. |
| `NEXT_PUBLIC_RAID_RULES_URL` | alias public | Public alias для правил рейдів. |
| `DISCORD_RAID_RULES_URL` | alias | Legacy alias для правил рейдів. |
| `RAID_TIME_ZONE` | required | Timezone рейдів, наприклад `Europe/Kyiv`. |
| `RAID_LIFECYCLE_SECRET` | optional | Bearer token для `/api/raids/lifecycle` cron/manual job. Може використовувати `CRON_SECRET` або `INTERNAL_API_TOKEN`. |
| `RAID_DISCORD_DELETE_AFTER_START_HOURS` | optional | Через скільки годин після старту автоматично закривати рейд і вимикати Discord-кнопки. За замовчуванням `4`. |
| `RAID_DISCORD_DELETE_AFTER_CLOSE_MINUTES` | optional | Через скільки хвилин після закриття можна видаляти Discord-оголошення. Запис рейду залишається в архіві панелі. За замовчуванням `60`. |
| `NEXT_PUBLIC_RAID_TIME_ZONE` | required public | Public timezone для UI. |
| Автозакриття рейдів | built-in | Рейд автоматично вважається закритим у момент старту за `RAID_TIME_ZONE`; окремої затримки після старту немає. |
| `RAID_LIST_CACHE_TTL_MS` | optional | TTL кешу списку рейдів. |
| `RAID_ITEM_CACHE_TTL_MS` | optional | TTL кешу окремого рейду. |

## Практичні правила

1. Усі secrets додавати тільки у Vercel/Worker env, не комітити в репозиторій.
2. Значення `DISCORD_RULES_STATS_TOKEN`, `WORKER_STATS_TOKEN`, `INTERNAL_PROFILE_LOOKUP_TOKEN` генерувати окремо, не використовувати OAuth secrets.
3. Якщо Worker обробляє interactions, у Discord Developer Portal Interaction Endpoint має вести на Worker, а не на Vercel.
4. Якщо Vercel route `/api/discord/interactions` використовується як fallback, у Vercel має бути `DISCORD_PUBLIC_KEY`.
5. Для Firebase private key залишай `\\n` у Vercel env, код сам перетворить їх у переноси рядків.

> ID ролей доступу більше не налаштовуються в env. Групи dashboard, Discord role ID та права керуються у Firebase на `/dashboard/groups`.

