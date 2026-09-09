# Переїзд з Firestore на власний PostgreSQL

Цей документ описує перенесення даних панелі з Firestore у власну базу на
твоєму сервері. Розгортання самого сервера — у [DEPLOYMENT.md](./DEPLOYMENT.md);
тут тільки про базу.

Переїзд спроєктований так, щоб **відкат займав одну змінну оточення**. Поки
Firebase-ключі лишаються в `.env.production`, повернутись назад можна, просто
прибравши `DATABASE_URL` і перезапустивши панель.

---

## 1. Як це влаштовано

Код панелі не переписувався під SQL. Замість цього зʼявився адаптер, який
повторює той зріз API Firestore, який проєкт реально використовує:

| Файл | Що робить |
|------|-----------|
| `src/lib/db/pgPool.ts` | пул зʼєднань, транзакції з повторами на 40001 |
| `src/lib/db/documentStore.ts` | `collection`/`doc`/`where`/`orderBy`/`runTransaction`/`batch`, сентинели `FieldValue`, клас `Timestamp` |
| `src/lib/db/firestoreCompat.ts` | одна точка, звідки код бере `FieldValue`/`Timestamp`/`FieldPath` |
| `src/lib/db/schema.sql` | таблиця `documents` та індекси |
| `src/lib/firebaseAdmin.ts` | вибір сховища: PostgreSQL, якщо задано `DATABASE_URL` |

Дані зберігаються так само документами: таблиця `documents (collection, doc_id,
data jsonb)`. Це навмисно, а не через лінощі — переписати двадцять девʼять
модулів на реляційну схему одним кроком означало б переписати й усю бізнес-логіку.
Нормалізацію окремих колекцій можна робити потім і поступово, коли стане видно,
які запити справді болять.

Підколекції зберігаються як колекція з повним шляхом у назві:
`guildRecords/abc123/chunks`.

### Що адаптер НЕ вміє

Свідомо не реалізовані речі, яких у проєкті немає: оператори `in`,
`array-contains`, `!=`, курсори за кількома полями, читання запитів усередині
транзакції. Якщо такий виклик зʼявиться, адаптер кине `PgUnsupportedOperation`
з явним текстом — це краще, ніж мовчки повернути не те.

---

## 2. Підготовка бази

Postgres уже є в `docker-compose.yml` окремим сервісом. Порт 5432 назовні не
публікується: до бази ходить лише панель через внутрішню мережу `data`, до якої
`nginx` і `cron` доступу не мають.

Додай у `.env` (поруч із `docker-compose.yml`):

```bash
POSTGRES_DB=mistblossom
POSTGRES_USER=mistblossom
POSTGRES_PASSWORD=<довгий випадковий пароль>
```

Пароль згенеруй, не вигадуй:

```bash
openssl rand -base64 32
```

Підніми базу й застосуй схему:

```bash
docker compose up -d postgres
docker compose exec postgres pg_isready -U mistblossom

# схема застосовується з машини, де є код
DATABASE_URL='postgresql://mistblossom:<пароль>@localhost:5432/mistblossom' \
  npm --prefix dashboard run db:init
```

Очікуваний вивід: `✓ Схему застосовано. Індексів на documents: 6`.

Скрипт ідемпотентний (`IF NOT EXISTS` / `OR REPLACE`), тож його безпечно
запускати на кожному деплої.

---

## 3. Пробний прогін

**Не перемикай прод одразу.** Спершу перенеси дані «вхолосту» і звір числа.

```bash
cd dashboard
export DATABASE_URL='postgresql://mistblossom:<пароль>@localhost:5432/mistblossom'
export FIREBASE_PROJECT_ID=...
export FIREBASE_CLIENT_EMAIL=...
export FIREBASE_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...'

npm run db:migrate-dry-run
```

Пробний прогін читає Firestore, нічого не пише і показує кількість документів
у кожній колекції. Звір ці числа з консоллю Firebase.

Одну колекцію можна перенести окремо:

```bash
node scripts/migrate-firestore-to-postgres.mjs --only=dashboardProfiles
```

---

## 4. Бойове перенесення

Скрипт **ідемпотентний**: повторний запуск перезаписує документи за тим самим
ключем. Тому робочий сценарій такий:

1. **Чорновий прогін заздалегідь**, на живій панелі. Перенесе 99% даних і
   покаже, скільки часу це займає.
2. **Вікно простою** — коротке, бо лишиться доперенести тільки зміни:

```bash
# 1. Зупиняємо записи
docker compose stop dashboard cron

# 2. Фінальний прогін
cd dashboard && npm run db:migrate-from-firestore

# 3. Перемикаємо сховище
echo 'DATABASE_URL=postgresql://mistblossom:<пароль>@postgres:5432/mistblossom' \
  >> .env.production

# 4. Піднімаємо
cd .. && docker compose up -d
curl -fsS https://guild.lihvodruida.pp.ua/api/health
```

> У `.env.production` хост — `postgres` (імʼя сервісу в docker-мережі), а не
> `localhost`. З машини для міграції — навпаки, `localhost`. Це найчастіша
> помилка на цьому кроці.

Наприкінці скрипт сам друкує кількість документів у кожній колекції
PostgreSQL — звір їх із виводом пробного прогону.

---

## 5. Перевірка після перемикання

