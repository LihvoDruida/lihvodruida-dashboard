# Розгортання на власному сервері

Панель Mistblossom Vanguard більше не залежить від Vercel. Цей документ описує
повний шлях: від чистої машини до працюючого продакшену з TLS, планувальником
задач і відкотом невдалих деплоїв.

Зовнішніх сервісів немає взагалі: Cloudflare Workers, Cloudflare KV, Firestore
і Vercel прибрані. Discord-взаємодії приймає наш контейнер `bot`, дані лежать
у нашому PostgreSQL, планові задачі виконує контейнер `cron`.

---

## 1. Що потрібно

**Сервер.** Мінімум 2 vCPU / 2 ГБ RAM / 20 ГБ диска. Панель у спокої тримається
близько 300 МБ, але збірка Next.js з'їдає до 1.5 ГБ — на машині з 1 ГБ вона
впаде з OOM. Якщо RAM обмежена, збирай образ деінде і привозь готовий
(див. розділ 8).

Перевірена база: Ubuntu 24.04 LTS.

**Домен.** A-запис (і AAAA, якщо є IPv6) на IP сервера. Якщо домен за
Cloudflare, режим проксі («помаранчева хмара») можна лишити — конфіг Nginx це
враховує і бере реальний IP з `CF-Connecting-IP`.

**Доступи.** Discord bot token і OAuth, Battle.net OAuth. Firebase більше не
потрібен: панель працює на власному PostgreSQL, який піднімається тим самим
`docker compose`. Ключі Firebase лишаються потрібними рівно один раз — щоб
перенести наявні дані (див. [DATABASE_MIGRATION.md](./DATABASE_MIGRATION.md)).

---

## 2. Підготовка сервера

```bash
# Оновлення і базові інструменти
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw fail2ban

# Docker з офіційного репозиторію. Версія з apt-репозиторію Ubuntu
# зазвичай стара і не має "docker compose" як підкоманди.
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Робота з докером без sudo (потрібен перелогін)
sudo usermod -aG docker "$USER"
```

### Файрвол

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Порт 3000 назовні **не відкриваємо**. Панель слухає тільки внутрішню мережу
Docker; єдиний вхід — Nginx на 80/443. Інакше можна обійти і TLS, і обмеження
частоти запитів, стукнувши прямо в апстрім.

> **Увага при Cloudflare-проксі.** Якщо оранжева хмара увімкнена, обмеж 80/443
> діапазонами Cloudflare, інакше хтось знайде IP сервера і ходитиме повз усі
> правила Cloudflare. Списки: `https://www.cloudflare.com/ips/`.

### SSH

У `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
```

Далі `sudo systemctl restart ssh`. Перед цим переконайся, що ключ уже працює —
інакше замкнеш себе поза сервером.

---

## 3. Код і конфігурація

```bash
sudo mkdir -p /srv/mistblossom
sudo chown "$USER":"$USER" /srv/mistblossom
git clone <URL-репозиторію> /srv/mistblossom
cd /srv/mistblossom
```

Конфігурація живе у двох файлах:

**`dashboard/.env.production`** — усі секрети панелі. Береться з
`dashboard/.env.example`, повний опис змінних — у
[ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md).

```bash
cp dashboard/.env.example dashboard/.env.production
chmod 600 dashboard/.env.production
${EDITOR:-nano} dashboard/.env.production
```

**`.env`** у корені — те, що потрібне самому Compose:

```bash
cat > .env <<'ENV'
DASHBOARD_PUBLIC_URL=https://dashboard.example.com
CRON_SECRET=<той самий CRON_SECRET, що в dashboard/.env.production>
IMAGE_TAG=latest
ENV
chmod 600 .env
```

### Що змінилось після відходу від Vercel

| Було | Стало |
|------|-------|
| `VERCEL_URL`, `VERCEL_ENV` | не використовуються, можна видалити |
| Environment Variables у веб-панелі Vercel | `dashboard/.env.production` |
| Cron Jobs у `vercel.json` | контейнер `cron` (розділ 6) |
| Автодеплой на push | `./deploy/scripts/deploy.sh` |
| Preview-домени `*.vercel.app` | немає; `DASHBOARD_PUBLIC_URL` — єдине джерело правди |

`DASHBOARD_PUBLIC_URL` — головна змінна. З неї будуються редіректи, посилання
в Discord-повідомленнях і домен для cookie. Задай її **до першої збірки**:
Next вшиває публічний URL у клієнтський бандл на етапі build.

Змінити домен назви заміни й перезбирай:

```bash
docker compose build dashboard && docker compose up -d
```

Замінити домен у `deploy/nginx/dashboard.conf` теж треба — там він у трьох
місцях: `server_name` двічі і шляхи до сертифікатів.

---

## 4. Сертифікат

Nginx не стартує без сертифіката, а certbot не видасть сертифікат без
працюючого Nginx. Розриваємо коло тимчасовим самопідписаним:

```bash
DOMAIN=dashboard.example.com

docker volume create mistblossom_letsencrypt
docker run --rm -v mistblossom_letsencrypt:/etc/letsencrypt alpine sh -c "
  apk add --no-cache openssl >/dev/null &&
  mkdir -p /etc/letsencrypt/live/$DOMAIN &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj '/CN=$DOMAIN'"

# Піднімаємо стек із заглушкою
docker compose up -d

# Отримуємо справжній сертифікат
docker compose run --rm certbot certonly \
  --webroot --webroot-path=/var/www/certbot \
  -d "$DOMAIN" --agree-tos --no-eff-email -m admin@example.com

docker compose exec nginx nginx -s reload
```

Автопоновлення — systemd-таймер:

