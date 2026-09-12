# Automatic orphan account cleanup

## Що робить

Перед перевіркою система автоматично оновлює склад гільдії в базі через `refreshGuildRosterApiBatch({ forceRoster: true, bypassCache: true })`. Після цього вона видаляє dashboard-профілі тільки коли виконані обидві умови:

1. Discord-акаунта немає серед учасників Discord-сервера гільдії.
2. Жоден персонаж цього Discord-акаунта не знайдений у збереженому складі гільдії.

Якщо збережений roster порожній, cleanup блокується і не видаляє профілі.

## Що видаляється

- профілі з `dashboardProfiles`;
- індексні привʼязки персонажів з `dashboardProfileCharacterLinks`;
- записи цього акаунта з `dashboardRaids.signups`;
- Discord embed рейдів оновлюється після видалення записів, якщо рейд має активне Discord-повідомлення.

## Автоматичний запуск

Запускає контейнер `cron` зі стека `docker-compose.yml` — щодня о 04:00 за Києвом:

```sh
POST /api/dashboard/profiles/orphan-cleanup/apply
Authorization: Bearer $INTERNAL_API_TOKEN
```

Розклад описаний у `deploy/cron/run-cron.sh`. Для роботи self-hosted cron використовує канонічний `INTERNAL_API_TOKEN`
або `ACCOUNT_CLEANUP_SECRET` у `dashboard/.env.production`.

## Internal cron endpoint

```http
GET /api/dashboard/profiles/orphan-cleanup/apply?force=1
Authorization: Bearer <INTERNAL_API_TOKEN або ACCOUNT_CLEANUP_SECRET>
```

Для ручної перевірки без видалення використовується `GET /api/dashboard/profiles/orphan-cleanup` — він працює як dry-run, якщо не задано `ACCOUNT_CLEANUP_AUTO_APPLY=1`.

## Env

- `ACCOUNT_CLEANUP_SECRET` — окремий секрет для cleanup endpoint.
- `ACCOUNT_CLEANUP_AUTO_APPLY=1` — дозволити автоматичне застосування без `apply=1`.
- `ACCOUNT_CLEANUP_MIN_INTERVAL_MS` — cooldown між запусками.
- `ACCOUNT_CLEANUP_PROFILE_LIMIT` — максимум профілів для перевірки.
- `ACCOUNT_CLEANUP_REFRESH_ROSTER=0` — вимкнути автооновлення roster перед cleanup.
- `ACCOUNT_CLEANUP_ROSTER_REFRESH_STEPS` — кількість batch-кроків roster sync перед cleanup; за замовчуванням `1`, цього достатньо для оновлення списку персонажів складу.
- `RAID_ACCOUNT_CLEANUP_SCAN_LIMIT` — скільки рейдів сканувати для видалення записів.
- `RAID_ACCOUNT_CLEANUP_DISCORD_SYNC_LIMIT` — максимум Discord-повідомлень рейдів для оновлення за один запуск.
