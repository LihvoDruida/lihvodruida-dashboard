# Документація Mistblossom Vanguard

Панель управління гільдією World of Warcraft.
Продакшн: **https://guild.lihvodruida.pp.ua**

---

## З чого почати

| Ситуація | Документ |
|----------|----------|
| Продовження дорожньої карти: R6.8, навігація рейдів і опитувань | [R6.8 та перевірки](./roadmap/R6_8_RAID_LIST_NAVIGATION_2026-10-14.md) |
| Продовження дорожньої карти: R6.7, стан публікацій | [R6.7 та перевірки](./roadmap/R6_7_PUBLICATION_WORKBENCH_2026-10-14.md) |
| Продовження дорожньої карти: R6.6, робота із заявками | [R6.6 та перевірки](./roadmap/R6_6_APPLICATION_WORKBENCH_2026-10-14.md) |
| Розгортаю з нуля на новому сервері | [DEPLOYMENT.md](./DEPLOYMENT.md) |
| Треба зрозуміти, з чого складається система | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Шукаю, за що відповідає змінна оточення | [CONFIGURATION.md](./CONFIGURATION.md) |
| Щось зламалось у проді | [OPERATIONS.md](./OPERATIONS.md) |
| Питання про базу: бекап, міграція, обслуговування | [DATABASE.md](./DATABASE.md) |
| Третє оновлення: повний каталог профілів | [R3 та перевірки](./roadmap/R3_PROFILE_DIRECTORY_2026-10-11.md) |
| Друге оновлення: надійна публікація Discord | [R2 та відкат](./roadmap/R2_DISCORD_PUBLICATION_2026-10-11.md) |
| Перше оновлення за планом діагностики: атомарність PostgreSQL | [R1 та відкат](./roadmap/R1_POSTGRES_ATOMICITY_2026-10-11.md) |

---

## Основні документи

**[ARCHITECTURE.md](./ARCHITECTURE.md)** — з яких сервісів складається система,
чому бот винесений окремо від панелі, що лежить у спільному контракті.

**[DEPLOYMENT.md](./DEPLOYMENT.md)** — розгортання з нуля: сервер, Docker,
Cloudflare (DNS, TLS, WAF), сертифікат, запуск, планові задачі, збірка на
слабкій машині, дії після розгортання.

**[CONFIGURATION.md](./CONFIGURATION.md)** — усі змінні оточення трьох файлів
конфігурації, що з чим має збігатися, генерація секретів, прапорці діагностики.

**[OPERATIONS.md](./OPERATIONS.md)** — щоденна перевірка, стан сервісів,
оновлення, спостереження, резервні копії, типові проблеми, аварійні дії.

**[DATABASE.md](./DATABASE.md)** — власний PostgreSQL: як влаштоване сховище,
перенесення даних із Firestore, бекапи, обслуговування.

---

## Довідник

| Документ | Про що |
|----------|--------|
| [reference/FUNCTIONALITY.md](./reference/FUNCTIONALITY.md) | що вміє панель: розділи, ролі, сценарії |
| [reference/API.md](./reference/API.md) | HTTP-ендпоїнти панелі |
| [reference/raid-polls.md](./reference/raid-polls.md) | рейд-пули: модель даних, Discord-взаємодії, `custom_id` |
| [reference/raid-composition.md](./reference/raid-composition.md) | алгоритм формування складу й вибору дня |
| [reference/account-cleanup.md](./reference/account-cleanup.md) | очищення акаунтів, які вийшли з Discord |
| [reference/theme-system.md](./reference/theme-system.md) | дизайн-токени й теми |

---

## Структура репозиторію

```
dashboard/    Next.js — уся бізнес-логіка, база, сторінки, API
bot/          Discord-бот: перевірка підпису, ACK, маршрутизація
shared/       @mistblossom/discord-contract — спільний розбір custom_id
deploy/       nginx, systemd, cron, скрипти бекапу
docs/         ця документація
docker-compose.yml
```
