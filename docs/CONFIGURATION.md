# Налаштування

Усі змінні оточення системи. Файли:

| Файл | Кому належить |
|------|---------------|
| `.env` (поруч із `docker-compose.yml`) | параметри стека: домен, паролі, теги образів |
| `dashboard/.env.production` | панель |
| `bot/.env.production` | Discord-бот |

Шаблони: `dashboard/.env.example`, `bot/.env.example`.

> **Секрети тільки серверні.** Усе, що починається з `NEXT_PUBLIC_`, потрапляє
> у бандл браузера. Токени, приватні ключі й OAuth-секрети туди класти не
> можна — вони стануть публічними в момент першого відкриття сторінки.

---

## 1. Стек (`.env`)

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `DASHBOARD_PUBLIC_URL` | так | `https://guild.lihvodruida.pp.ua`. Використовується при збірці образу панелі |
| `POSTGRES_DB` | ні | назва бази, типово `mistblossom` |
| `POSTGRES_USER` | ні | користувач бази, типово `mistblossom` |
| `POSTGRES_PASSWORD` | так | пароль бази. Генеруйте: `openssl rand -base64 32` |
| `DISCORD_PUBLIC_KEY` | так | публічний ключ застосунку Discord для перевірки підпису |
| `INTERNAL_API_TOKEN` | так | спільний секрет бот ↔ панель |
| `CRON_SECRET` | так | токен для планових задач |
| `LETSENCRYPT_EMAIL` | так | адреса для сповіщень про закінчення сертифіката |
| `IMAGE_TAG` | ні | тег образів, типово `latest` |
| `BOT_LOG_LEVEL` | ні | `info` / `debug` |
| `BOT_CRON_ENABLED` | ні | `0` вимикає планувальник бота |

---

## 2. Панель (`dashboard/.env.production`)

### Базові

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `DASHBOARD_URL` | так | `https://guild.lihvodruida.pp.ua` — редіректи й посилання в Discord |
| `NEXT_PUBLIC_DASHBOARD_URL` | так | те саме для клієнтського коду |
| `DASHBOARD_ALLOWED_HOSTS` | так | перелік дозволених `Host`. Захист від host-header injection |
| `SESSION_SECRET` | так | підпис сесійних cookie. Зміна розлогінює всіх |
| `RAID_TIME_ZONE` | так | `Europe/Kyiv` |
| `NEXT_PUBLIC_RAID_TIME_ZONE` | так | те саме для клієнта |

### База даних

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `DATABASE_URL` | так | `postgresql://mistblossom:пароль@postgres:5432/mistblossom` |
| `DATABASE_POOL_SIZE` | ні | розмір пулу, типово 10. Має бути помітно меншим за `max_connections` бази |
| `DATABASE_SSL` | ні | `require` для віддаленої бази. Для локальної не потрібно |

> **Хост у `DATABASE_URL` — це `postgres`**, імʼя сервісу в docker-мережі.
> `localhost` вказують тільки коли скрипт запускається з хост-машини, а не з
> контейнера. Це найчастіша помилка при першому запуску.

### Discord

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `DISCORD_BOT_TOKEN` | так | REST API: ролі, ніки, повідомлення, embed-и |
| `DISCORD_GUILD_ID` | так | ID сервера гільдії |
| `DISCORD_OAUTH_CLIENT_ID` | так | вхід через Discord |
| `DISCORD_OAUTH_CLIENT_SECRET` | так | те саме |
| `DISCORD_PUBLIC_KEY` | так | має збігатися зі значенням у боті |
| `RAID_RULES_URL` | ні | посилання на правила рейду у відповідях бота |

### Внутрішні сервіси

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `BOT_INTERNAL_URL` | ні | типово `http://bot:8080` |
| `INTERNAL_API_TOKEN` | так | має збігатися з `bot/.env.production` |
| `INTERNAL_PROFILE_LOOKUP_TOKEN` | так | бот шукає профіль за Discord ID |
| `CRON_SECRET` | так | контейнер `cron` стукає в ендпоїнти панелі |

