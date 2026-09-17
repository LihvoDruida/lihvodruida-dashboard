# Автоматичний склад гільдії

Сторінка `/guild` більше не є тригером для важкої синхронізації. На власному VPS актуалізацію виконує `cron`-контейнер, а браузер читає вже підготовлений стан із PostgreSQL-сумісного storage layer.

## Потік даних

1. `deploy/cron/run-cron.sh` раз на 2 хвилини викликає `POST /api/guild/sync` внутрішньою Docker-мережею.
2. Endpoint приймає лише bearer-токен `INTERNAL_API_TOKEN` (legacy `CRON_SECRET` / `GUILD_ROSTER_SYNC_SECRET` ще приймаються route handler-ом для сумісності).
3. Раз на `GUILD_ROSTER_FULL_REFRESH_SECONDS` перечитується авторитетний Battle.net guild roster, тому нові/видалені персонажі автоматично потрапляють у базу.
4. Деталі Battle.net і Raider.IO оновлюються короткими відновлюваними батчами з TTL та існуючим rate-limit cooldown.
5. **Battle.net є авторитетним джерелом персонажа:** імʼя/realm, клас, раса, фракція, активний spec/role, avatar, guild rank та item level беруться з Blizzard. Raider.IO не має права перезаписувати ці поля.
6. Raider.IO використовується лише як enrichment: поточний M+ score (`all/dps/healer/tank`), raid progression і посилання на RIO-профіль. `gear` у Raider.IO більше не запитується, бо item level уже приходить з Blizzard.
7. M+ score читається з актуального `mythic_plus_scores_by_season[].scores`; `segments` використовується лише як сумісний fallback/джерело кольору. HTTP/network помилка Raider.IO не позначається як успішне оновлення, тому після cooldown запис реально повторюється.
8. `/guild` раз на 60 секунд робить тільки легке cache-only читання БД. Коли вкладка прихована, polling не виконується; при поверненні сторінка одразу перевіряє нову ревізію.

## Типові production значення

```env
GUILD_ROSTER_CLIENT_DRIVEN_SYNC_ENABLED=false
GUILD_ROSTER_AUTO_SYNC_ENABLED=true
GUILD_ROSTER_AUTO_SYNC_STEPS=2
GUILD_ROSTER_FULL_REFRESH_SECONDS=21600
GUILD_ROSTER_BATTLENET_TTL_SECONDS=21600
GUILD_ROSTER_RAIDERIO_TTL_SECONDS=21600
GUILD_ROSTER_BATTLENET_STEP_SIZE=8
GUILD_ROSTER_RAIDERIO_STEP_SIZE=5
RAIDERIO_RATE_LIMIT_COOLDOWN_SECONDS=900
```

Це налаштування орієнтоване на VPS 2 vCPU / 4 GB: синхронізація не створює один великий процес на 100+ персонажів, а поступово заповнює базу.

## Що бачить користувач

- окремий швидкий фільтр ролі `Tank / Heal / DPS`;
- окремий вибір RIO segment;
- пошук за персонажем, realm, class, spec і raid;
- class/spec/faction filters;
- RIO та item-level ranges;
- фільтр конкретного raid;
- `Закриття рейду`: є прогрес / Normal clear / Heroic clear / Mythic clear / без raid data;
- сортування за RIO, ilvl, raid progress, ім'ям або guild rank;
- 25 / 50 / 100 записів на сторінці;
- live-індикатор фази серверної синхронізації.

Власник сервера зберігає кнопку `Оновити зараз` для примусового старту синхронізації. Звичайні користувачі не можуть запускати масові Battle.net/Raider.IO запити через `/api/guild/refresh`; їм доступне тільки cache-only читання.

## Сумісність зі старими записами

Міграція БД не потрібна. Старі записи без `raidProgression` нормалізуються в порожній масив і поступово доповнюються під час наступних Raider.IO кроків.

## Ручна перевірка на VPS

Один серверний крок синхронізації можна запустити без браузера:

```bash
make guild-sync
```

Команда виконується через вже запущений `cron`-контейнер і використовує його `INTERNAL_CRON_TOKEN`; секрет у командний рядок хоста вручну вводити не потрібно.
