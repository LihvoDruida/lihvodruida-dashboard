# Інструкція розгортання

Це production-oriented інструкція для Cloudflare Worker `guild-applications-worker`.

## 1. Підготовка

Потрібно мати:

- Cloudflare account;
- встановлений Wrangler;
- GitHub token з доступом до repo Issues;
- Discord Developer Application + Bot;
- Discord server ID, bot token, application public key;
- admin dashboard URL;
- shared server-to-server tokens для dashboard інтеграції.

Встановлення Wrangler:

```bash
npm install -g wrangler
wrangler login
```

Перейти в папку Worker:

```bash
cd workers/guild-applications-worker
```

## 2. GitHub token

Token має мати доступ до Issues у repo `GITHUB_OWNER/GITHUB_REPO`.

Для fine-grained token зазвичай потрібні права:

- Repository access: потрібний repo;
- Issues: Read and write;
- Metadata: Read.

Додати secret:

```bash
wrangler secret put GITHUB_TOKEN
```

## 3. Discord application і bot

У Discord Developer Portal:

1. Створи Application або відкрий існуючий bot.
2. Скопіюй `Public Key` → `DISCORD_PUBLIC_KEY`.
3. Увімкни Bot і скопіюй token → `DISCORD_BOT_TOKEN`.
4. У Interactions Endpoint URL вкажи:

```text
https://<worker-domain>/api/discord-interactions
```

5. Запроси bot на сервер з permissions:
   - Send Messages;
   - Embed Links;
   - Read Message History;
   - Manage Roles;
   - Kick Members.

Для видачі ролей роль bot-а має бути вище ролей, які він видає.

Secrets:

```bash
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_GUILD_ID
wrangler secret put DISCORD_CHANNEL_ID
```

`DISCORD_CHANNEL_ID` потрібен для повідомлень про нові заявки. Якщо його не задати, заявки створюватимуться в GitHub, але Discord notification буде пропущено.

## 4. Cloudflare KV для правил

Створити KV namespace:

```bash
wrangler kv namespace create RULES_STATS
```

У відповідь Wrangler дасть id. Додай його в `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RULES_STATS"
id = "paste_kv_namespace_id_here"
```

Цей binding потрібен для:

- статистики прийняття/відмови правил;
- списку підписантів правил рейду.

Без KV Worker не впаде, але stats/signups будуть повертати `configured: false`.

## 5. Налаштувати vars у `wrangler.toml`

Приклад production vars:

```toml
[vars]
GITHUB_OWNER = "LihvoDruida"
GITHUB_REPO = "lihvodruida.github.io"
GUILD_APPLICATIONS_LABEL = "guild-application"
ALLOWED_ORIGINS = "https://lihvodruida.pp.ua,https://www.lihvodruida.pp.ua,https://admin.lihvodruida.pp.ua"
DISCORD_ALLOWED_ROLES = ""
ADMIN_DASHBOARD_URL = "https://admin.lihvodruida.pp.ua"
DASHBOARD_PROFILE_LOOKUP_ENDPOINT = "https://admin.lihvodruida.pp.ua/api/profile/discord-lookup"
RAID_RULES_URL = "https://discord.com/channels/<guild>/<channel>/<message>"
ALLOW_DEBUG_QUERY = "0"
```

Для локального dev можна використати `.dev.vars` на основі `.dev.vars.example`.

## 6. Shared tokens із dashboard

Згенеруй сильні random values для:

- `INTERNAL_PROFILE_LOOKUP_TOKEN`;
- `DISCORD_RULES_STATS_TOKEN`.

Додай їх у Worker:

```bash
wrangler secret put INTERNAL_PROFILE_LOOKUP_TOKEN
wrangler secret put DISCORD_RULES_STATS_TOKEN
```

Такі самі значення додай у dashboard environment.

Dashboard має використовувати `DISCORD_RULES_STATS_TOKEN`, коли читає:

```text
/api/discord-rules-stats
/api/discord-raid-rules-stats
/api/discord-raid-rules-signups
/api/discord-raid-message
/api/discord-guild-channels
```

## 7. Cloudflare Access для dashboard

Якщо `admin.lihvodruida.pp.ua` захищений Cloudflare Access:

1. Створи Cloudflare Access Service Token.
2. Додай policy, яка дозволяє цьому Service Token доступ до:

```text
https://admin.lihvodruida.pp.ua/api/profile/discord-lookup
https://admin.lihvodruida.pp.ua/api/raids/*/discord-action
```

3. Додай secrets у Worker:

```bash
wrangler secret put CF_ACCESS_CLIENT_ID
wrangler secret put CF_ACCESS_CLIENT_SECRET
```

`INTERNAL_PROFILE_LOOKUP_TOKEN` все одно потрібен. Cloudflare Access пропускає запит до dashboard, а dashboard token захищає сам API route.

## 8. Deploy

```bash
wrangler deploy
```

Після deploy перевір:

```bash
curl https://<worker-domain>/api/guild-applications
```

Якщо GitHub vars/secrets не налаштовані, очікувано буде error про недоступність заявок.

## 9. Перевірка stats endpoint

Якщо `DISCORD_RULES_STATS_TOKEN` заданий:

```bash
curl \
  -H "Authorization: Bearer <token>" \
  "https://<worker-domain>/api/discord-rules-stats?guild_id=<guildId>"
```

Очікувана відповідь навіть без кліків:

```json
{
  "configured": true,
  "guild_id": "<guildId>",
  "rules_type": "guild",
  "namespace": "rules",
  "accepted": 0,
  "declined": 0,
  "total": 0,
  "source": "kv"
}
```

## 10. Перевірка Discord interactions

У Discord Developer Portal натисни save для Interaction Endpoint URL. Discord робить ping. Якщо Worker правильно перевіряє signature, URL буде прийнятий.

Якщо Discord не приймає endpoint:

- перевір `DISCORD_PUBLIC_KEY`;
- перевір, що route саме `/api/discord-interactions`;
- перевір, що Worker deployed;
- подивись Cloudflare Worker logs.

## 11. Перевірка application create

Тестовий request:

```bash
curl -X POST "https://<worker-domain>/api/guild-applications" \
  -H "Content-Type: application/json" \
  -H "Origin: https://lihvodruida.pp.ua" \
  --data '{
    "region":"eu",
    "characterName":"Khayen",
    "faction":"Alliance",
    "realm":"Terokkar",
    "className":"Druid",
    "discord":"Dmytro",
    "battleTag":"",
    "sourceCreator":"Discord",
    "sourcePlatform":"Discord",
    "availability":"Вечорами після 20:00",
    "website":""
  }'
```

Очікування:

- GitHub Issue створено;
- Issue має labels `guild-application`, `status:review`;
- Discord notification створено, якщо `DISCORD_CHANNEL_ID` і bot token правильні;
- response має `ok: true`.

## 12. Production hardening checklist

- `ALLOW_DEBUG_QUERY=0`.
- `DEBUG_RESPONSES` не заданий або `0`.
- `ALLOWED_ORIGINS` містить тільки потрібні origins.
- `DISCORD_RULES_STATS_TOKEN` заданий і збігається з dashboard.
- `INTERNAL_PROFILE_LOOKUP_TOKEN` заданий і збігається з dashboard.
- Bot role вище ролей, які він видає.
- `RULES_STATS` KV binding активний.
- Cloudflare Access Service Token налаштований, якщо dashboard protected.
- Discord Interaction Endpoint URL pointing to deployed Worker.

## 13. Rollback

Cloudflare Workers зберігає deployments. У разі проблем:

```bash
wrangler deployments list
wrangler rollback
```

Перед rollback переконайся, що проблема не в secrets/vars, бо rollback коду не виправить неправильний env.
