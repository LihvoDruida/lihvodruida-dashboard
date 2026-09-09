# Розгортання

Повний шлях від чистої машини до працюючого продакшену на
**https://guild.lihvodruida.pp.ua** — із TLS, Cloudflare, власною базою,
Discord-ботом і плановими задачами.

Уся система працює на одному сервері. Зовнішніх залежностей для роботи немає:
Cloudflare Workers, Cloudflare KV, Firestore і Vercel прибрані. Cloudflare
лишається, але тільки як DNS і захисний проксі перед нашим Nginx — дані через
нього не зберігаються.

**Стек:** `postgres` (база) → `dashboard` (Next.js) → `bot` (Discord) →
`nginx` (TLS, вхід) → `cron` (планові задачі).

Супутні документи:

- [ARCHITECTURE.md](./ARCHITECTURE.md) — чому сервіси розділені саме так
- [CONFIGURATION.md](./CONFIGURATION.md) — усі змінні оточення
- [OPERATIONS.md](./OPERATIONS.md) — щоденний контроль, оновлення, інциденти
- [DATABASE.md](./DATABASE.md) — база, бекапи, перенесення даних

---

## 1. Що потрібно

**Сервер.** Мінімум 2 vCPU / 2 ГБ RAM / 20 ГБ диска. Панель у спокої тримається
близько 300 МБ, але збірка Next.js з'їдає до 1.5 ГБ — на машині з 1 ГБ вона
впаде з OOM. Якщо RAM обмежена, збирай образ деінде і привозь готовий
(див. розділ 8).

Перевірена база: Ubuntu 24.04 LTS.

**Домен.** `guild.lihvodruida.pp.ua`. Налаштування Cloudflare — розділ 4.

**Доступи.** Discord bot token і OAuth, Battle.net OAuth. Firebase більше не
потрібен: панель працює на власному PostgreSQL, який піднімається тим самим
`docker compose`. Ключі Firebase лишаються потрібними рівно один раз — щоб
перенести наявні дані (див. [DATABASE.md](./DATABASE.md)).

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
[CONFIGURATION.md](./CONFIGURATION.md).

```bash
cp dashboard/.env.example dashboard/.env.production
cp bot/.env.example bot/.env.production
chmod 600 dashboard/.env.production bot/.env.production
${EDITOR:-nano} dashboard/.env.production
${EDITOR:-nano} bot/.env.production
```

