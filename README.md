## Оновлення R6.1 — 3.8.74

У налаштуваннях власного профілю імʼя й фонову синхронізацію Discord-ніку тепер підтверджують однією дією. Додано збережену чергу, видимий стан, відновлення receipt та захист паралельних змін. Повний R6 продовжується окремими релізами.

Оновити dashboard і cron разом; SQL-міграції немає. Деталі, перевірки й межі відновлення: [R6.1](docs/roadmap/R6_1_PROFILE_NICKNAME_2026-10-11.md).

> **R5 — v3.8.73, 11.10.2026:** чернетки груп з відновленням, явним збереженням і перевіркою серверної ревізії; атомарні зміни ID та призначень Discord-ролей.
> Деталі: [R5_GROUP_DRAFTS_2026-10-11.md](docs/roadmap/R5_GROUP_DRAFTS_2026-10-11.md). Стан плану: [IMPLEMENTATION_STATUS.md](docs/roadmap/IMPLEMENTATION_STATUS.md).

> **R4 — v3.8.72, 11.10.2026:** пауза очищення під час роботи, контроль перед відправленням виключення, дедлайни запитів і звірка стану після втрати відповіді.
> Деталі: [R4_MANAGED_CLEANUP_2026-10-11.md](docs/roadmap/R4_MANAGED_CLEANUP_2026-10-11.md).

> **R3 — v3.8.71, 11.10.2026:** повний пошук профілів, серверні фільтри й агрегати за правами, курсорна навігація по 20 записів.
> Деталі: [R3_PROFILE_DIRECTORY_2026-10-11.md](docs/roadmap/R3_PROFILE_DIRECTORY_2026-10-11.md).

> **R2 — v3.8.70, 11.10.2026:** збережені операції публікації рейдів та опитувань,
> захист паралельних запитів і відновлення після збою Discord/БД.
> Деталі: [R2_DISCORD_PUBLICATION_2026-10-11.md](docs/roadmap/R2_DISCORD_PUBLICATION_2026-10-11.md).

> **R1 — v3.8.69, 11.10.2026:** виправлено втрату паралельних змін у
> PostgreSQL; додано інтеграційні перевірки й окремий порядок відкату.
> Деталі: [R1_POSTGRES_ATOMICITY_2026-10-11.md](docs/roadmap/R1_POSTGRES_ATOMICITY_2026-10-11.md).

> **Керування та автоматизація — 11.10.2026:** згрупована адаптивна навігація,
> спільна черга Discord REST, захист повторів та оптимізація Gateway-подій.
> Деталі: [`docs/management/MANAGEMENT_2026-10-11.md`](docs/management/MANAGEMENT_2026-10-11.md).

> **Security Stage 4 — v3.8.68 (2026-10-09)**: Durable Discord Ingress stores
> verified interaction receipts in PostgreSQL *before* the deferred ACK.
> Details: [`docs/security/SECURITY_STAGE4_2026-10-09.md`](docs/security/SECURITY_STAGE4_2026-10-09.md).

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

Новий захист Discord interaction-відповідей: [`docs/security/SECURITY_STAGE3_2026-10-09.md`](docs/security/SECURITY_STAGE3_2026-10-09.md).

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
