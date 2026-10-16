# HTTP 421 для внутрішньої автоматизації Discord — виправлення v3.8.79

Дата: 14.10.2026, Київ. Основа: наданий повний архів v3.8.78 R6.5.

## Підтверджена причина

Cron викликає POST /api/dashboard/discord/profile-nicknames/automation через
http://dashboard:3000 з Authorization: Bearer INTERNAL_API_TOKEN.
Маршрут існує і перевіряє секрет, але його не було в isInternalBearerApiPath()
у dashboard/src/proxy.ts. Proxy відхиляв внутрішній Host до route handler,
тому черга синхронізації не виконувалася, а бот публікував security-події.
Ці конкретні події є помилкою маршрутизації власного cron; самі по собі вони
не свідчать про зовнішню атаку. IP unknown відповідає прямому внутрішньому
запиту без заголовків клієнтської IP-адреси.

У наданому експорті: 1983 записи, з них 214 proxy.host_rejected:
- 209 для profile-nicknames/automation;
- 5 для member-cleanup/automation, лише 11.10.2026 07:51–08:07 UTC.

В актуальному наданому коді member-cleanup/automation вже входить до переліку.
Новий тест перевіряє також його проходження. Старі 5 записів не доводять
наявність цієї помилки у v3.8.78.

Повтори через 15 хвилин спричиняє run-job.sh: після помилок пауза зростає
60 → 120 → 240 → 480 → 900 секунд. Нормальний інтервал черги — 60 секунд.

## Зміни

1. Додано точний profile-nicknames/automation до внутрішніх bearer API у proxy.ts.
2. dashboard:3000 не додано до загального публічного allowlist.
3. Перевірка значення секрету у route handler залишилась обов'язковою.
4. Додано check-internal-cron-proxy.cjs, запуск через npm run check:internal-cron-proxy.
5. Перевірку включено у npm run verify та npm run build:ci.
6. Версію dashboard/package.json та кореневі записи package-lock.json оновлено до 3.8.79.

## Перевірки

Регресійний тест виконує реальний TypeScript-код proxy, security та route handler.
Адаптер NextResponse і виконання черги замінено ізольованими тестовими залежностями;
PostgreSQL та Discord не викликаються. Типи знімає вбудований Node 24 API.

До виправлення тест відтворив блокування профільного cron-маршруту.
Після виправлення: **21/21 успішно**:
- усі 10 варіантів cron-запитів, прочитані з реального run-cron.sh;
- валідний токен запускає чергу без сесії та Cloudflare-маркера і без rejection-події;
- відсутній токен блокується перевіркою Host;
- короткий/неправильний токен та відсутня конфігурація секрету не запускають чергу;
- x-worker-stats-token також потребує правильного секрету;
- сторонній Host та інший admin API не отримують виняток;
- публічний Host зберігає перевірку Cloudflare і авторизації;
- збій черги повертає 503 для повторної спроби.

Також успішні check-api-security (92 mutation routes), check-security-performance
(97 інваріантів), check-platform-hardening (15), check-footer-version (9),
check-newcomer-onboarding та inspect-ci (465 файлів, 0 blocking issues).

Обмеження локальної перевірки: check-nickname-warnings, check-discord-member-cleanup
і check-automation-status не завершились через відсутній встановлений typescript.
Повні npm run verify, typecheck, lint та Next.js/Docker build локально не виконано:
залежності проєкту не встановлено. Це не реліз, перевірений на живому VPS.
Новий ізольований тест не потребує npm-залежностей. Повний build:ci має виконатися
під час складання dashboard на VPS.

## Встановлення

1. Зробити резервну копію поточного коду. Розпакувати вміст guild_header_work
   поверх кореня проєкту. Зберегти свої .env та .env.production.
2. У корені проєкту виконати:

```sh
docker compose build dashboard
docker compose up -d --no-deps --force-recreate dashboard cron
docker compose ps
docker compose logs --since=5m dashboard cron
```

Перескладання потрібне: proxy входить до образу dashboard, заміна файлу на
диску без build не змінить запущений код. Пересоздання cron очищає його тимчасову
15-хвилинну паузу після попередніх помилок. Під час рестарту dashboard короткі
транспортні збої cron можливі; наступна спроба має відновитися.

3. Після healthy-стану dashboard перевірити лог cron:
   OK /api/dashboard/discord/profile-nicknames/automation.
   Нових HTTP 421/proxy.host_rejected для цього маршруту не має бути.
   Порожня черга не обов'язково змінить Discord-нік; для перевірки фактичної зміни
   потрібен готовий елемент черги та належні Discord-права.

Міграції БД та зміни секретів для цього виправлення не потрібні.
На VPS зміни в межах цієї роботи не встановлювалися.
