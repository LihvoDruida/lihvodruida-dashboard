# Огляд функціоналу Worker

Цей Worker відповідає за серверну частину інтеграцій Mistblossom Vanguard між сайтом, GitHub, Discord, dashboard і Cloudflare KV.

## 1. Заявки до гільдії

Worker приймає заявки з публічного сайту через `POST /api/guild-applications` або `POST /`.

### Що робить create flow

1. Перевіряє `Origin` через `ALLOWED_ORIGINS`.
2. Читає JSON body з лімітом приблизно 96 KB.
3. Відкидає honeypot-поле `website`, якщо воно заповнене.
4. Нормалізує поля заявки:
   - `region`;
   - `characterName`;
   - `faction`;
   - `realm`;
   - `className`;
   - `discord`;
   - `battleTag`;
   - `sourceCreator` / `sourcePlatform` / `sourceOther`;
   - `availability`.
5. Валідує обов’язкові поля:
   - `region`;
   - `characterName`;
   - `faction`;
   - `realm`;
   - `availability`.
6. Якщо фракція `horde`, поле `battleTag` обов’язкове.
7. Створює GitHub Issue у репозиторії `GITHUB_OWNER/GITHUB_REPO`.
8. Додає labels:
   - `GUILD_APPLICATIONS_LABEL`, за замовчуванням `guild-application`;
   - `status:review`.
9. Надсилає Discord embed у `DISCORD_CHANNEL_ID`, якщо налаштовані `DISCORD_BOT_TOKEN` і `DISCORD_CHANNEL_ID`.
10. Підтягує Raider.IO profile для персонажа й додає в embed Mythic+ та raid progression блоки.
11. Додає Discord buttons `Прийняти` / `Відхилити`.
12. За можливості зберігає Discord message reference в GitHub Issue body як HTML marker.

### Асинхронне Discord-повідомлення

За замовчуванням Discord notification виконується через `ctx.waitUntil`, щоб користувач швидше отримав відповідь після створення GitHub Issue. Це керується змінною `APPLICATION_DISCORD_ASYNC`.

- `APPLICATION_DISCORD_ASYNC=1` або відсутня змінна — Discord notification у фоні Worker runtime.
- `APPLICATION_DISCORD_ASYNC=0` — Worker чекає завершення Discord notification перед відповіддю.

## 2. Список заявок

`GET /api/guild-applications` і `GET /` читають GitHub Issues з label `GUILD_APPLICATIONS_LABEL`.

Worker підтримує:

- пагінацію по GitHub pages;
- фільтр статусу `review`, `accepted`, `declined`, `all`;
- aliases: `pending`, `approved`, `rejected`;
- фільтр класу;
- пошук по `q`;
- сортування `created` або `updated`;
- напрям `asc` або `desc`;
- diagnostics тільки якщо debug дозволений.

Повертаються вже нормалізовані поля заявки: номер issue, статус, персонаж, realm, region, faction, class, labels, GitHub URL, dates.

## 3. Модерація заявок через Discord buttons

Discord embed заявки містить кнопки:

- `guild_application:accepted:<issueNumber>`;
- `guild_application:declined:<issueNumber>`.

Коли модератор натискає кнопку, Worker:

1. Перевіряє Discord request signature через `DISCORD_PUBLIC_KEY`.
2. Перевіряє роль модератора через `DISCORD_ALLOWED_ROLES`, якщо список заданий.
3. Захищає від спаму cooldown-ом 2.5 секунди на користувача.
4. Читає GitHub Issue.
5. Видаляє старі status labels.
6. Додає `status:accepted` або `status:declined`.
7. Закриває GitHub Issue:
   - accepted → `state_reason: completed`;
   - declined → `state_reason: not_planned`.
8. Додає коментар у GitHub Issue з інформацією про модератора.
9. Оновлює Discord message: колір, статус, footer, timestamp.
10. Прибирає кнопки з повідомлення.

## 4. Discord rules buttons

Worker підтримує кнопки правил із prefix `mbv1`.

### Guild rules flow

Для звичайних правил гільдії прийняття максимально просте:

1. У публічному embed є кнопка `Прийняти правила`.
2. Користувач натискає кнопку.
3. Worker одразу видає одну або кілька заданих ролей через Discord API.
4. Dashboard login, profile, Battle.net, main character або перехід на сайт не потрібні.
5. Відповідь про результат показується приватно тільки цьому користувачу.

