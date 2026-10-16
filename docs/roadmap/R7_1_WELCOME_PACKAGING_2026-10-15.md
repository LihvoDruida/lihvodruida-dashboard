# R7.1 — пакування welcome-card і перевірка standalone

Dashboard **3.8.93**, bot **3.6.9**, contract **1.1.1**. База — повний реліз 3.8.92. Дата: 15.10.2026, Europe/Kyiv.

## Відтворена проблема

Два попередження Turbopack у discordWelcomeCard.ts були наслідком фактичного розширення трасування. Шляхи до фону повертались із функції та перебирались циклом; шляхи до шрифтів складались із змінного каталогу. Next не міг обмежити файлові операції каталогами ресурсів і включав увесь dashboard до runtime-пакета.

У trace маршруту preview було 417 файлів dashboard/src і 106 CI-скриптів. Скрипти потрапляли до .next/standalone/dashboard/scripts попри явну політику Dockerfile копіювати лише обрані maintenance entrypoint-и.

## Зміни

- Кожна операція readFile/access тепер має шлях, обмежений літеральним каталогом public/assets або assets/fonts/welcome. Збережені локальний cwd та батьківський cwd із dashboard/. Коментарів ігнорування Turbopack або широких tracing-exclude немає.
- Реальні фон і шрифти залишаються у trace. Рендер не покладається на випадково включений source checkout.
- Додано check:welcome-assets: реальний Sharp читає PNG/TTF, рендерить український текст, перевіряє альфа-кути, обидва розташування ресурсів, запасний шрифт, відновлення після відсутнього фону та одночасні дублікати.
- Додано check:standalone після production build у build:ci. Gate перевіряє ресурси, відсутність source/CI/config, залежність Sharp саме з готового пакета, повторює renderer-suite на packaged Sharp, запускає готовий Next server, перевіряє health і точні байти фонового PNG через HTTP.
- Docker використовує спільну font-runtime базу з fontconfig та fonts-dejavu-core для deps/builder/runner. Раніше DejaVu встановлювався тільки в runner; тепер і нативні CI-тести в bookworm-slim мають той самий fallback. Пакет встановлюється одним спільним кроком, версії Node/Next/React/Sharp не змінені.
- test:db:docker тепер запускає також уже наявні test-group-assignment-migration-pg.cjs і test-automation-status-pg.cjs: загалом дев’ять PG-suite. Їхнє виконання потребує Docker і тут не заявляється.

## Вимірювання пакета

Локальні production-збірки з однаковим security overlay: Next 16.3.5, React 19.2.8, Sharp 0.35.4. Розмір — сума байтів звичайних файлів standalone, без розміру каталогів/символічних посилань на каталоги. Це не розмір Docker image або ZIP.

| Показник | 3.8.92 | 3.8.93 |
|---|---:|---:|
| Записів trace preview | 1 762 | 1 180 |
| Файлів standalone | 4 644 | 4 056 |
| Байти standalone | 97 350 446 | 84 314 492 |
| CI-скриптів standalone | 106 | 0 |
| dashboard/src у trace preview | 417 | 0 |
| Попереджень dynamic filesystem tracing | 2 | 0 |

Пакет зменшився на **13 035 954 байти, приблизно 13,4%**. Ці числа стосуються цього середовища; архітектура native Sharp, версії залежностей і builder inputs можуть змінити абсолютний розмір.

## Перевірки й повторення

**6/6 renderer-сценаріїв** пройшли на source-залежності Sharp; той самий suite пройшов на залежності Sharp і ресурсах із standalone. Вихідні PNG локального та батьківського layout побайтово однакові. Згенеровану картку з українським текстом оглянуто візуально.

**6/6 post-build перевірок** пройшли. Ізольований Next server стартує без БД та зовнішніх інтеграцій; health — no-store. Для статичного PNG тест імітує публічний Host і marker довіреного nginx/Cloudflare; production Host/proxy-політика збережена. HTTP-перевірка локальна і не доводить проходження через справжній Cloudflare.

Негативний контроль: до окремого тимчасового пакета додано dashboard/scripts/should-not-ship.cjs. Gate завершився exit 1 із повідомленням Unexpected build input in runtime: scripts. Реальний output не змінювався цим тестом.

Повний build:ci — exit 0; обидва попередження зникли. ESLint усього проєкту й фінальних модулів — exit 0. Після зміни Docker base повторно пройшли наявні перевірки welcome-card (42), platform-hardening (15), security-performance (101).

Команди з dashboard:

```sh
npm run check:welcome-assets
npm run build:ci
npm run check:standalone
```

check:standalone потребує попередньої production-збірки. Він перевіряє чистий output Next **до** додаткових COPY у Docker runner: maintenance-скрипти та schema.sql Docker додає окремими явними командами. MISTBLOSSOM_PACKAGE_REPORT може зберегти JSON вимірювання. Повний машинний звіт: [R7_1_VALIDATION_2026-10-15.json](R7_1_VALIDATION_2026-10-15.json).

## Межі та наступні кроки

Docker/psql/postgres у цьому середовищі відсутні. Docker image не зібрано, живі PostgreSQL/Discord, справжній avatar fetch/DM, cron і VPS не перевірялися. Dockerfile перевірено кодом і наявними контрактними аудитами; Node standalone та нативний renderer реально запущені локально. Жоден production сервіс не змінено.

R7.1 завершено локально як незалежний пункт пакування. Приймання R6 на розгорнутому стенді залишається відкритим. Далі R7.2: клавіатурна навігація, фокус і повідомлення стану в існуючих робочих сценаріях; окремо — вимірювання SQL/API/DOM на репрезентативному стенді. Повний R6/R7/R8 не позначено завершеним. Дизайн сторінки логів не перероблявся.

Відкат — попередній повний пакет 3.8.92. Схема БД, cron, bot і contract сумісні; SQL-міграції немає.
