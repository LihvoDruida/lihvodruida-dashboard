# Етап 2 — прев’ю, швидша реакція на стріми та стійкість API

20.10.2026 · Dashboard **3.16.0** · Site **4.6.3** · Bot **3.6.9**.
База: збережені повні архіви Dashboard 3.15.2 / Site 4.6.2. Виправлення етапу 1 включені.

## Чому на скріні немає прев’ю

У нашому payload Discord були title, description, URL, поле платформи й кнопка, але **взагалі не було `embed.image`**. Сам URL у власній embed-картці не замінює явне зображення. На скріні текстова embed уже відображається, тому відсутнє поле зображення підтверджено кодом; права Discord не оголошуються причиною без перевірки сервера.

Тепер Twitch LIVE і записи отримують `thumbnail_url`, YouTube LIVE/відео — найкращу доступну `snippet.thumbnails`, TikTok відео — `cover_image_url`. Додана перевірка HTTPS і доменів CDN. Twitch placeholders замінюються на 1280×720; стабільний параметр media ID відокремлює новий ефір від зображення попереднього в кеші Discord. Підписані URL TikTok збережені. Якщо API не повернув допустиму обкладинку або CDN її вже не віддає, повідомлення лишається читабельним із кнопкою.

Twitch також показує гру/категорію та поточних глядачів, включно з коректним значенням 0. Це показник на момент перевірки, не лічильник, що оновлюється у вже надісланому повідомленні.

Нові правила застосовані до всіх підтримуваних платформ і типів сповіщень. Старі повідомлення не дублюються й не редагуються автоматично. TikTok Display API тут використовується для нових відео; LIVE TikTok не вигадується.

## Чому реакція могла запізнюватися

Код мав послідовний обхід до восьми каналів, надсилання лише після всіх перевірок та однаковий п’ятихвилинний retry після помилки. Twitch LIVE також чекав завершення читання каталогу відео. З одного скріна неможливо визначити, який саме чинник дав різницю в чотири хвилини: журнали production і фактичний розклад cron не надані.

Зміни:

- Черга доставки обробляється до опитування й одразу після підтвердженої зміни. LIVE не чекає необов’язкових Twitch videos; вони обробляються окремою фазою.
- До трьох перевірок виконуються паралельно. Усі consumers завершуються перед звільненням спільного lease; дедлайн і скасування збережені.
- Стрімери отримали окремий cron tick **30 с**. Twitch перевіряється через 30 с, YouTube feed/videos — через 90 с; добовий search-бюджет YouTube збережений.
- Тимчасові помилки починають retry з 30 с із поступовим збільшенням до 5 хв. Підтверджені проблеми доступу/конфігурації мають довшу контрольну паузу. Provider retryAt ніколи не скорочується ручною перевіркою.
- У списку сповіщень Dashboard окремо показані секунди від фактичного початку до виявлення та від виявлення до підтвердженої доставки.

30 секунд — інтервал планування, **не гарантія доставки за 30 секунд**. Впливають кеш/стан API, квота, доступність сервісів, lease, cron і черга Discord.

## Twitch EventSub

Доданий POST `/api/integrations/twitch/eventsub` із перевіркою HMAC-SHA256 по сирому тілу, timing-safe порівнянням, часом, схемою, broadcaster ID і захистом від повторної/старої події. Непідписані запити не запускають перевірку.

Після приймання зберігається due-сигнал каналу, endpoint швидко відповідає, а Next `after()` запускає цільову перевірку. Якщо процес перезапуститься або lease зайнятий, сигнал підхопить cron. EventSub будить перевірку; авторитетний стан і метадані читаються з Helix. Підписані online/offline не створюють окремої другої системи надсилання: використовується та сама publication ledger і дедуплікація.

За наявності конфігурації cron реєструє `stream.online`/`stream.offline` для активних визначених каналів і повторює reconciliation раз на 15 хвилин, після збою — через 5 хв. Змінюються лише підписки точного власного callback. Зовнішній I/O reconciliation має загальний бюджет 8 с. Без EventSub працює опитування.

Повне керування застарілими підписками видалених каналів і production-приймання залишені в C33. Підписки інших інтеграцій не видаляються.

## C06–C08

| Пункт | Реалізація |
|---|---|
| C06 | `externalApiCooldowns` у чинній таблиці `documents`: спільні паузи Twitch/YouTube/TikTok/Battle.net/Raider.IO; абсолютний retryAt; атомарний UPSERT не скорочує довший дедлайн; читання перед dispatch; fail closed при недоступності БД |
| C06 — квоти | Retry-After у секундах/HTTP-date; Twitch Ratelimit-Reset і remaining=0 навіть за 200; окремі YouTube search/data buckets; daily quota до наступної півночі Pacific time із DST і запасом; глобальний 429 охоплює credential scope |
| C07 | Twitch token спочатку проходить `/validate`, звіряються client ID, scopes та expires; спільна Promise для паралельного отримання/перевірки; контрольована заміна після 401; періодична перевірка через 55 хвилин, без утримання процесу таймером; негативна кеш-пауза проти шторму |
| C08 | Спільний byte-bounded reader, JSON Content-Type, схеми, AbortSignal, без очікування нескінченного cancel; безпечні коди замість сирого HTML/пошкодженого JSON; невизначений Discord POST зберігає квитанцію для звірки |

