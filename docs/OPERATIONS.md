# Експлуатація

Щоденний контроль системи: оновлення, спостереження, резервні копії,
розбір інцидентів.

Розгортання з нуля — [DEPLOYMENT.md](./DEPLOYMENT.md).
Змінні оточення — [CONFIGURATION.md](./CONFIGURATION.md).

---

## 1. Щоденна перевірка

Тридцять секунд, які економлять години:

```bash
cd /srv/mistblossom
make check                                         # конфігурація ціла?
docker compose ps                                  # усі healthy?
curl -fsS https://guild.lihvodruida.pp.ua/api/health
docker compose exec bot node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>r.text()).then(console.log)"
df -h /                                            # місце на диску
```

Якщо якийсь контейнер у стані `restarting` — дивіться його логи першими:
перезапуск по колу майже завжди означає помилку конфігурації, а не збій коду.

---

## 2. Стан сервісів

| Сервіс | Перевірка | Що означає збій |
|--------|-----------|-----------------|
| `postgres` | `docker compose exec postgres pg_isready -U mistblossom` | нічого не працює: панель без бази не піднімається |
| `dashboard` | `curl -fsS https://guild.lihvodruida.pp.ua/api/health` | сайт недоступний, Discord-кнопки не працюють |
| `bot` | `/healthz` усередині контейнера | сайт живий, але кнопки в Discord мовчать |
| `nginx` | `docker compose logs nginx \| tail` | сайт недоступний ззовні |
| `cron` | `docker compose logs cron \| tail` | рейди не закриваються автоматично, пули не перестворюються |

Важлива деталь: **бот і панель падають незалежно**. Якщо сайт відкривається, а
кнопки в Discord дають «Дія не вдалася» — проблема в боті або в Cloudflare
(розділ 6), а не в панелі.

---

## 3. Оновлення

```bash
cd /srv/mistblossom
./deploy/scripts/deploy.sh
```

Скрипт позначає поточний образ тегом `rollback`, збирає новий, піднімає його і
чекає до 120 секунд на `healthy`. Якщо не дочекався — друкує останні 50 рядків
логу і **повертає попередню версію**. Це головна причина не робити просто
`docker compose up -d --build`: у сирому вигляді воно зупиняє робочу версію і
залишає сервіс лежати, якщо новий білд зламаний.

Ручний відкіт, якщо потрібен:

```bash
docker tag mistblossom/dashboard:rollback mistblossom/dashboard:latest
docker compose up -d --no-build dashboard
```


---

## 4. Спостереження

```bash
# Стан контейнерів і healthcheck
docker compose ps

# Логи панелі
docker compose logs -f --tail=100 dashboard

# Логи Nginx
docker compose logs -f nginx

# Споживання ресурсів
docker stats --no-stream
```

Ротація логів налаштована в `docker-compose.yml`: 10 МБ × 5 файлів на сервіс.
Без цього JSON-логи Docker ростуть безмежно і за кілька місяців забивають диск —
це найчастіша причина «сервер раптом став».

Внутрішні події панелі (`logDashboardEvent`) видно у `/dashboard/logs`.


---

## 5. Резервні копії

