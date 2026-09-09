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

## Локальний запуск

**Панель:**

```bash
cd dashboard
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

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
docker compose up -d
curl -fsS https://guild.lihvodruida.pp.ua/api/health
```

Покроково — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
