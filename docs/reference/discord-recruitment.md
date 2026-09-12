# Discord Recruitment Advisor

Система автоматично відповідає на Discord-повідомлення поверненців/новачків, які питають, за який клас почати грати і що потрібно гільдії.

## Поточна архітектура

```text
Discord MESSAGE_CREATE
        ↓
Сервіс бота (постійне зʼєднання з Discord Gateway)
        ↓
POST /api/discord/recruitment-advice/message
        ↓
аналіз guildRoster + Raider.IO + utility/бафи
        ↓
відповідь у той самий Discord channel_id/thread_id
```

Планувальник панелі для цієї функції не використовується: слухач повідомлень живе у сервісі бота, який тримає постійне зʼєднання з Discord Gateway. Кронові тіки для цього не підходять — зʼєднання має бути живим, а не прокидатись раз на хвилину.

## Dashboard endpoint

```text
POST /api/discord/recruitment-advice/message
```

Endpoint приймає payload Discord Gateway `MESSAGE_CREATE`, перевіряє внутрішній bearer token і передає повідомлення в `handleDiscordRecruitmentAdviceMessage`.

## Env на dashboard

```env
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_RECRUITMENT_ADVICE_ENABLED=true
DISCORD_RECRUITMENT_ADVICE_SECRET=long-random-secret
```

`DISCORD_RECRUITMENT_ADVICE_SECRET` має збігатися зі значенням у боті.

## Env сервісу бота

Змінні задаються у `bot/.env.production` (шаблон — `bot/.env.example`):

```bash
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_RECRUITMENT_ADVICE_SECRET=...
```

Постійне зʼєднання до Discord Gateway тримає сам процес бота. Раніше цю роль
виконував Durable Object у Cloudflare; тепер зовнішній стан не потрібен —
контейнер живе постійно, а стан gateway тримається в памʼяті процесу.

## Поведінка відповіді

Система:

- ігнорує ботів, webhook-и й системні повідомлення;
- не дублює відповідь на той самий Discord message id;
- аналізує текст повідомлення за наміром, а не тільки за одним словом;
- бере актуальний склад гільдії з `guildRoster`;
- дивиться високорівневих персонажів з Raider.IO;
- оцінює дефіцит ролей, класів, рейдових бафів і utility;
- формує відповідь з рекомендаціями;
- в кінці додає `_Повідомлення є автоматичним._`.

## Ручна перевірка

Статус Gateway:

```bash
curl -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  "http://bot:8080/discord/recruitment-gateway?action=status"
```

Ручний старт:

```bash
curl -X POST -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  "http://bot:8080/discord/recruitment-gateway?action=start"
```

Тест dashboard endpoint без реального Discord Gateway:

```bash
curl -X POST "https://admin.lihvodruida.pp.ua/api/discord/recruitment-advice/message?dryRun=1&force=1" \
  -H "Authorization: Bearer $DISCORD_RECRUITMENT_ADVICE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "id": "1449767281453301865",
      "channel_id": "1498719949550784540",
      "content": "Доброго вечора! Повертаюсь у WoW після BFA. Раніше грав Локом та Хантом. За який клас краще почати?",
      "timestamp": "2026-07-06T20:00:00.000Z",
      "author": { "id": "1449811152168437772", "username": "test-user", "bot": false },
      "type": 0
    }
  }'
```


## Ручний backfill через панель

Discord Gateway надсилає тільки нові `MESSAGE_CREATE` події. Старі повідомлення більше не перевіряються автоматично після старту bot Gateway, щоб не було неочікуваних відповідей. Для перевірки старих повідомлень відкрий:

```text
/dashboard/discord/recruitment
```

Там є дії:

- `Тест без відправки` — dry-run сканування старих повідомлень;
- `Перевірити і відповісти` — ручна перевірка за заданий період;
- `Тест bot → dashboard` — dry-run через control API бота;
- `Bot manual-scan` — ручний backfill через bot → dashboard;
- `start/reconnect/stop/status` — керування Gateway у bot-контейнері.

Повторних відповідей не буде: dashboard зберігає успішні відповіді у `discordRecruitmentAdviceReplies` за Discord `message.id`. Якщо відповідь уже має статус `replied` або `replyMessageId`, навіть ручна перевірка не дублює її.