Ліміти: generic API 4 MiB, Discord OAuth/Battle.net token/userinfo 128 KiB, Discord REST 8 MiB, streamer JSON/feed 1 MiB, custom YouTube HTML 2 MiB. Неповний member/ban payload відхиляється замість трактування як порожні ролі чи підтверджений бан. Власні JSON-пояснення форм Dashboard зберігаються, зовнішні HTTP-помилки мають безпечний текст.

Нових залежностей і SQL-таблиць немає. Для EventSub додані два необов’язкові env. Квота вже відправлених паралельних запитів не повертається; отриманий 429 зупиняє наступні dispatch, не відкликає минулі запити.

## Встановлення

1. У `/srv/mistblossom` зробити `make backup`, зберегти env, старий код/образи й `STREAMER_TOKEN_KEY`.
2. Оновити Dashboard, зберігаючи env і volumes; виконати чинну підготовку парної конфігурації, `make check`, `make up`.
3. **Пересоздати cron:** `docker compose up -d --no-deps --force-recreate cron`. Без цього старий контейнер може продовжити старий tick.
4. Для EventSub додати в `dashboard/.env.production`:

```dotenv
STREAMER_TWITCH_EVENTSUB_CALLBACK=https://guild.lihvodruida.pp.ua/api/integrations/twitch/eventsub
STREAMER_TWITCH_EVENTSUB_SECRET=<окремий секрет: openssl rand -hex 32>
```

У callback підставити власний чинний HTTPS-домен Dashboard, перевірити TLS і дозволити точний POST у WAF/Cloudflare без browser challenge. Пересоздати Dashboard після зміни env. Секрет не надсилати в чат і не використовувати замість інших токенів.

5. Перевірити cron, стан реєстрації `streamerProviderQuota/twitch-eventsub`, початок/кінець реального ефіру й нову картку Discord. Порівняти нові показники затримки за кількома стартами.
6. Site 4.6.3 містить актуальну інструкцію й версію без зміни runtime; Site 4.6.1/4.6.2 залишаються сумісними. Bot не змінений.

Повний runbook: `docs/RELEASE_INSTALL_2026-10-19_UA.md` у Dashboard; побайтова копія в Site.

## Межі перевірки

VPS не оновлювався. Реальні повідомлення, виключення учасників або зміни зовнішніх Twitch subscriptions не виконувалися. Поведінкові тести використовують справжні модулі й SQL/PGlite з контрольованим HTTP. Вони не замінюють PostgreSQL 17, WAF/TLS, реальні квоти/API/CDN й вимірювання production-затримки. Browser UI та npm audit цього релізу не виконані.

C10–C13 залишаються наступним блоком; C33 частково реалізовано, C43 — реальне вимірювання затримки — відкритий.

## Офіційні джерела

- https://dev.twitch.tv/docs/eventsub/handling-webhook-events/
- https://dev.twitch.tv/docs/eventsub/manage-subscriptions/
- https://dev.twitch.tv/docs/api/reference/#get-streams
- https://dev.twitch.tv/docs/authentication/validate-tokens/
- https://developers.google.com/youtube/data/reference/rest/v3/videos
- https://developers.google.com/youtube/data/determine_quota_cost
- https://developers.tiktok.com/doc/tiktok-api-v2-video-object/
- https://docs.discord.com/developers/resources/message

## Результати фінальної перевірки

| Набір | Результат |
|---|---|
| Dashboard `build:ci` | PASS, повний чистий прогін, exit 0; production build та standalone 8/8 |
| Dashboard ESLint / TypeScript | PASS |
| API / Twitch / EventSub / прев’ю | 18/18 PASS — справжні модулі та PGlite, контрольований HTTP |
| Стрімери | 50/50 PASS, включно з доставкою LIVE до завершення завислого VOD-запиту й відсутністю дубля після відновлення |
| Попередній OAuth/API hardening | 22/22 PASS |
| Discord REST / Battle.net | 17/17 + 17/17 PASS |
| Очищення учасників / захист ролей | 119 + 11 сценаріїв PASS; реальних виключень немає |
| Dashboard HTTP-запити / мутації опитувань | 3 + 18 сценаріїв PASS; невизначений POST не повторюється |
| API security / production proxy | PASS; 99 mutation route files, точний signed EventSub endpoint і захист сусіднього шляху |
| Site `build:ci` | PASS, exit 0; 50 стандартних Node-тестів, 3 парні стандартно пропущені; 19 deploy-тестів; production build/standalone |
| Окремі парні Site тести | 5/5 PASS без пропусків |
| Dashboard → Site → outbox → Discord recovery | PASS із перехопленими зовнішніми діями |
| Bot | 55/55 PASS |

Числа різних наборів не підсумовуються через перекриття. Середовище: Node 24.19.0, npm 11.9.0. У попередньому повторному прогоні Turbopack відхилив пошкоджений локальний warm cache (`Failed to open database / invalid digit found in string`). Кеш збережено окремо, фінальний повний прогін виконано на чистому `.next`. Код і залежності для цього не змінювалися.

Архіви містять усі файли базових релізів плюс поточний код і документацію. `node_modules`, `.next`, локальні кеші, приватні env та ключі не включені.
