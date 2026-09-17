# Локальний HTTP-аудит панелі

Дата перевірки: 2026-09-12.
Базова адреса для локальної перевірки: `http://0.0.0.0:3000`.

## Що перевіряє CI без запуску сервера

У `dashboard/` є окремі source-level gates:

- `npm run check:actions` — звіряє форми, `formAction`, API-посилання, прямі й частину обчислюваних `fetch`/navigation дій з реальними route handlers та HTTP methods;
- `npm run check:site` — звіряє внутрішні переходи з `page` routes, перевіряє `type="button"` та локальні host/security інваріанти;
- `npm run check:imports` — перевіряє всі локальні `@/`, relative import/export;
- `npm run inspect:ci` — загальний аудит репозиторію;
- `npm run build:ci` — typecheck + усі gates вище + production Next build.

На момент цього аудиту:

- 36 `page` routes;
- 80 API route-файлів;
- 0 API route-файлів без HTTP handler;
- 77 UI/API references звірені з API;
- 113 внутрішніх navigation references звірені зі сторінками;
- 115 `<button>` перевірено;
- 1022 локальні import/export references — 0 відсутніх файлів;
- 0 явних `410 Gone` / `501 Not Implemented` заглушок в API;
- bot test suite: 18/18.

## Виправлення для `0.0.0.0:3000`

1. `0.0.0.0` тепер є дозволеним **лише у development** local host. POST/PUT/PATCH/DELETE більше не мають відхилятись тільки через Origin `http://0.0.0.0:3000`.
2. Local-host перевірка більше не довіряє довільним prefix-host типу `0.0.0.0.evil.example` або `localhost.evil.example`.
3. Form redirects через спільний `appBaseUrl(request)` у development залишають користувача на фактичному локальному origin, замість переносу на production `DASHBOARD_PUBLIC_URL`.
4. Discord/Battle.net OAuth state та dashboard session у development мають fallback на legacy cookie names без `Secure`. Це потрібне для plain HTTP `0.0.0.0`; production і далі використовує `__Host-` + `Secure` cookies.
5. Користувацькі повідомлення, що помилково називали PostgreSQL-сумісне сховище «Firebase», замінені на «база даних/сховище». Внутрішні compatibility identifiers не перейменовувались без потреби.
6. Production Docker build тепер запускає `npm run build:ci`, тому образ не повинен збиратися, якщо зламана API/action/page/import перевірка.

## Живий HTTP smoke

Запусти dashboard, а в іншому терміналі:

```bash
cd dashboard
npm run smoke:http
```

За замовчуванням перевіряється `http://0.0.0.0:3000`.
Скрипт робить тільки безпечні `GET`: `/api/health` і всі статичні `page` routes. Він не запускає destructive POST/DELETE. `404`, `405`, `5xx` або network error вважаються помилкою; redirect захищеної сторінки на login є допустимим.

Для конкретних dynamic pages:

```bash
SMOKE_PROFILE_ID=id7d2e19f10b3d2b962f4508e6 \
SMOKE_RAID_ID=<raid-id> \
SMOKE_POLL_ID=<poll-id> \
SMOKE_CHARACTER_KEY=<character-key> \
SMOKE_ADMIN_PATH=<admin-subpath> \
npm run smoke:http
```

Для іншої адреси:

```bash
SMOKE_BASE_URL=http://localhost:3000 npm run smoke:http
```

Для authenticated GET smoke можна передати cookie рядком через `SMOKE_COOKIE`.

## OAuth локально

`DASHBOARD_URL` і `NEXT_PUBLIC_DASHBOARD_URL` повинні збігатися з origin callback, зареєстрованим у Discord/Battle.net. Якщо provider не приймає `0.0.0.0`, відкривай панель через `http://localhost:3000` і реєструй callback на `localhost`.

Source-аудит не може підтвердити реальні Discord permissions, PostgreSQL дані, OAuth provider settings або відповіді зовнішніх API без робочих секретів і запущеного стека. Для цього потрібен live smoke/ручний E2E у твоєму середовищі.
