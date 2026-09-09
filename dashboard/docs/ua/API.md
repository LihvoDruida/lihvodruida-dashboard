# API документація

Базовий URL у production зазвичай:

```text
https://dashboard.lihvodruida.pp.ua
```

У локальному середовищі:

```text
http://localhost:3000
```

## Загальні правила API

- Більшість endpoints працює тільки з активною session cookie.
- Запити на зміну стану проходять перевірку trusted origin.
- Для чутливих дій є rate limit.
- Для великих form/json запитів є body size limit.
- Відповіді API, які не мають кешуватися, повертають `no-store` headers.
- Worker-to-dashboard endpoints використовують Bearer token.

## Авторизація

### `GET /api/auth/discord/start`

Починає Discord OAuth login.

**Доступ:** публічний.

**Query:**

| Назва | Тип | Опис |
|---|---:|---|
| `next` | string | Опціональний шлях повернення після login. |

**Результат:** redirect на Discord OAuth.

---

### `GET /api/auth/discord/callback`

Обробляє Discord OAuth callback.

**Доступ:** публічний callback від Discord.

**Query:**

| Назва | Тип | Опис |
|---|---:|---|
| `code` | string | OAuth code від Discord. |
| `state` | string | CSRF/OAuth state. |

**Результат:** створює session cookie та redirect у dashboard.

---

### `GET /api/auth/battlenet/start`

Починає Battle.net OAuth для підключення персонажів.

**Доступ:** авторизований користувач.

**Query:**

| Назва | Тип | Опис |
|---|---:|---|
| `region` | string | Battle.net region. Наприклад `eu`. |

**Результат:** redirect на Battle.net OAuth.

---

### `GET /api/auth/battlenet/callback`

Обробляє Battle.net OAuth callback, сканує персонажів і зберігає тимчасових кандидатів.

**Доступ:** авторизований користувач із profile id.

**Query:**

| Назва | Тип | Опис |
|---|---:|---|
| `code` | string | OAuth code від Battle.net. |
| `state` | string | OAuth state із region/profile id. |

**Результат:** redirect на профіль із `characterStatus`.

---

### `POST /api/auth/login`

Emergency login через `ADMIN_DASHBOARD_TOKEN`.

**Доступ:** публічний, але потребує правильний token.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `token` | string | Значення `ADMIN_DASHBOARD_TOKEN`. |

**Результат:** session cookie для admin fallback.

---

### `POST /api/auth/logout`

Видаляє session cookie.

**Доступ:** авторизований користувач.

**Результат:** redirect або JSON залежно від клієнта.

---

### `GET /api/auth/logout`

Не виконує logout. Повертає `405`, тому що logout має бути `POST`.

## Заявки

### `GET /api/applications`

Повертає список заявок із Firebase Firestore.

**Доступ:** officer/dashboard для повних даних і дій, включно з BattleTag; наставник новачків для read-only перегляду без BattleTag і посилань на джерело заявки.

**Query:**

| Назва | Тип | Опис |
|---|---:|---|
| `status` | string | `all`, `review`, `accepted`, `declined`. |
| `q` / `search` | string | Пошук по заявці/персонажу. |
| `class` | string | Фільтр за класом. |
| `sort` | string | Сортування, якщо підтримується UI. |

**Response:**

```json
{
  "items": [],
  "counts": {
    "all": 0,
    "review": 0,
    "accepted": 0,
    "declined": 0
  },
  "classOptions": []
}
```

---

### `POST /api/applications/[number]/status`

Змінює статус однієї заявки.

**Доступ:** officer/dashboard.

**Body:** JSON.

| Поле | Тип | Опис |
|---|---:|---|
| `status` | string | `accepted` або `declined`. |

**Що робить:**

- оновлює статус заявки у Firebase Firestore;
- прибирає старі/legacy status labels;
- додає модераційний коментар;
- може закрити issue залежно від логіки moderation module.

---

### `POST /api/applications/bulk-status`

Масово змінює статуси заявок.

**Доступ:** officer/dashboard.

**Body:** JSON.

```json
{
  "items": [
    { "number": 123, "status": "accepted" }
  ]
}
```

**Ліміти:** максимум 50 заявок за один запит.

## Склад гільдії

### `POST /api/guild/refresh`

Примусово оновлює runtime-кеш складу гільдії з Battle.net Guild Roster API та Raider.IO.

**Доступ:** будь-який авторизований користувач dashboard, який має доступ до `/guild`.

**Body:** не потрібен.

**Що робить:**