Кнопка `Відмовитися` залишає safety confirmation, бо фінальна дія кикає користувача із сервера.

### Дії правил

- Прийняти правила: Worker одразу видає одну або кілька ролей через Discord API.
- Відмовитися: Worker після confirmation кикає користувача із сервера.
- Повторне прийняття не дублює статистику.
- Якщо користувач уже має всі потрібні ролі, Worker відповідає, що дія вже виконана.

### Статистика правил

Якщо налаштований KV binding `RULES_STATS`, Worker зберігає:

- `rules:<guildId>:accepted`;
- `rules:<guildId>:declined`;
- `rules:<guildId>:user:<discordId>`;
- `rules:<guildId>:updated_at`.

Один користувач не накручує статистику повторними кліками. Якщо рішення зміниться, попередній counter коригується.

## 5. Raid-rules signup

Кнопки raid-rules використовують той самий `/api/discord-interactions`, але окремий namespace у KV.

Flow:

1. Користувач натискає кнопку підпису на правила рейду.
2. Worker відкриває confirmation ephemeral panel.
3. Після підтвердження Worker викликає dashboard profile lookup endpoint.
4. Dashboard має підтвердити, що Discord user авторизований і має selected main character.
5. Якщо профілю або main немає, Worker повертає приватне повідомлення з кнопками:
   - увійти через Discord;
   - відкрити профіль;
   - правила рейду;
   - сторінка рейду, якщо є `raidId`.
6. Якщо все добре, Worker записує signup у KV.

KV keys:

- `raid-rules:<guildId>:user:<discordId>`;
- `raid-rules:<guildId>:updated_at`.

Signup record містить:

- Discord ID;
- Discord label/name;
- dashboard profile id;
- selected main character;
- timestamp підпису.

## 6. Raid announcement buttons

Worker підтримує custom IDs:

```text
mbv1:raid:<raidId>:going
mbv1:raid:<raidId>:late
mbv1:raid:<raidId>:skipped
```

Ці кнопки не обробляють рейд напряму в Worker. Worker проксить дію в dashboard endpoint:

```text
/api/raids/<raidId>/discord-action
```

або в endpoint із `DASHBOARD_RAID_ACTION_ENDPOINT`, якщо він явно заданий.

Worker передає dashboard:

- action: `going`, `late`, `skipped`;
- Discord user id;
- Discord user label;
- guild id;
- channel id;
- message id;
- source marker `discord-interaction-worker`.

Dashboard повертає content/components, які Worker показує користувачу в ephemeral response. Якщо dashboard каже, що потрібна авторизація або main character, Worker додає help buttons.

## 7. Relay Discord raid messages

`POST /api/discord-raid-message` дозволяє dashboard створювати, редагувати або видаляти Discord raid announcement messages через Worker.

Підтримуються actions:

- `create`;
- `edit`;
- `delete`.

Worker захищає endpoint bearer/stats token-ом і не дозволяє unrestricted mentions. Role mentions дозволені тільки через явний список role IDs.

## 8. Список Discord каналів

`GET /api/discord-guild-channels` читає guild і channels через Discord Bot API.

Повертаються тільки text/news channels:

- `type = 0` — text channel;
- `type = 5` — announcement/news channel.

Worker також пробує запропонувати канал за назвою, якщо там є слова `raid`, `рейд`, `анонс`, `announce`, `оголош`.

## 9. CORS і безпека

Worker дозволяє тільки origins із:

- `ALLOWED_ORIGINS`;
- `SITE_BASE_URL`;
- `PUBLIC_SITE_URL`;
- `ADMIN_DASHBOARD_URL`;
- `DASHBOARD_URL`;
- hardcoded fallback `https://lihvodruida.pp.ua` і `https://admin.lihvodruida.pp.ua`.

Stats/message endpoints додатково можуть вимагати token:

- `Authorization: Bearer <token>`;
- або `X-Worker-Stats-Token: <token>`.

Debug responses через `?debug=1` або `?diag=1` працюють тільки якщо `ALLOW_DEBUG_QUERY=1`. Production має тримати `ALLOW_DEBUG_QUERY=0`.

## 10. Observability

Worker додає telemetry headers:

- `X-Guild-Worker-Request-Id`;
- `X-Guild-Worker-Duration-Ms`.

Логи проходять через sanitizer, який прибирає tokens, email і authorization-like поля.
