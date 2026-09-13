# Налаштування

Усі змінні оточення системи. Файли:

| Файл | Кому належить |
|------|---------------|
| `.env` (поруч із `docker-compose.yml`) | параметри стека: домен, паролі, теги образів |
| `dashboard/.env.production` | панель |
| `bot/.env.production` | Discord-бот |

Шаблони: `.env.example`, `dashboard/.env.example`, `bot/.env.example`.

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
| `INTERNAL_API_TOKEN` | так | єдиний токен bot/cron/dashboard для внутрішніх API |
| `LETSENCRYPT_EMAIL` | так | адреса для сповіщень про закінчення сертифіката |
| `IMAGE_TAG` | ні | тег образів, типово `latest` |
| `BOT_LOG_LEVEL` | ні | `info` / `debug` |
| `NEXT_SECURITY_VERSION` | ні | security-patched Next.js для production Docker build; релізний preset `16.3.5` |

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
| `DATABASE_POOL_SIZE` | ні | розмір пулу, preset для 4 GB VPS — `8`. Має бути помітно меншим за `max_connections` бази |
| `DATABASE_STATEMENT_TIMEOUT_MS` | ні | максимум часу одного SQL-запиту, типово `20000` мс |
| `DATABASE_LOCK_TIMEOUT_MS` | ні | максимум очікування блокування, типово `5000` мс |
| `DATABASE_IDLE_TX_TIMEOUT_MS` | ні | закриває завислу idle-транзакцію, типово `30000` мс |
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
| `DISCORD_PUBLIC_KEY` | через `.env` | у production Compose передає канонічне значення з кореневого `.env`; у local dev можна задати тут |
| `RAID_RULES_URL` | ні | посилання на правила рейду у відповідях бота |

### Внутрішні сервіси

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `BOT_INTERNAL_URL` | ні | типово `http://bot:8080` |
| `INTERNAL_API_TOKEN` | через `.env` | канонічний root token; контейнер `cron` отримує його як `INTERNAL_CRON_TOKEN` |
| `INTERNAL_PROFILE_LOOKUP_TOKEN` | ні | окремий legacy/інтеграційний token для `/api/profile/discord-lookup`, якщо цей endpoint використовується напряму |


### Безпека сесій і edge

| Змінна | Типово | Призначення |
|--------|--------|-------------|
| `SESSION_LIVE_ACCESS_SYNC_ENABLED` | `1` у production | регулярно перевіряє актуальні Discord-ролі, щоб відкликана роль не жила до кінця 7-денної cookie |
| `DISCORD_LIVE_ACCESS_GRACE_SECONDS` | `600` | максимум довіри до останньої успішної Discord-перевірки під час збою API; після цього підвищені ролі деградують до member |
| `RATE_LIMIT_MAX_BUCKETS` | `20000` | верхня межа in-memory rate-limit ключів; захист від memory growth на flood унікальними ключами |
| `SECURITY_REQUIRE_CLOUDFLARE` | `warn` | `strict` блокує публічний трафік, що не пройшов через довірений Cloudflare edge; вмикайте після перевірки DNS/origin |

Nginx сам формує `X-Mistblossom-Trusted-Proxy` та `X-Mistblossom-Country` лише
коли фактичний TCP peer належить Cloudflare. Клієнтські `CF-*`/geo headers напряму
не є джерелом довіри.

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
| `RAID_LIFECYCLE_MIN_INTERVAL_MS` | 45000 | мінімальний інтервал між хвилинними прогонами lifecycle рейдів; захищає від дубльованих запусків |
| `RAID_POLL_CLOSE_DUE_SCAN_LIMIT` | 20 | скільки пулів сканувати за один прохід |

---

## 3. Бот (`bot/.env.production`)

Бот навмисно не знає ні рядка підключення до бази, ні ключів Battle.net.
Йому вони не потрібні, а зайвий секрет у контейнері, який дивиться в
інтернет, — зайвий ризик.

| Змінна | Обовʼязкова | Призначення |
|--------|-------------|-------------|
| `DISCORD_PUBLIC_KEY` | через `.env` | у production Compose передає канонічне значення з root `.env`; для local bot запуску можна задати тут |
| `DISCORD_APPLICATION_ID` | так | Application ID для завершення відкладених interaction-відповідей через Discord webhook API |
| `DASHBOARD_INTERNAL_URL` | так | `http://dashboard:3000` |
| `INTERNAL_API_TOKEN` | через `.env` | у production Compose передає канонічний root token; для local bot запуску можна задати тут |

---

## 4. Що має збігатися між сервісами

Розбіжність тут не дає помилки при старті — вона проявляється як «Дія не
вдалася» в Discord або мовчазний 401 у логах. Перевіряйте разом:

| Значення | Панель | Бот |
|----------|--------|-----|
| `DISCORD_PUBLIC_KEY` | ✓ | ✓ |
| `INTERNAL_API_TOKEN` | ✓ | ✓ |

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
openssl rand -hex 32      # INTERNAL_API_TOKEN
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

Після діагностики приберіть їх: `DEBUG_LOGS` на живому сервері швидко
роздуває журнал.