- отримує актуальний guild roster з Battle.net;
- для кожного персонажа оновлює Raider.IO M+ `ALL`, `DPS`, `HEALER`, `TANK`;
- перераховує середній RIO, середній item level, max RIO/max item level;
- записує кеш у Firebase або in-memory runtime cache.

**Response:**

```json
{
  "ok": true,
  "memberCount": 120,
  "updatedAt": "2026-05-04T00:00:00.000Z",
  "source": "Battle.net Guild Roster API + Raider.IO Character API • cache",
  "error": null
}
```

---

## Профіль

### `POST /api/profile/name`

Зберігає поле `Ім’я` у профілі.

**Доступ:** власник профілю.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `preferredName` | string | Ім’я для Discord nickname format. |

**Результат:** redirect на профіль із `characterStatus=profile_name_saved` або error status.

---

### `POST /api/profile/discord-nickname`

Застосовує серверний Discord nickname у форматі `Ім’я [Мейн, Альт1, Альт2]`.

**Доступ:** власник профілю.

**Вимоги:**

- користувач увійшов через Discord;
- профіль існує;
- задане ім’я;
- є Discord bot token;
- бот має `Manage Nicknames`;
- роль бота вище ролі користувача.

**Особливість:** власника сервера бот перейменувати не може. Для owner UI повинен давати copy-flow.

---

### `POST /api/profile/raid-role`

Зберігає ручну рейдову роль або повертає режим Auto.

**Доступ:** власник профілю.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `raidRole` | string | `auto`, `tank`, `healer`, `dps`. |

---

### `POST /api/profile/characters/add`

Додає одного персонажа з тимчасового списку Battle.net-кандидатів у Firebase-профілі.

**Доступ:** власник профілю.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `characterKey` | string | Stable key персонажа. |

---

### `POST /api/profile/characters/bulk-add`

Додає кілька персонажів із тимчасового списку Battle.net-кандидатів у Firebase-профілі.

**Доступ:** власник профілю.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `characterKey` | string[] | Один або кілька ключів персонажів. |

---

### `POST /api/profile/characters/main`

Встановлює мейн-персонажа.

**Доступ:** власник профілю.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `characterKey` | string | Key збереженого персонажа. |

**Побічний ефект:** якщо ручна рейдова роль була прив’язана до старого мейна, вона очищається.

---

### `POST /api/profile/characters/remove`

Видаляє персонажа з профілю.

**Доступ:** власник профілю.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `characterKey` | string | Key збереженого персонажа. |

---

### `GET /api/profile/discord-lookup`

Приватний server-to-server lookup для Worker або bot flow.

**Доступ:** тільки Bearer token.

**Headers:**

```http
Authorization: Bearer <INTERNAL_PROFILE_LOOKUP_TOKEN>
```

**Query:**

| Назва | Тип | Опис |
|---|---:|---|
| `discord_id` | string | Discord user id. |

**Response:**

```json
{
  "found": true,
  "profileId": "id...",
  "displayName": "Name",
  "mainCharacter": {},
  "hasMainCharacter": true,
  "characterCount": 3
}
```

## Рейди

### `POST /api/raids`

Створює або оновлює рейд у dashboard без обов’язкової публікації в Discord.

**Доступ:** officer/dashboard.

**Body:** form data.

Основні поля:

| Поле | Тип | Опис |
|---|---:|---|
| `raidId` | string | Якщо задано — оновлює існуючий рейд. |
| `title` | string | Назва рейду. |
| `difficulty` | string | `normal`, `heroic`, `mythic`. |
| `date` | string | Дата рейду. |
| `time` | string | Час рейду. |
| `description` | string | Markdown опис. |
| `channelId` | string | Discord channel id. |
| `consumables` | string | `own` або `guild`. |
| `lootMode` | string | Loot mode. |
| `minItemLevel` | number | Мінімальний ilvl. |
| `maxPlayers` | number | Ліміт запису. |

---

### `POST /api/raids/publish`

Зберігає рейд і публікує або оновлює Discord-повідомлення.

**Доступ:** officer/dashboard.

**Body:** form data, аналогічно `/api/raids`.

**Результат:** redirect із toast про створення або оновлення Discord-повідомлення.

---

### `POST /api/raids/[raidId]/attendance`

Оновлює запис поточного користувача на рейд.

**Доступ:** авторизований користувач.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `action` | string | `going`, `late`, `skipped`. |

**JSON mode:** якщо header `x-dashboard-action: live` або `Accept: application/json`, endpoint повертає JSON замість redirect.

**Response у JSON mode:**

```json
{
  "ok": true,
  "toast": {
    "tone": "success",
    "title": "Запис оновлено",
    "message": "..."
  },
  "raid": { "id": "..." },
  "revision": "..."
}
```

---

