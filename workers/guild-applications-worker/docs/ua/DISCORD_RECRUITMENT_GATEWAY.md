# Discord Recruitment Gateway Advisor

Ця інтеграція переносить автоматичну відповідь на повідомлення Discord у Cloudflare Worker. Vercel більше не тримає cron або WebSocket. Worker через Durable Object підключається до Discord Gateway, слухає `MESSAGE_CREATE` і передає повідомлення в dashboard endpoint:

```text
POST https://dashboard.lihvodruida.pp.ua/api/discord/recruitment-advice/message
```

Dashboard залишається місцем, де аналізується склад гільдії, Raider.IO, дефіцит класів/спеків і формується відповідь. Worker тільки слухає Discord і надійно доставляє подію.

## Схема

```text
Discord MESSAGE_CREATE
        ↓
Cloudflare Durable Object DiscordRecruitmentGateway
        ↓
POST /api/discord/recruitment-advice/message на dashboard
        ↓
аналіз складу / RIO / utility / дефіцитів
        ↓
відповідь у той самий Discord channel_id або thread_id
```

## Що потрібно ввімкнути в Discord Developer Portal

У Bot settings потрібно ввімкнути intents:

```text
Server Members Intent — не обовʼязково для цієї функції
Message Content Intent — обовʼязково
```

Gateway intents, які Worker відправляє за замовчуванням:

```text
GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT = 33281
```

## Cloudflare secrets

У `workers/guild-applications-worker` додай production secrets:

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_GUILD_ID
wrangler secret put DISCORD_RECRUITMENT_ADVICE_SECRET
```

`DISCORD_RECRUITMENT_ADVICE_SECRET` має бути таким самим, як у dashboard на Vercel.

Якщо dashboard закритий Cloudflare Access, також додай:

```bash
wrangler secret put CF_ACCESS_CLIENT_ID
wrangler secret put CF_ACCESS_CLIENT_SECRET
```

## Vercel/dashboard env

На dashboard потрібні:

```env
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_RECRUITMENT_ADVICE_ENABLED=true
DISCORD_RECRUITMENT_ADVICE_SECRET=той_самий_секрет_що_у_Worker
```

## Запуск

Після деплою Worker сам підніме Gateway через існуючий Cloudflare cron `*/10 * * * *`. Це не Vercel cron, тому обмеження Hobby плану Vercel тут не заважає.

Ручна перевірка статусу:

```bash
curl -H "Authorization: Bearer $WORKER_STATS_TOKEN" \
  "https://guild-applications-worker.<account>.workers.dev/api/discord-recruitment-gateway?action=status"
```

Ручний старт або реконект:

```bash
curl -X POST -H "Authorization: Bearer $WORKER_STATS_TOKEN" \
  "https://guild-applications-worker.<account>.workers.dev/api/discord-recruitment-gateway?action=start"

curl -X POST -H "Authorization: Bearer $WORKER_STATS_TOKEN" \
  "https://guild-applications-worker.<account>.workers.dev/api/discord-recruitment-gateway?action=reconnect"
```

## Захист від дублів

Дублі контролює dashboard через Firebase collection `discordRecruitmentAdviceReplies`. Worker більше не блокує message id до відповіді dashboard, тому помилки або skip можна повторити вручну з панелі. Якщо повідомлення вже має `status=replied` або `replyMessageId`, відповідь не відправиться повторно.

## Важливо

- Worker відповідає не сам. Він тільки передає подію в dashboard.
- Відповідь відправляється через dashboard-логіку в той самий канал або тред, бо в payload лишається оригінальний `channel_id`.
- Якщо Discord не дає `content`, значить не ввімкнений `Message Content Intent` або бот не має доступу до каналу.
- Якщо Worker не може достукатися до dashboard через Cloudflare Access, потрібні `CF_ACCESS_CLIENT_ID` і `CF_ACCESS_CLIENT_SECRET`.


## Ручний backfill через панель

Discord Gateway надсилає тільки нові `MESSAGE_CREATE` події. Старі повідомлення більше не перевіряються автоматично після старту Worker, щоб не було неочікуваних відповідей. Для перевірки старих повідомлень відкрий:

```text
/dashboard/discord/recruitment
```

Там є дії:

- `Тест без відправки` — dry-run сканування старих повідомлень;
- `Перевірити і відповісти` — ручна перевірка за заданий період;
- `Worker backfill` — ручний виклик Cloudflare Worker `action=backfill`;
- `start/reconnect/stop/status` для Durable Object Gateway.

Повторних відповідей не буде: dashboard зберігає успішні відповіді у `discordRecruitmentAdviceReplies` за Discord `message.id`. Якщо відповідь уже має статус `replied` або `replyMessageId`, навіть ручна перевірка не дублює її.
