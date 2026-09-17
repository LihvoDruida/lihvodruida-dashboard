# 3.8.5 — Raid per-record task scheduler

Цей реліз прибирає залежність lifecycle рейду від широкого scan та від кліку
користувача по застарілій Discord-кнопці.

## Що змінилось

- Нова колекція `dashboardRaidLifecycleTasks`.
- Кожен рейд має незалежні task records із точними `scheduledAtMs`/`dueAtMs`:
  - `registration_close`;
  - `discord_close_sync`;
  - `reminder_send`;
  - `reminder_delete`;
  - `discord_delete`.
- Звичайний minute cron читає тільки `dueAtMs <= now`.
- Кожна task claim-иться транзакційно й виконується окремо.
- Тимчасова помилка Discord/БД не губить задачу: retry 1–15 хв із backoff.
- Save/edit/publish/close/delete перебудовують task plan лише конкретного raid.
- Cron startup і hourly recovery sweep відновлюють task records для старих рейдів.
- Discord interaction більше не виконує auto-close/delete side effects; клік не є
  тригером cleanup. Interaction лише відмовляє у зміні складу після дедлайну та
  за потреби гарантує наявність due task.
- PostgreSQL отримав `documents_due_at_idx`.

## Очікувана поведінка

Якщо запис закривається о 19:30, task `registration_close` має
`scheduledAtMs=19:30`. На першому cron tick після цього часу worker закриває
record у БД і синхронізує disabled Discord buttons. Якщо Discord тимчасово не
відповідає, БД лишається закритою, а task повторює Discord sync без участі
користувача.

Основне Discord-повідомлення має окрему `discord_delete` task на
`raid start + 24h`; reminder cleanup — окрему task на `raid start + 4h`.