```bash
sudo cp deploy/systemd/mistblossom-certbot.service /etc/systemd/system/
sudo cp deploy/systemd/mistblossom-certbot.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mistblossom-certbot.timer
systemctl list-timers mistblossom-certbot
```

Таймер спрацьовує двічі на добу. Certbot нічого не робить, якщо до закінчення
понад 30 днів, тому це безпечно і саме так радить Let's Encrypt.

---

## 5. Запуск

```bash
cd /srv/mistblossom
docker compose up -d --build
docker compose ps
curl -fsS https://dashboard.example.com/api/health
```

Очікувана відповідь: `{"ok":true,"service":"mistblossom-dashboard",...}`.

Автостарт після перезавантаження сервера:

```bash
sudo cp deploy/systemd/mistblossom.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mistblossom
```

### Структура стека

| Сервіс | Що робить | Порти |
|--------|-----------|-------|
| `postgres` | база даних | 5432 (тільки внутрішня мережа) |
| `nginx` | TLS, gzip, кеш статики, обмеження частоти | 80, 443 |
| `dashboard` | Next.js standalone | 3000 (внутрішній) |
| `cron` | планові задачі | — |
| `certbot` | поновлення сертифіката (профіль, не працює постійно) | — |

---

## 6. Планові задачі

Раніше це були Vercel Cron Jobs. Тепер — контейнер `cron`, який стукає у ті
самі HTTP-ендпоїнти внутрішньою мережею з `Authorization: Bearer $CRON_SECRET`.

| Розклад | Ендпоїнт | Навіщо |
|---------|----------|--------|
| кожні 10 хв | `/api/raids/lifecycle` | публікація й закриття рейдів |
| кожні 5 хв | `/api/polls/close-due` | автозакриття рейд-пулів і автоповтор |
| 04:00 Київ | `/api/dashboard/profiles/orphan-cleanup/apply` | чистка акаунтів, які вийшли з Discord |

Логи:

```bash
docker compose logs -f cron
```

Ручний запуск задачі:

```bash
docker compose exec dashboard node -e "
  fetch('http://127.0.0.1:3000/api/polls/close-due', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.CRON_SECRET }
  }).then(r => r.text()).then(console.log)"
```

`CRON_SECRET` має бути **не коротшим за 24 символи** — `verifyInternalBearerToken`
відхиляє короткі токени.

---

## 7. Оновлення

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

## 8. Збірка на слабкому сервері

Якщо на машині 1–2 ГБ RAM, збірка Next.js впаде з OOM. Варіанти:

**Своп** (найпростіше):

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Збірка деінде.** Зібрати образ на робочій машині або в CI та привезти:

```bash
# локально
docker build -t mistblossom/dashboard:latest \
  --build-arg NEXT_PUBLIC_DASHBOARD_URL=https://dashboard.example.com \
  ./dashboard
docker save mistblossom/dashboard:latest | gzip | ssh server 'gunzip | docker load'

# на сервері
docker compose up -d --no-build
```

Можна також зменшити паралелізм збірки: `NEXT_BUILD_CPUS=1` в оточенні.

---

## 9. Резервні копії

Стан панелі живе у власному PostgreSQL, тож бекап бази — тепер твоя
відповідальність, а не Google. Детально: [DATABASE_MIGRATION.md, розділ 7](./DATABASE_MIGRATION.md#7-резервні-копії).

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

## 10. Спостереження

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

## 11. Типові проблеми

**502 від Nginx.** Панель не піднялась. `docker compose logs dashboard` —
зазвичай не задана обовʼязкова змінна оточення або панель не бачить бази
(`DATABASE_URL` має вказувати на хост `postgres`, а не `localhost`).

**Форми не працюють, «Недовірене джерело запиту».** `getRequestHost` бачить не
той хост. Перевір, що Nginx передає `Host $host` (це є в `proxy-params.inc`) і
що `DASHBOARD_PUBLIC_URL` збігається з реальним доменом.

**Discord показує «Дія не вдалася».** Воркер не дочекався відповіді за ~3 с.
Перевір `proxy_read_timeout` для `/api/discord/interactions` і чи не спить
панель. Логи: `docker compose logs dashboard | grep discord`.

**Після зміни домену старий URL у Discord-повідомленнях.** Посилання беруться з
`DASHBOARD_PUBLIC_URL` на момент рендеру embed. Онови змінну, перезбери образ і
натисни «Перерахувати рекомендації» на потрібних рейд-пулах.

**Geo-політика не бачить країну.** Без Cloudflare заголовка `CF-IPCountry` немає.
Або лиши Cloudflare-проксі, або підключи модуль GeoIP2 до Nginx і розкоментуй
рядок `X-GeoIP-Country` у `deploy/nginx/proxy-params.inc`.

**Скінчилось місце.** Найчастіше — старі образи Docker:

```bash
docker system df
docker image prune -a --filter "until=168h"
```

---

## 12. Мапа файлів розгортання

```
docker-compose.yml                  стек: nginx + dashboard + cron + certbot
dashboard/Dockerfile                триетапна збірка standalone-образу
deploy/nginx/nginx.conf             базовий конфіг: логи, gzip, ліміти, real_ip
deploy/nginx/dashboard.conf         віртуальний хост, TLS, кеш статики
deploy/nginx/proxy-params.inc       спільні proxy-заголовки
deploy/cron/run-cron.sh             планові задачі замість Vercel Cron
deploy/scripts/deploy.sh            деплой з очікуванням healthcheck і відкотом
deploy/systemd/mistblossom.service  автостарт стека після перезавантаження
deploy/systemd/mistblossom-certbot.{service,timer}   поновлення сертифіката
```