```bash
# сховище перемкнулось?
docker compose exec postgres psql -U mistblossom -d mistblossom \
  -c "SELECT collection, count(*) FROM documents GROUP BY 1 ORDER BY 1;"
```

Далі — руками в панелі, бо це єдиний спосіб зловити проблеми в записі:

- відкрий список рейд-пулів і сторінку конкретного пулу;
- **проголосуй у Discord** і подивись, чи змінився embed і чи оновився сайт;
- створи тестовий рейд, запишись, видали його;
- перевір сторінку профілю й склад гільдії;
- глянь `/dashboard/logs` — там мають бути записи без помилок.

Голосування — найважливіший тест: воно проходить через транзакцію,
крапкові шляхи (`votesByDiscordId.<id>`) і `FieldValue.delete()` одночасно.
Якщо працює воно — працює найскладніша частина адаптера.

---

## 6. Відкат

Поки Firebase-ключі на місці, відкат займає хвилину:

```bash
# прибрати DATABASE_URL з dashboard/.env.production
docker compose up -d dashboard
```

Панель побачить, що `DATABASE_URL` немає, і повернеться до Firestore.
Дані, записані в PostgreSQL після перемикання, у Firestore не потраплять —
тому не тягни з рішенням і не тримай обидва сховища живими тижнями.

Прибирати Firebase-ключі й залежність `firebase-admin` варто лише після того,
як панель відпрацювала на PostgreSQL хоча б один повний тиждень із живими
рейдами і пулами.

---

## 7. Резервні копії

Firestore бекапився засобами Google. Тепер це твоя відповідальність.

```bash
./deploy/scripts/db-backup.sh
```

Скрипт знімає дамп у форматі `custom`, **перевіряє, що дамп читається**
(`pg_restore --list`) і прибирає копії, старші за 14 днів. Перевірка тут не
формальність: порожній або обрізаний дамп гірший за відсутність бекапу, бо
створює ілюзію захищеності.

Щодня о 03:30:

```bash
sudo crontab -e
```

```cron
30 3 * * * cd /srv/mistblossom && ./deploy/scripts/db-backup.sh >> /var/log/mistblossom-backup.log 2>&1
```

Відновлення:

```bash
./deploy/scripts/db-restore.sh backups/mistblossom-2026-09-08-0330.dump
```

**Копії треба возити з сервера.** Бекап, який лежить на тому ж диску, що й
база, не рятує від смерті диска:

```bash
rsync -avz --delete /srv/mistblossom/backups/ backup-host:/backups/mistblossom/
```

Раз на квартал відновлюй дамп у порожню базу й перевіряй, що панель на ньому
піднімається. Неперевірений бекап — це не бекап.

---

## 8. Обслуговування

**Розмір бази і найважчі колекції:**

```sql
SELECT collection,
       count(*)                                    AS documents,
       pg_size_pretty(sum(pg_column_size(data)))   AS data_size
FROM documents
GROUP BY collection
ORDER BY sum(pg_column_size(data)) DESC;
```

**Повільні запити.** Postgres налаштований логувати все, що триває понад
секунду:

```bash
docker compose logs postgres | grep 'duration:'
```

**Автовакуум** для JSONB із частими оновленнями (рейд-пули під час голосування)
варто зробити агресивнішим:

```sql
ALTER TABLE documents SET (autovacuum_vacuum_scale_factor = 0.05);
```

**Оновлення мажорної версії Postgres** (17 → 18) не робиться підміною тега в
compose: формат даних на диску несумісний. Порядок — дамп, підняти новий образ
на порожньому томі, відновити дамп.

---

## 9. Типові проблеми

| Симптом | Причина | Що робити |
|---------|---------|-----------|
| `Сховище не налаштоване` | немає ні `DATABASE_URL`, ні ключів Firebase | перевір `.env.production` у контейнері: `docker compose exec dashboard env \| grep DATABASE_URL` |
| `ECONNREFUSED 127.0.0.1:5432` | у `.env.production` вказано `localhost` замість `postgres` | виправ хост на імʼя сервісу |
| `No document to update` | код оновлює документ, якого немає | так само поводиться Firestore; шукай логічну помилку у виклику, а не в адаптері |
| `PgUnsupportedOperation` | зʼявився новий тип запиту | додай підтримку в `documentStore.ts` — текст помилки називає операцію |
| Транзакції падають із 40001 | конкуренція за той самий документ | адаптер повторює до 5 разів; якщо не допомагає, шукай запис у циклі |
| Панель повільна після переїзду | немає індексу під новий запит | подивись `log_min_duration_statement` і додай індекс у `schema.sql` |

---

## 10. Мапа файлів

| Файл | Призначення |
|------|-------------|
| `dashboard/src/lib/db/schema.sql` | схема таблиці й індекси |
| `dashboard/src/lib/db/pgPool.ts` | пул, транзакції з повторами |
| `dashboard/src/lib/db/documentStore.ts` | адаптер, сумісний із Firestore |
| `dashboard/src/lib/db/firestoreCompat.ts` | вибір реалізації `FieldValue`/`Timestamp` |
| `dashboard/scripts/db-init.mjs` | застосування схеми |
| `dashboard/scripts/migrate-firestore-to-postgres.mjs` | перенесення даних |
| `deploy/scripts/db-backup.sh` | бекап із перевіркою цілісності |
| `deploy/scripts/db-restore.sh` | відновлення |
| `docker-compose.yml` | сервіс `postgres`, мережа `data`, том `pgdata` |
