# Dashboard 3.13.1 — виправлення check:character-data у Docker CI

Повний пакет поверх Dashboard 3.13.0. Сумісний із Site 4.3.0 та 4.3.1. Поточний рекомендований сайт — 4.3.1 із діагностикою деплою. Runtime визначення сезонів, PostgreSQL, Discord і контракти API у цьому hotfix не змінювалися.

## Підтверджена причина

Надісланий повний лог завершується на:

```text
> lihvodruida-dashboard@3.13.0 check:character-data
✗ season resolver has upstream fallback mapping
...
target dashboard: failed to solve: ... npm run build:ci ... exit code: 1
```

`dashboard/scripts/check-character-data.cjs` перевіряв наявність буквальних фрагментів `battleNetNames` та `currentSeason.raids = Array.from(new Set(fallback.map` у вихідному коді. Це назви й фрагменти старого resolver v1. Новий resolver v2 використовує часові інтервали, каталог історичних сезонів і збережений fallback, тому правильна нова реалізація відхилялася цим застарілим тестом.

Попередній запуск `verify` не виявив цю помилку: у ньому був відсутній `check:character-data`, тоді як Docker запускав `build:ci` з цим тестом. Production Next build та `verify` не були еквівалентні повному Docker CI. Це пропуск попередньої перевірки релізу.

У послідовності наданого логу Site 4.3.0 спочатку відкотився, після чого оновлення Dashboard також зупинилося під час build. Отже, новий образ Dashboard у цьому запуску не був успішно зібраний. Точну HTTP-причину першого відкату сайту лог усе ще не містить; після усунення цієї блокувальної помилки потрібно успішно запустити новий дашборд і повторити інтеграційну перевірку сайту.

## Виправлення

- Замість пошуку видалених фрагментів коду запускається справжній TypeScript resolver на контрольованих відповідях Raider.IO.
- Перевіряється включення `tier-mn-1` і `nerubar-palace` у правильні історичні сезони, зокрема при відкритті рейду до M+ сезону.
- Перевіряється повна недоступність upstream: збережені сезони, каталог, поточний сезон і дата фактичного визначення не втрачаються.
- Решта 15 перевірок канонічних даних персонажів збережені.
- `check:character-data` і `check:guild-banner` додано в `verify`, як і в `build:ci`.
- `inspect:ci` перевіряє, що всі `check:*` з Docker `build:ci` також є у `verify`. Окремий виняток — `check:standalone`, який потребує вже завершеної production-збірки й залишається після неї.
- Версію дашборда та lock-файл оновлено до 3.13.1.

## Перевірки

| Перевірка | Результат |
|---|---|
| Повний `npm run build:ci` Dashboard 3.13.1 | Код завершення 0 |
| `check:character-data` | 17/17 |
| `check:raid-history` | 13/13 |
| `inspect:ci`, зокрема відповідність verify / build:ci | 0 блокувальних помилок |
| Production Next build | Успішно |
| Production standalone | 7/7 |
| ESLint змінених скриптів | Успішно |

Повний CI містив перевірки заявок, Discord-публікацій, PostgreSQL, профілів, канонічних даних персонажів, сезону, CMS, API, безпеки й UI. Установлені Next 16.3.5, React/React DOM 19.2.8, Sharp 0.35.4 відповідають актуальним overlay-версіям Dockerfile; локальний Node — 24.19.0.

HTTP у тестах контрольований; живі заявки, рейди та Discord-повідомлення не створювались. На VPS змін не виконано. Реальний Docker daemon у цьому середовищі недоступний; перевірено саме команду `npm run build:ci`, яку виконує Dockerfile, у локальному Node-оточенні. Docker image build на вашому Ubuntu залишається остаточною перевіркою контейнерного середовища.

## Оновлення на VPS

Завантажити `lihvodruida-dashboard-v3.13.1-character-data-ci-hotfix.zip` у `/tmp`. `.env` до архіву не входять. Перед розпакуванням зберегти БД і чинну конфігурацію.

```bash
set -e
cd /srv/mistblossom
make backup
unzip -t /tmp/lihvodruida-dashboard-v3.13.1-character-data-ci-hotfix.zip
unzip -o /tmp/lihvodruida-dashboard-v3.13.1-character-data-ci-hotfix.zip -d /srv
cd /srv/mistblossom
make rebuild-dashboard
docker compose -p mistblossom up -d --no-deps --no-build --wait --wait-timeout 90 dashboard
docker compose -p mistblossom up -d --no-deps --no-build --pull never --force-recreate cron
make internal-check
```

`make rebuild-dashboard` збирає лише dashboard і застосовує чинну схему PostgreSQL. Для цього виправлення окрема збірка бота не потрібна. У логах мають бути `[check-character-data] OK — 17/17`, успішний подальший `build:ci` та запуск dashboard.

Після успішного оновлення дашборда встановити наданий Site 4.3.1, якщо він ще не встановлений. Команда `make integration-check` з’являється в його нових файлах і може працювати через старий запущений контейнер сайту.

```bash
set -e
unzip -t /tmp/lihvodruida-site-v4.3.1-deploy-readiness.zip
unzip -o /tmp/lihvodruida-site-v4.3.1-deploy-readiness.zip -d /srv
cd /srv/lihvodruida-site
make integration-check
make up
```

Успішний результат: `PASS dashboard protocol, PostgreSQL and required capabilities`, потім успішний запуск і публічні перевірки сайту. Якщо перевірка не проходить, Site 4.3.1 показує конкретний код; його треба розглядати окремо від уже виправленого тесту збірки дашборда.
