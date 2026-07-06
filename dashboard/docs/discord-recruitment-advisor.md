# Discord Recruitment Advisor

Автоматична система відповіді на повідомлення поверненців/новачків, які питають, за який клас почати грати і що потрібно гільдії.

## Поточна схема

Vercel cron більше не використовується для цієї системи. На Hobby плані Vercel дозволяє cron не частіше одного разу на день, тому миттєва реакція робиться через окремий Discord Gateway бот.

```text
Discord MESSAGE_CREATE
  -> scripts/discord-recruitment-gateway-bot.mjs
  -> POST /api/discord/recruitment-advice/message
  -> аналіз guildRoster + Raider.IO даних
  -> відповідь у той самий channel_id / thread
```

## Що робить

- Реагує на нові повідомлення Discord через Gateway `MESSAGE_CREATE`.
- Не потребує `DISCORD_RECRUITMENT_ADVICE_CHANNEL_IDS`.
- Відповідає саме там, де користувач написав: у каналі або треді з `message.channel_id`.
- Визначає повідомлення з наміром: повернення у WoW, питання про вибір класу, згадка гільдії/рейдів/RIO/дефіциту.
- Бере останній нормалізований склад гільдії з `guildRosterRecords`, не запускаючи важкі live-запити до Raider.IO під кожне повідомлення.
- Аналізує високорівневих персонажів із RIO, дефіцит класів, корисні raid/M+ бафи й ролі.
- Формує розгорнуту українську відповідь з рекомендаціями, альтернативами і footer:

```text
_Повідомлення є автоматичним._
```

- Захищає від повторних відповідей через Firestore-колекцію `discordRecruitmentAdviceReplies`; без Firebase використовує runtime-захист на час життя процесу.

## Dashboard endpoint для Gateway-бота

```text
POST /api/discord/recruitment-advice/message
```

Потрібен Bearer token з одного з env:

```text
DISCORD_RECRUITMENT_ADVICE_SECRET
CRON_SECRET
INTERNAL_API_TOKEN
WORKER_STATS_TOKEN
```

Приклад payload:

```json
{
  "message": {
    "id": "123456789012345678",
    "channel_id": "123456789012345678",
    "content": "Доброго вечора... за який клас краще розпочати гру?",
    "timestamp": "2026-07-06T19:30:00.000000+00:00",
    "type": 0,
    "author": {
      "id": "123456789012345678",
      "username": "user",
      "global_name": "User",
      "bot": false
    }
  }
}
```

## Запуск Gateway-бота

```bash
npm run discord:recruitment-bot
```

Цей процес має працювати постійно: на твоєму сервері, VPS, домашньому сервері, PM2, Docker, systemd або іншому процес-менеджері. Vercel serverless для цього не підходить, бо Discord Gateway — це довгий WebSocket-звʼязок.

Мінімальні env:

```text
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DASHBOARD_URL=https://admin.lihvodruida.pp.ua
DISCORD_RECRUITMENT_ADVICE_ENABLED=true
DISCORD_RECRUITMENT_ADVICE_SECRET=long-random-secret
```

`DISCORD_RECRUITMENT_ADVICE_DASHBOARD_URL` можна задати окремо, якщо Gateway-бот має слати події не на `DASHBOARD_URL`.

## Discord Developer Portal

Для миттєвої реакції на повідомлення бот має підключатися до Discord Gateway з intents:

```text
Guilds
Guild Messages
Message Content
```

Message Content треба окремо ввімкнути в Discord Developer Portal для застосунку. Без цього Discord може присилати подію, але `message.content` буде порожнім, і система не зможе зрозуміти питання.

## Старий scan endpoint

```text
GET /api/discord/recruitment-advice
POST /api/discord/recruitment-advice
```

Залишений тільки для ручного `dryRun`, тестів або backfill по останніх повідомленнях. У `vercel.json` цей endpoint більше не стоїть у cron.

Preview без відправки:

```bash
curl -H "Authorization: Bearer $DISCORD_RECRUITMENT_ADVICE_SECRET" \
  "https://admin.lihvodruida.pp.ua/api/discord/recruitment-advice?dryRun=1&force=1&limit=2"
```

## Env

```text
DISCORD_RECRUITMENT_ADVICE_ENABLED=false
DISCORD_RECRUITMENT_ADVICE_SECRET=
DISCORD_RECRUITMENT_ADVICE_DASHBOARD_URL=
DISCORD_RECRUITMENT_ADVICE_MAX_CHANNELS=100
DISCORD_RECRUITMENT_ADVICE_LOOKBACK_HOURS=48
DISCORD_RECRUITMENT_ADVICE_MAX_PAGES=4
DISCORD_RECRUITMENT_ADVICE_MAX_REPLIES=4
DISCORD_RECRUITMENT_ADVICE_MIN_RIO=0
DISCORD_RECRUITMENT_ADVICE_MIN_ILVL=0
DISCORD_RECRUITMENT_ADVICE_DRY_RUN=false
```

`DISCORD_RECRUITMENT_ADVICE_MIN_RIO=0` означає адаптивний поріг за складом: система бере RIO-персонажів і рахує високорівневу групу відносно поточного roster. Якщо потрібно жорстко відсікати слабких персонажів — виставити, наприклад, `1800` або `2200`.

## Важливо

Бот не має відповідати на власні повідомлення, webhook-и та системні повідомлення. Це вже враховано в `shouldIgnoreMessage()` і в Gateway-скрипті.