Значення, які **мають збігатися** в обох файлах: `DISCORD_PUBLIC_KEY`,
`DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `INTERNAL_API_TOKEN`. Розбіжність не
дає помилки при старті — вона проявляється як «Дія не вдалася» в Discord.

**`.env`** у корені — те, що потрібне самому Compose:

```bash
cat > .env <<'ENV'
DASHBOARD_PUBLIC_URL=https://guild.lihvodruida.pp.ua
POSTGRES_PASSWORD=<openssl rand -base64 32>
DISCORD_PUBLIC_KEY=<Public Key з Discord Developer Portal>
INTERNAL_API_TOKEN=<openssl rand -hex 32>
CRON_SECRET=<той самий CRON_SECRET, що в dashboard/.env.production>
IMAGE_TAG=latest
ENV
chmod 600 .env
```

`DASHBOARD_PUBLIC_URL` — головна змінна. З неї будуються редіректи, посилання
в Discord-повідомленнях і домен для cookie. Задай її **до першої збірки**:
Next вшиває публічний URL у клієнтський бандл на етапі build.

Змінити домен назви заміни й перезбирай:

```bash
docker compose build dashboard && docker compose up -d
```

Домен у `deploy/nginx/dashboard.conf` уже проставлений
(`guild.lihvodruida.pp.ua`). Якщо міняєте його — там чотири місця:
`server_name` двічі і два шляхи до сертифікатів.

---

## 4. Cloudflare

Cloudflare тут виконує три ролі: DNS, TLS до відвідувача і фільтр трафіку
перед нашим Nginx. Дані він не зберігає — панель повністю на нашому сервері.

### 4.1. DNS-записи

У Cloudflare → домен `lihvodruida.pp.ua` → **DNS → Records**:

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| `A` | `guild` | `<IP сервера>` | 🟠 Proxied | Auto |
| `AAAA` | `guild` | `<IPv6 сервера>` | 🟠 Proxied | Auto |

AAAA додавайте лише якщо IPv6 на сервері реально працює. Запис, що вказує на
непрацюючу адресу, дає плаваючі таймаути: частина відвідувачів піде по IPv6 і
впреться в тишу, а ви бачитимете «у мене все відкривається».

Перевірка:

```bash
dig +short guild.lihvodruida.pp.ua
# У проксі-режимі поверне IP Cloudflare (104.x / 172.6x), а не ваш сервера —
# це нормально і означає, що проксі увімкнено.
```

### 4.2. Режим шифрування

**SSL/TLS → Overview → Full (strict)**.

Це єдиний правильний варіант. Для порівняння:

| Режим | Що робить | Чому не він |
|-------|-----------|-------------|
| Off | без TLS | трафік відкритий |
| Flexible | TLS до Cloudflare, HTTP до сервера | другий відрізок відкритий; плюс дає нескінченний редірект із нашим Nginx |
| Full | TLS до сервера, сертифікат не перевіряється | приймає самопідписаний — MITM між Cloudflare і сервером не виявляється |
| **Full (strict)** | TLS + перевірка сертифіката | ✅ наш випадок: у нас справжній Let's Encrypt |

**SSL/TLS → Edge Certificates:**

- **Always Use HTTPS** — увімкнути
- **Automatic HTTPS Rewrites** — увімкнути
- **Minimum TLS Version** — 1.2
- **HSTS** — вмикати **лише після того**, як сайт стабільно працює по HTTPS
  щонайменше тиждень. HSTS не можна швидко відкотити: браузери запамʼятовують
  політику на вказаний строк, і помилка тут закриває сайт для всіх, хто вже
  його відвідував.

### 4.3. Отримання сертифіката за проксі

Let's Encrypt перевіряє домен по HTTP-запиту на `/.well-known/acme-challenge/`.
За проксі Cloudflare із режимом Full (strict) це **не спрацює**, поки на
origin немає валідного сертифіката: Cloudflare не зможе достукатись до
сервера і поверне 521. Порядок такий:

1. DNS → записи `guild` (**і A, і AAAA**) → перемкнути на **DNS only**
   (сіра хмара)
2. Дочекатись пари хвилин
3. Підняти стек і випустити сертифікат (розділи 5–6)
4. Повернути **Proxied** (помаранчева хмара) на обидва записи

Якщо AAAA лишити під проксі, а A зняти — перевірка все одно впаде: Let's
Encrypt віддає перевагу IPv6.

Поновлення потім працює і за проксі — у Nginx уже є `location` для
`/.well-known/acme-challenge/`, який віддається без редіректу на HTTPS.

### 4.4. Реальний IP відвідувача

За проксі кожен запит приходить з IP Cloudflare. Без налаштування всі
обмеження частоти й журнали бачили б один і той самий адрес, а бан одного
порушника означав би бан усіх.

`deploy/nginx/nginx.conf` уже містить `set_real_ip_from` для мереж Cloudflare і
бере адресу з `CF-Connecting-IP`. Актуальний список мереж:

```bash
curl -s https://www.cloudflare.com/ips-v4
curl -s https://www.cloudflare.com/ips-v6
```

Cloudflare змінює його рідко (раз на кілька років), але при зміні старий
список призводить до того, що Nginx перестає довіряти заголовку й повертається
до IP проксі. Перевірка:

```bash
docker compose logs nginx | tail -20
# У логах мають бути IP відвідувачів, а не 172.6x.x.x
```

### 4.5. Правила безпеки

**Security → WAF → Rate limiting rules.** Захист входу від перебору:

| Поле | Значення |
|------|----------|
| Name | `login-throttle` |
| If incoming requests match | `URI Path` `starts with` `/api/auth/` |
| Rate | 10 requests per 1 minute per IP |
| Action | Block, 1 minute |

**Важливо — виняток для Discord.** Discord надсилає взаємодії з власних
адрес і не терпить затримок. Створіть **WAF → Custom rules** правило:

| Поле | Значення |
|------|----------|
| Name | `discord-interactions-bypass` |
| Expression | `(http.request.uri.path eq "/discord/interactions")` |
| Action | **Skip** → Rate limiting, Managed rules, Bot Fight Mode |

Без цього винятку Bot Fight Mode рано чи пізно почне віддавати Discord
challenge-сторінку замість відповіді. Проявляється це як «Дія не вдалася» у
всіх кнопках гільдії, і причину шукають у боті, хоча запит до нього не дійшов.

**Bot Fight Mode** тримайте вимкненим, якщо не впевнені: він блокує і
легальні інтеграції.

### 4.6. Кешування

**Caching → Configuration → Caching Level: Standard.**

Панель віддає `Cache-Control: no-store` на всі динамічні відповіді, тож
Cloudflare їх не кешуватиме. Статика Next.js (`/_next/static/*`) має незмінні
хеші в іменах і кешується безпечно.

Якщо після оновлення користувачі бачать стару версію:

```
Caching → Configuration → Purge Everything
```

**Не вмикайте** «Cache Everything» через Page Rules: це закешує сторінки
авторизованих користувачів і покаже чужий профіль наступному відвідувачу.

### 4.7. Перевірка

```bash
curl -sI https://guild.lihvodruida.pp.ua/api/health | head -20
```

Очікувано: `HTTP/2 200`, заголовок `cf-ray` (запит пройшов через Cloudflare),
`cache-control: no-store`.

```bash
curl -fsS https://guild.lihvodruida.pp.ua/api/health
# {"ok":true,"service":"mistblossom-dashboard",...}
```

## 5. Сертифікат

> **Проксі Cloudflare має бути вимкнено** на час першого випуску: DNS →
> записи `guild` (**і A, і AAAA**) → **DNS only** (сіра хмара). Інакше запит
> ACME піде через Cloudflare, а той у режимі Full (strict) без валідного
> сертифіката на origin до сервера не достукається — побачите `521`.
>
> Let's Encrypt віддає перевагу IPv6, тому залишений під проксі AAAA ламає
> перевірку навіть коли з A все гаразд. Це найчастіша невдача тут.

Nginx не стартує без файлів сертифіката, а certbot не пройде перевірку без
працюючого Nginx. Розриваємо коло заглушкою:

```bash
cd /srv/mistblossom

make cert-self    # 1. заглушка, щоб nginx узагалі піднявся
make up           # 2. перевірки + збірка + послідовний запуск
make cert         # 3. справжній сертифікат
```

Домен і email скрипт бере з `.env` (`DASHBOARD_PUBLIC_URL`,
`LETSENCRYPT_EMAIL`) — руками їх вводити не треба. Це навмисно: порожня
змінна `$DOMAIN` у командному рядку дає помилку certbot
`Requested domain is not a FQDN because it contains an empty label`, і
причину потім довго шукають у DNS.

Перед випуском `cert.sh` сам перевіряє, що челендж доступний ззовні, і
розрізняє коди відповіді: `404` — усе гаразд, маршрут працює;
`521` — Cloudflare не бачить origin, зніміть проксі; `000` — домен не
відповідає, проблема в DNS.

Стан сертифіката будь-коли:

```bash
./deploy/scripts/cert.sh --status
```

**Після успішного випуску повертайте Proxied** у Cloudflare на обидва записи.

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

## 6. Запуск

```bash
cd /srv/mistblossom
make up
```

> **`Permission denied` на скрипті?** Біт виконання губиться при перенесенні
> файлів через Windows, SFTP або при розпакуванні деякими архіваторами. Саме
> тому основний спосіб запуску — `make`: він від цього біта не залежить і
> відновлює права сам. Разовий ручний варіант:
> `chmod +x deploy/scripts/*.sh` або `bash ./deploy/scripts/start.sh`.

`make up` викликає `deploy/scripts/start.sh --build`, який замінює
`docker compose up -d` і робить те, чого Compose не робить.

**Перевірки до запуску.** Docker і плагін compose; наявність і права всіх
трьох файлів конфігурації; обовʼязкові змінні; **звірка значень, які мусять
збігатися між панеллю й ботом** (`DISCORD_PUBLIC_KEY`, `INTERNAL_API_TOKEN`,
`DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN`); хост у `DATABASE_URL`; наявність
сертифіката; місце на диску; валідність `docker-compose.yml`.

Звірка ключів тут не зайва обережність: розбіжність не дає помилки при
старті — обидва сервіси піднімуться, а Discord мовчки відповідатиме «Дія не
вдалася». Знайти це потім коштує години.

**Послідовний запуск.** База → схема → панель → бот → nginx → cron. Після
кожного сервісу скрипт дочікується стану `healthy`, а не просто «контейнер
створено».

Схема бази накочується через `psql` у контейнері бази, а не скриптом усередині
образу панелі. Так цей крок не залежить від того, чи зібралась панель: схему
можна застосувати навіть коли збірка щойно впала. Різниця принципова: без очікування панель стартує раніше за базу,
падає на першому запиті й іде в цикл перезапусків, а `docker compose up -d`
показує при цьому зелений вивід.

**Перевірка після запуску.** Панель і бот опитуються зсередини, публічний
URL — ззовні.

Режими:

| Команда | Еквівалент | Що робить |
|---------|------------|-----------|
| `make start` | `start.sh` | звичайний запуск |
| `make up` | `start.sh --build` | зі збіркою образів |
| `make check` | `start.sh --check` | тільки перевірки |
| `make restart` | `start.sh --build --restart` | повний перезапуск |
| `make stop` | `stop.sh` | зупинка |
| `make ps` / `make logs` | — | стан і логи |

Повний перелік — `make help`.

`--check` корисний перед оновленням: якщо в новій версії зʼявилась
обовʼязкова змінна, дізнатись про це краще до зупинки робочої версії.

Зупинка:

```bash
make stop                            зупинити все
./deploy/scripts/stop.sh --keep-db   зупинити все, крім бази
```

`--keep-db` потрібен для обслуговування: записи зупинені, але база доступна
для `psql`, дампа чи відновлення.

### Автостарт після перезавантаження сервера

```bash
sudo cp deploy/systemd/mistblossom.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mistblossom
```

Юніт запускає той самий `start.sh`, а не `docker compose up` напряму. Саме
після ребуту порядок і має значення: усе стартує одночасно й повільно, і без
очікування готовності панель гарантовано випереджає базу.

```bash
sudo systemctl status mistblossom     стан
sudo systemctl restart mistblossom    перезапуск
sudo systemctl reload mistblossom     перезбірка образів і перезапуск
journalctl -u mistblossom -f          логи запуску
```

---

## 7. Планові задачі

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

## 8. Помилки збірки

**`"/dashboard/vendor": not found`, `COPY shared: not found`, у логах
`transferring context: 2B`.** Контекст збірки вказаний неправильно. Обидва
образи збираються з **кореня репозиторію**, а не з підкаталогів: панелі
потрібен `shared/` (вона посилається на нього як `file:../shared`), боту —
теж. У `docker-compose.yml` має бути:

```yaml
  dashboard:
    build:
      context: .
      dockerfile: dashboard/Dockerfile
  bot:
    build:
      context: .
      dockerfile: bot/Dockerfile
```

Ознака саме цієї помилки — `transferring context: 2B` у виводі: BuildKit не
знайшов жодного шляху з `COPY` і не передав нічого.

**`Cannot find module '/app/server.js'` після успішної збірки.** Через
`outputFileTracingRoot = корінь репозиторію` дерево standalone має зайвий
рівень: точка входу лежить у `.next/standalone/dashboard/server.js`. У
Dockerfile має бути `CMD ["node", "dashboard/server.js"]`, а `public` треба
класти в `./dashboard/public` — у корені `/app` сервер статику не шукає.

**Збірка тягне сотні мегабайт контексту.** Немає `.dockerignore` у корені.
Без нього в демон їде все дерево разом із `node_modules` і `.next`.

**`./deploy/scripts/start.sh: Permission denied`.** Загублений біт виконання.
Використовуйте `make up` — він від цього не залежить. Або разово:
`chmod +x deploy/scripts/*.sh`.

**`container mistblossom-dashboard-1 is unhealthy`, процес при цьому живий
(`Up 13 minutes (unhealthy)`).** Healthcheck ходить на
`http://127.0.0.1:3000/api/health`, тобто з `Host: 127.0.0.1:3000`. У
продакшені перевірка хоста навмисно відхиляє localhost і віддає редірект 308
на канонічний домен; `fetch` за редіректом не йде і бачить не-2xx. Контейнер
лишається `unhealthy` назавжди, а разом із ним не стартує nginx, у якого
`depends_on: service_healthy`.

Виправлено в `src/proxy.ts`: шлях `/api/health` із loopback-хоста не
проходить перевірку. Якщо симптом повернувся — перевірте, що ваша версія
містить `HOST_CHECK_EXEMPT_PATHS`.

---

## 9. Збірка на слабкому сервері

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
  --build-arg NEXT_PUBLIC_DASHBOARD_URL=https://guild.lihvodruida.pp.ua \
  ./dashboard
docker save mistblossom/dashboard:latest | gzip | ssh server 'gunzip | docker load'

# на сервері
docker compose up -d --no-build
```

Можна також зменшити паралелізм збірки: `NEXT_BUILD_CPUS=1` в оточенні.

---

## 10. Мапа файлів розгортання

```
docker-compose.yml                  стек: postgres + dashboard + bot + nginx + cron + certbot
.env                                параметри стека (домен, паролі, токени)

dashboard/Dockerfile                триетапна збірка standalone-образу панелі
dashboard/.env.production           секрети панелі
dashboard/src/lib/db/schema.sql     схема бази
dashboard/scripts/db-init.mjs       застосування схеми

bot/Dockerfile                      образ Discord-бота
bot/.env.production                 секрети бота
shared/                             спільний контракт custom_id (бот + панель)

deploy/nginx/nginx.conf             базовий конфіг: логи, gzip, ліміти, real_ip
deploy/nginx/dashboard.conf         віртуальний хост, TLS, маршрути на dashboard і bot
deploy/nginx/proxy-params.inc       спільні proxy-заголовки
deploy/cron/run-cron.sh             планові задачі
Makefile                            зручні команди: make up / stop / cert / backup
deploy/scripts/start.sh             перевірки + послідовний запуск стека
deploy/scripts/stop.sh              коректна зупинка (зворотний порядок)
deploy/scripts/cert.sh              випуск і поновлення сертифіката
deploy/scripts/deploy.sh            оновлення версії з відкотом
deploy/scripts/db-backup.sh         бекап бази з перевіркою цілісності
deploy/scripts/db-restore.sh        відновлення з дампа
deploy/systemd/mistblossom.service  автостарт стека після перезавантаження
deploy/systemd/mistblossom-certbot.{service,timer}   поновлення сертифіката
```

---

## 11. Після розгортання

1. Discord Developer Portal → **Interactions Endpoint URL**:
   `https://guild.lihvodruida.pp.ua/discord/interactions`.
   Discord одразу надішле тестовий PING — якщо він не пройде, портал не дасть
   зберегти URL. Це найшвидша перевірка, що бот і Cloudflare налаштовані вірно.
2. Discord OAuth → **Redirects**:
   `https://guild.lihvodruida.pp.ua/api/auth/discord/callback`.
3. Battle.net OAuth → **Redirect URI**:
   `https://guild.lihvodruida.pp.ua/api/auth/battlenet/callback`.
4. Перенесення даних із Firestore, якщо воно ще не зроблене —
   [DATABASE.md](./DATABASE.md).
5. Налаштувати щоденний бекап — [OPERATIONS.md, розділ 5](./OPERATIONS.md).

Далі — [OPERATIONS.md](./OPERATIONS.md): щоденний контроль, оновлення й розбір
інцидентів.
