# Mistblossom Dashboard 3.13.1

Виправлення збірки 3.13.1: [CHARACTER_DATA_CI_HOTFIX_2026-10-16_UA.md](docs/CHARACTER_DATA_CI_HOTFIX_2026-10-16_UA.md). Поведінкова перевірка сезонів і однаковий набір check-перевірок у verify та Docker build:ci.

Поточний парний реліз: історія сезонів — [RAID_HISTORY_SYNC_2026-10-16_UA.md](docs/RAID_HISTORY_SYNC_2026-10-16_UA.md). Встановити Dashboard 3.13.0 перед Site 4.3.0.

Попередній реліз: стійка доставка заявок у Discord — [APPLICATION_DELIVERY_QUEUE_2026-10-16_UA.md](docs/APPLICATION_DELIVERY_QUEUE_2026-10-16_UA.md). Сумісний із Site 4.2.1.

Поточне виправлення заявок і відновлення мережі: [CONNECTION_RECOVERY_2026-10-16_UA.md](docs/CONNECTION_RECOVERY_2026-10-16_UA.md).

Дашборд і бот працюють на VPS. PostgreSQL — єдине робоче сховище. Публічний сайт 4.2.1 є окремим Next.js-сервісом і використовує вузький внутрішній API дашборда.

Порядок переходу та перевірки: [UNIFIED_INTEGRATION_2026-10-16_UA.md](docs/UNIFIED_INTEGRATION_2026-10-16_UA.md). Цей документ замінює старі інструкції про Jekyll, GitHub Issues/Contents та Firestore.

Звіт поточної інспекції: [SYNC_INSPECTION_2026-10-16_UA.md](docs/SYNC_INSPECTION_2026-10-16_UA.md).

Парний реліз із Site 4.2.1: [SITE_DASHBOARD_SYNC_2026-10-16_UA.md](docs/SITE_DASHBOARD_SYNC_2026-10-16_UA.md). Перевірка ревізій PostgreSQL оновлює контент, склад і заявки на сайті.

Попереднє виправлення надійності CMS: [CONTENT_RELIABILITY_2026-10-16_UA.md](docs/CONTENT_RELIABILITY_2026-10-16_UA.md). Додано унікальні ревізії, безпечний повтор створення та захист копії відновлення.

## Редакція контенту

`/content` має бібліотеку з пошуком, фільтрами стану/типу, сортуванням і сторінками. Окремий редактор підтримує Markdown із переглядом, чернетки, обкладинки, публікацію та зняття з публікації. Помилка не закриває форму; конфлікти ревізій повертають 409. Незбережений текст можна відновити в тій самій вкладці браузера.

Деталі й оновлення: [CONTENT_WORKSPACE_2026-10-16_UA.md](docs/CONTENT_WORKSPACE_2026-10-16_UA.md). Чинний Site 4.2.1 сумісний із цим релізом.

## Контракт між сайтами

| Дані / дія | Внутрішня адреса | Джерело |
|---|---|---|
| Склад, прогрес, сезони, рейди | `GET /api/site/guild` | Збережений склад PostgreSQL |
| Заявки та статуси | `GET /api/site/applications` | PostgreSQL |
| Надсилання заявки | `POST /api/site/applications` | PostgreSQL, далі чинне Discord-сповіщення |
| Новини й гайди | `GET /api/site/content?page=1` | CMS PostgreSQL, контракт v2, по 20 матеріалів |
| Обкладинка | `GET /api/site/media/:sha256` | Таблиця `site_content_media` |
| Сумісність і БД | `GET /api/site/status` | Автентифікована перевірка без записів |

Сайт звертається до `http://dashboard:3000` через `mistblossom_edge`. `PUBLIC_SITE_BRIDGE_TOKEN` має бути однаковим у кореневому `.env` дашборда та `.env` сайту. Цей токен не дає доступу до адміністративних API або bot/cron API. Для них залишається окремий `INTERNAL_API_TOKEN`.

Браузер надсилає заявку на власний `/site-api/v1/applications`. Без сервісного токена дашборд не приймає заявку. Публічні GET повертають лише публічні дані; tracking-квитанція доступна у відповіді конкретного POST.

## Робота з проєктом

```bash
cd dashboard
npm ci --no-audit --no-fund
npm run verify
npm run build:ci
```

Збережено Makefile для операцій VPS: `make backup`, `make check`, `make rebuild-dashboard`, `make rebuild-bot`, `make logs`, `make ps`. Перед першим запуском нового релізу підготувати парні env за інструкцією переходу.

`src/lib/documentDb.ts` і `src/lib/db/documentValues.ts` працюють тільки з PostgreSQL. Колекційний API документів — внутрішній адаптер JSONB; зовнішньої Firebase-залежності та перемикання на Firestore немає.

`src/lib/applicationsStore.ts` містить чинну логіку заявок. Каталог рейдових обкладинок читається з `dashboard/public/assets/img/raids-img`, без GitHub API.

Одноразовий SQL-імпорт статей у `import/legacy-site/` залишено як засіб перенесення вмісту. Це не робоче джерело контенту та не альтернативний runtime. Імпорт не перезаписує наявні статті.

## Nginx

`deploy/nginx/dashboard.conf` обслуговує дашборд; `deploy/nginx/public-site.conf` — публічний сайт і перенаправлення www. Обидва файли явно підключені Compose. Додавати блоки сайту вручну в `dashboard.conf` більше не потрібно.

CMS-завантаження мають окремий ліміт Nginx 10 MiB; обкладинка на рівні застосунку обмежена 8 MiB. Решта лімітів не збільшується. Upstream дашборда й бота оновлюються через Docker DNS після пересоздання контейнерів.

## Перевірки

`npm run check:site-integration` виконує чинні модулі сховища, CMS і readiness з контрольованими залежностями: дублікати заявок, ревізії редактора, атомарне перейменування, обкладинки, пагінація та відмова без PostgreSQL. Справжню БД перевіряють окремі `test:*:pg` сценарії з ізольованою тестовою БД.

`GET /api/health` — тільки живість процесу. Здоровий процес сам по собі не підтверджує готовність БД, Discord або зв’язку із сайтом.