### Зовнішні API

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `BATTLENET_CLIENT_ID` | так | привʼязка персонажів WoW |
| `BATTLENET_CLIENT_SECRET` | так | те саме |
| `WOW_GUILD_NAME` | так | назва гільдії для складу |
| `GITHUB_OWNER` | ні | заявки в гільдію через GitHub Issues |
| `GITHUB_REPO` | ні | те саме |
| `GITHUB_TOKEN` | ні | те саме |

### Кеш і продуктивність

| Змінна | Типово | Призначення |
|--------|--------|-------------|
| `PUBLIC_CACHE_TTL_SECONDS` | 120 | кеш публічних даних у памʼяті процесу |
| `PUBLIC_CACHE_DISABLED` | — | `1` вимикає кеш повністю (для діагностики) |
| `GUILD_ROSTER_CACHE_TTL_SECONDS` | 1800 | кеш складу гільдії |
| `RAID_LIFECYCLE_MIN_INTERVAL_MS` | 600000 | мінімальний інтервал між прогонами життєвого циклу рейдів |
| `RAID_POLL_CLOSE_DUE_SCAN_LIMIT` | 20 | скільки пулів сканувати за один прохід |

---

## 3. Бот (`bot/.env.production`)

Бот навмисно не знає ні рядка підключення до бази, ні ключів Battle.net.
Йому вони не потрібні, а зайвий секрет у контейнері, який дивиться в
інтернет, — зайвий ризик.

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `DISCORD_PUBLIC_KEY` | так | перевірка підпису Ed25519. Без нього бот відхиляє всі запити з 401 |
| `DISCORD_BOT_TOKEN` | так | редагування відповідей на взаємодії |
| `DISCORD_GUILD_ID` | так | ID сервера |
| `DASHBOARD_INTERNAL_URL` | так | `http://dashboard:3000` |
| `INTERNAL_API_TOKEN` | так | має збігатися з панеллю |
| `BOT_CRON_ENABLED` | ні | `1` вмикає планувальник, типово увімкнено |
| `BOT_CRON_INTERVAL_MS` | ні | 600000 (10 хв) |
| `ALLOWED_ORIGINS` | ні | CORS для публічних ендпоїнтів |

---

## 4. Що має збігатися між сервісами

Розбіжність тут не дає помилки при старті — вона проявляється як «Дія не
вдалася» в Discord або мовчазний 401 у логах. Перевіряйте разом:

| Значення | Панель | Бот |
|----------|--------|-----|
| `DISCORD_PUBLIC_KEY` | ✓ | ✓ |
| `DISCORD_GUILD_ID` | ✓ | ✓ |
| `INTERNAL_API_TOKEN` | ✓ | ✓ |
| `DISCORD_BOT_TOKEN` | ✓ | ✓ |

Швидка перевірка після деплою:

```bash
docker compose exec dashboard env | grep -E 'DISCORD_PUBLIC_KEY|INTERNAL_API_TOKEN' | sort
docker compose exec bot       env | grep -E 'DISCORD_PUBLIC_KEY|INTERNAL_API_TOKEN' | sort
```

Виводи мають бути ідентичні.

---

## 5. Генерація секретів

```bash
openssl rand -base64 32   # SESSION_SECRET, POSTGRES_PASSWORD
openssl rand -hex 32      # INTERNAL_API_TOKEN, CRON_SECRET
```

`DISCORD_PUBLIC_KEY` не генерується — він береться в Discord Developer Portal,
розділ **General Information → Public Key**.

---

## 6. Прапорці для діагностики

Ці змінні не потрібні в нормальній роботі, але економлять час при розборі
інциденту:

| Змінна | Ефект |
|--------|-------|
| `DEBUG_LOGS=1` | детальні логи бота на кожен запит |
| `PUBLIC_CACHE_DISABLED=1` | вимикає кеш — перевірити, чи проблема в застарілих даних |
| `BOT_CRON_ENABLED=0` | зупиняє планувальник бота, не зупиняючи прийом взаємодій |

Після діагностики приберіть їх: `DEBUG_LOGS` на живому сервері швидко
роздуває журнал.