Стан панелі живе у власному PostgreSQL, тож бекап бази — тепер твоя
відповідальність, а не Google. Детально: [DATABASE.md, розділ 7](./DATABASE.md#7-резервні-копії).

```bash
./deploy/scripts/db-backup.sh            # дамп + перевірка цілісності
./deploy/scripts/db-restore.sh <файл>    # відновлення
```

Решта, що варто зберігати:

| Що | Де | Як часто |
|----|-----|----------|
| `dashboard/.env.production` | сервер | після кожної зміни |
| `.env` у корені | сервер | після кожної зміни |
| База даних | `/srv/mistblossom/backups` | щодня о 03:30, `db-backup.sh` |
| Сертифікати | volume `letsencrypt` | не обовʼязково, перевидаються за хвилину |

```bash
# Секрети — у зашифрований архів
tar czf - dashboard/.env.production .env \
  | gpg --symmetric --cipher-algo AES256 \
  > "mistblossom-secrets-$(date +%F).tar.gz.gpg"
```

Копії обовʼязково возити з сервера — бекап на тому ж диску не рятує від
смерті диска:

```bash
rsync -avz --delete /srv/mistblossom/backups/ backup-host:/backups/mistblossom/
```


---

## 6. Типові проблеми

**502 від Nginx.** Панель не піднялась. `docker compose logs dashboard` —
зазвичай не задана обовʼязкова змінна оточення або панель не бачить бази
(`DATABASE_URL` має вказувати на хост `postgres`, а не `localhost`).

**Форми не працюють, «Недовірене джерело запиту».** `getRequestHost` бачить не
той хост. Перевір, що Nginx передає `Host $host` (це є в `proxy-params.inc`) і
що `DASHBOARD_PUBLIC_URL` збігається з реальним доменом.

**Discord показує «Дія не вдалася».** Бот не встиг відповісти за 3 секунди або
запит до нього не дійшов. Порядок перевірки — розділ 7.

**Бот відповідає 401 на кожен запит.** `DISCORD_PUBLIC_KEY` у боті не збігається
з ключем застосунку. Значення береться в Discord Developer Portal →
General Information → Public Key.

**Кнопки Discord отримують HTML замість відповіді.** Cloudflare Bot Fight Mode
або WAF віддає challenge-сторінку. Потрібне правило Skip для
`/discord/interactions` (DEPLOYMENT.md, розділ 4.5).

**Після зміни домену старий URL у Discord-повідомленнях.** Посилання беруться з
`DASHBOARD_PUBLIC_URL` на момент рендеру embed. Онови змінну, перезбери образ і
натисни «Перерахувати рекомендації» на потрібних рейд-пулах.

**Geo-політика не бачить країну.** Заголовок `CF-IPCountry` зʼявляється тільки
за увімкненого проксі Cloudflare. Або поверніть помаранчеву хмару, або
підключіть модуль GeoIP2 до Nginx і розкоментуйте рядок `X-GeoIP-Country` у
`deploy/nginx/proxy-params.inc`.

**Сайт віддає 526 (Invalid SSL certificate).** nginx працює і Cloudflare до
нього достукався, але сертифікат origin не пройшов перевірку — майже завжди
це самопідписана заглушка від `cert.sh --self` при режимі Full (strict).
Перевірка: `make cert-status`. Виправлення — DEPLOYMENT.md, розділ 5.1.

**Сайт віддає 521/522.** Протилежна ситуація: до origin узагалі не
достукатись. Перевірте `docker compose ps nginx` і чи слухає сервер 443.

**У логах Nginx усі запити з одного IP.** Список мереж Cloudflare у
`nginx.conf` застарів, і `real_ip` не працює. Оновіть його зі
`https://www.cloudflare.com/ips-v4`.

**Скінчилось місце.** Найчастіше — старі образи Docker:

```bash
docker system df
docker image prune -a --filter "until=168h"
```


---

## 7. Аварійні дії

### Швидкий відкат релізу

```bash
cd /srv/mistblossom
git log --oneline -5
git checkout <попередній-коміт>
./deploy/scripts/deploy.sh
```

`deploy.sh` чекає healthcheck і сам відкочується, якщо новий образ не піднявся.

### Повний рестарт стека

```bash
make restart
```

Скрипт зупиняє стек і піднімає його заново по черзі, дочікуючись готовності
кожного сервісу. `docker compose down && up -d` теж працює, але не чекає
нічого: після нього перші хвилини панель може бути в циклі перезапусків, і
це не буде видно у виводі.

Дані не втрачаються: база лежить у томі `pgdata`, а не в контейнері.

### База не піднімається

```bash
docker compose logs postgres | tail -50
```

Найчастіше — пошкоджений том після жорсткого вимкнення сервера. Відновлення з
останнього дампа:

```bash
./deploy/scripts/db-restore.sh backups/mistblossom-<дата>.dump
```

### Discord масово не працює

Перевіряйте в цьому порядку — від найдешевшого до найдорожчого:

1. `docker compose ps bot` — контейнер живий?
2. `docker compose logs bot | tail -50` — 401 означає розбіжність `DISCORD_PUBLIC_KEY`
3. Cloudflare → Security → Events — чи не блокує WAF `/discord/interactions`
4. Discord Developer Portal → Interactions Endpoint URL — чи веде на
   `https://guild.lihvodruida.pp.ua/discord/interactions`

---

## 8. Регулярні задачі

| Періодичність | Дія |
|---------------|-----|
| щодня | автоматичний бекап о 03:30 (`db-backup.sh` у crontab) |
| щотижня | переглянути `/dashboard/logs` на предмет повторюваних помилок |
| щомісяця | `docker image prune -a --filter "until=720h"` — прибрати старі образи |
| щокварталу | **перевірити відновлення з бекапу** у порожню базу |
| раз на рік | оновити мажорну версію PostgreSQL (через дамп, див. DATABASE.md) |

Перевірка відновлення — не формальність. Неперевірений бекап це не бекап: про
те, що дампи псуються, дізнаються рівно в той момент, коли вони потрібні.
