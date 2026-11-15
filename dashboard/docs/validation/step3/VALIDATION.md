# Перевірки Dashboard 3.25.0 — етап 3

| Перевірка | Результат |
| --- | --- |
| npm run verify | PASS, exit 0 — 106 груп перевірок |
| check:community-workspaces | PASS — 19/19, server loaders, справжній sanitizer, алгоритми і React SSR |
| check:identity-workspaces | PASS — 14/14, регресії етапу 2 |
| check:page-foundation | PASS — 10/10 |
| check:rbac | PASS — 15/15 |
| TypeScript / ESLint | PASS у verify; semantic TypeScript у production build |
| CSS / UI / tokens / imports | PASS у verify |
| npm run security:runtime | PASS — встановлені Next/React/Sharp/Node версії |
| npm run build | PASS — Next 16.3.5, production compilation |
| check:standalone | PASS — 10/10, включно зі стартом пакетованого сервера та HTTP smoke |
| API contracts | 124 route.ts-файли побайтово незмінні відносно 3.24.0 |
| Poll actions browser fixture | Bundling PASS; Chromium launch BLOCKED: socket(): Operation not permitted |
| Візуальний browser аудит | NOT RUN — не видається за PASS |
| Live PostgreSQL / Discord / OAuth / VPS | NOT RUN |

Логи поруч: verify.log, build.log, standalone.log, runtime-security.log, browser.log.

Контроль у доступному браузері після встановлення: 1920/1440/1280/1024/768/390/320 px;
довгі імена/рейдові назви, немає page overflow; пошук і Back/Forward/saved views;
профіль → повернення до рядка складу; всі стани пулів і reset; меню дій та Escape;
paused/close/delete busy lock, focus recovery, підтвердження й uncertain recovery;
жива зміна бейджа заявки; розділення empty/error/loading. Цей перелік не означає,
що браузерні сценарії вже пройдені.

Перевірки використовують ізольовані fixtures; жодні тестові профілі чи записи не
додаються в runtime. Production .env, живі акаунти й дані БД не змінювались.
