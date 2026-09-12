# Mistblossom Vanguard

Панель управління гільдією World of Warcraft: профілі, рейди, рейд-пули,
заявки, склад гільдії, інструменти Discord.

**Продакшн:** https://guild.lihvodruida.pp.ua

Уся система працює на власному сервері. Зовнішніх сервісів для роботи немає:
дані — у власному PostgreSQL, Discord-взаємодії приймає власний бот, планові
задачі виконує власний контейнер.

---

## Структура

| Каталог | Призначення |
|---------|-------------|
| [`dashboard/`](dashboard/) | Next.js: бізнес-логіка, база, сторінки, API |
| [`bot/`](bot/) | Discord-бот: перевірка підпису, миттєвий ACK, маршрутизація в панель |
| [`shared/`](shared/) | `@mistblossom/discord-contract` — спільний розбір `custom_id` |
| [`deploy/`](deploy/) | nginx, systemd, cron, скрипти бекапу |
| [`docs/`](docs/) | документація |

---

## Документація

Точка входу — [`docs/README.md`](docs/README.md).

| Документ | Про що |
|----------|--------|
| [Архітектура](docs/ARCHITECTURE.md) | сервіси й межі відповідальності |
| [Розгортання](docs/DEPLOYMENT.md) | з нуля: сервер, Cloudflare, TLS, запуск |
| [Налаштування](docs/CONFIGURATION.md) | усі змінні оточення |
| [Експлуатація](docs/OPERATIONS.md) | контроль, оновлення, бекапи, інциденти |
| [База даних](docs/DATABASE.md) | PostgreSQL, перенесення, обслуговування |

---

## Швидкий старт на сервері

```bash
cd /srv/mistblossom
make cert-self    # тимчасовий сертифікат, щоб піднявся nginx
make up           # перевірки + збірка + послідовний запуск
make cert         # справжній сертифікат
```

| Команда | Що робить |
|---------|-----------|
| `make up` | перевіряє конфігурацію, збирає образи, піднімає стек по черзі |
| `make start` | те саме без перезбірки |
| `make check` | тільки перевірки, нічого не запускає |
| `make restart` | повний перезапуск |
| `make stop` | коректна зупинка у зворотному порядку |
| `make cert` | випуск і поновлення сертифіката |
| `make backup` | бекап бази з перевіркою цілісності |
| `make logs` / `make ps` | логи і стан контейнерів |

`make` використовується замість прямого виклику скриптів навмисно: він не
залежить від біта виконання, який регулярно губиться при перенесенні файлів
через Windows або SFTP.

Автостарт після перезавантаження сервера — `systemctl enable --now mistblossom`.

---

## Локальний запуск

**Панель:**

```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000 або http://0.0.0.0:3000
```

Для безпечної HTTP-перевірки вже запущеної локальної панелі: `npm run smoke:http`. Скрипт перевіряє health і всі статичні сторінки без POST/DELETE.

**Бот:**

```bash
cd bot
npm install
cp .env.example .env
npm start            # http://localhost:8080
npm test             # перевірка підпису + контракт
```

Не комітьте реальні секрети з `.env.local`, `.env.production`, `bot/.env`.

---

## Продакшн

```bash
cd /srv/mistblossom
make up
curl -fsS https://guild.lihvodruida.pp.ua/api/health
```

Покроково — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).


## VPS performance preset

The production Make/Docker flow is tuned for 2 vCPU / 4 GB RAM / 40 GB SSD. See `docs/PERFORMANCE.md`.