### `POST /api/raids/[raidId]/discord-action`

Приватний endpoint для сервісу бота, який записує користувача на рейд із Discord-кнопки.

**Доступ:** Bearer token.

**Headers:**

```http
Authorization: Bearer <INTERNAL_PROFILE_LOOKUP_TOKEN або DISCORD_RULES_STATS_TOKEN або WORKER_STATS_TOKEN>
```

**Body:** JSON.

| Поле | Тип | Опис |
|---|---:|---|
| `action` | string | `going`, `late`, `skipped`. |
| `userId` / `user_id` | string | Discord user id. |
| `userName` / `user_name` | string | Discord display name. |
| `channelId` / `channel_id` | string | Discord channel id повідомлення. |
| `messageId` / `message_id` | string | Discord message id. |

**Важливо:** оновлює тільки конкретне Discord-повідомлення рейду.

---

### `GET /api/raids/[raidId]/snapshot`

Повертає live snapshot рейду для polling.

**Доступ:** авторизований користувач. Для неопублікованих рейдів потрібен officer/dashboard.

**Response:**

```json
{
  "ok": true,
  "id": "...",
  "title": "...",
  "status": "published",
  "closed": false,
  "revision": "...",
  "updatedAt": "...",
  "roster": 10,
  "capacity": 20,
  "late": 1,
  "skipped": 2
}
```

---

### `POST /api/raids/[raidId]/close`

Закриває рейд.

**Доступ:** officer/dashboard.

---

### `POST /api/raids/[raidId]/delete`

Видаляє рейд.

**Доступ:** officer/dashboard.

## Discord

### `GET /api/discord/embeds/message`

Завантажує існуюче Discord-повідомлення для редагування.

**Доступ:** officer/dashboard; rules messages — тільки admin.

**Query:**

| Назва | Тип | Опис |
|---|---:|---|
| `message` / `url` / `link` | string | Посилання на Discord message. |
| `mode` | string | `general` або `rules`. |

---

### `POST /api/discord/embeds/publish`

Публікує або редагує Discord embed.

**Доступ:** officer/dashboard; rules mode — тільки admin.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `mode` | string | `general` або `rules`. |
| `ruleType` | string | `guild` або `raid`, тільки для rules. |
| `action` | string | `publish` або `edit`. |
| `channelId` | string | Discord channel id. |
| `messageLink` | string | Для редагування. |
| `content` | string | Текст над embed. |
| `embedJson` | string | JSON embed. |
| `roleIds` | string[] | Ролі для mentions або rules accept. |
| `returnTo` | string | Куди повернутись після дії. |

---

### `POST /api/discord/interactions`

Discord interaction endpoint для кнопок.

**Доступ:** Discord only, перевіряється Ed25519 signature через `DISCORD_PUBLIC_KEY`.

**Підтримує:**

- Discord ping;
- пряме прийняття правил гільдії без входу в dashboard і перевірки профілю;
- підтвердження відмови від правил гільдії;
- підтвердження підпису на правила рейду;
- кнопки запису на рейд `mbv1:raid:<raidId>:going|late|skipped`.

Взаємодії обробляє сервіс бота; цей endpoint — внутрішня точка входу для нього.

## Контент

### `POST /api/content/create`

Створює новину або гайд у GitHub repo.

**Доступ:** admin.

**Body:** multipart form data.

| Поле | Тип | Опис |
|---|---:|---|
| `kind` | string | `news` або `guides`. |
| `title` | string | Заголовок. |
| `description` | string | SEO/preview опис. |
| `body` | string | Markdown content. |
| `categories` | string | Категорії. |
| `tags` | string | Теги. |
| `slug` | string | Slug. |
| `image` | File | Опціональне зображення. |

---

### `POST /api/content/update`

Оновлює існуючу новину або гайд.

**Доступ:** admin.

**Body:** multipart form data. Поля аналогічні create плюс `path`, `date`, `lastModifiedAt`, `existingImage`, `removeImage`.

---

### `POST /api/content/delete`

Видаляє керований content file.

**Доступ:** admin.

**Body:** form data.

| Поле | Тип | Опис |
|---|---:|---|
| `path` | string | Шлях до news/guides markdown file. |

## Інтеграції

### `GET /api/integrations/status`

Повертає compact status інтеграцій.

**Доступ:** officer/dashboard.

**Response:**

```json
{
  "checkedAt": "2026-05-01T00:00:00.000Z",
  "items": [
    {
      "key": "discord",
      "label": "Discord",
      "state": "ok",
      "message": "працює",
      "checkedAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

Можливі `state`:

- `ok`;
- `warning`;
- `error`;
- `unconfigured`.
