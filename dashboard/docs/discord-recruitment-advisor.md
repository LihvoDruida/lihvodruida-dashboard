# Discord Recruitment Advisor

Система автоматично відповідає на Discord-повідомлення поверненців/новачків, які питають, за який клас почати грати і що потрібно гільдії.

## Поточна архітектура

```text
Discord MESSAGE_CREATE
        ↓
Cloudflare Worker Durable Object
        ↓
POST /api/discord/recruitment-advice/message
        ↓
аналіз guildRoster + Raider.IO + utility/бафи
        ↓
відповідь у той самий Discord channel_id/thread_id
```

Vercel cron більше не використовується для цієї функції. На Vercel Hobby погодинний cron недоступний, тому слухач повідомлень перенесено у Cloudflare Worker.

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

`DISCORD_RECRUITMENT_ADVICE_SECRET` має збігатися з Cloudflare Worker secret.

## Env на Cloudflare Worker

У `workers/guild-applications-worker`:

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_GUILD_ID
wrangler secret put DISCORD_RECRUITMENT_ADVICE_SECRET
```

У `wrangler.toml` додано Durable Object:

```toml
[[durable_objects.bindings]]
name = "DISCORD_RECRUITMENT_GATEWAY"
class_name = "DiscordRecruitmentGateway"

[[migrations]]
tag = "v1-discord-recruitment-gateway"
new_sqlite_classes = ["DiscordRecruitmentGateway"]
```

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
curl -H "Authorization: Bearer $WORKER_STATS_TOKEN" \
  "https://guild-applications-worker.<account>.workers.dev/api/discord-recruitment-gateway?action=status"
```

Ручний старт:

```bash
curl -X POST -H "Authorization: Bearer $WORKER_STATS_TOKEN" \
  "https://guild-applications-worker.<account>.workers.dev/api/discord-recruitment-gateway?action=start"
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
