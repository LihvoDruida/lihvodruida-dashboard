# Discord Recruitment Advisor

Автоматична система відповіді на повідомлення поверненців/новачків, які питають, за який клас почати грати і що потрібно гільдії.

## Що робить

- Сам знаходить доступні текстові Discord-канали й активні треди, сканує їх за останні `DISCORD_RECRUITMENT_ADVICE_LOOKBACK_HOURS` годин, за замовчуванням 48.
- Визначає повідомлення з наміром: повернення у WoW, питання про вибір класу, згадка гільдії/рейдів/RIO/дефіциту.
- Бере останній нормалізований склад гільдії з `guildRosterRecords`, не запускаючи важкі live-запити до Raider.IO під кожне повідомлення.
- Аналізує високорівневих персонажів із RIO, дефіцит класів, корисні raid/M+ бафи й ролі.
- Формує розгорнуту українську відповідь з рекомендаціями, альтернативами і чітким автоматичним footer.
- Захищає від повторних відповідей через Firestore-колекцію `discordRecruitmentAdviceReplies`; без Firebase використовує runtime-захист на час життя процесу.

## Endpoint

```text
GET /api/discord/recruitment-advice
POST /api/discord/recruitment-advice
```

Потрібен Bearer token з одного з env:

```text
DISCORD_RECRUITMENT_ADVICE_SECRET
CRON_SECRET
INTERNAL_API_TOKEN
WORKER_STATS_TOKEN
```

## Preview без відправки

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://admin.lihvodruida.pp.ua/api/discord/recruitment-advice?dryRun=1&force=1&limit=2"
```

## Env

```text
DISCORD_RECRUITMENT_ADVICE_ENABLED=false
DISCORD_RECRUITMENT_ADVICE_MAX_CHANNELS=100
DISCORD_RECRUITMENT_ADVICE_SECRET=
DISCORD_RECRUITMENT_ADVICE_LOOKBACK_HOURS=48
DISCORD_RECRUITMENT_ADVICE_MAX_PAGES=4
DISCORD_RECRUITMENT_ADVICE_MAX_REPLIES=4
DISCORD_RECRUITMENT_ADVICE_MIN_RIO=0
DISCORD_RECRUITMENT_ADVICE_MIN_ILVL=0
DISCORD_RECRUITMENT_ADVICE_DRY_RUN=false
```


Канали вручну не задаються. Система бере список доступних текстових каналів Discord-сервера через `DISCORD_GUILD_ID` + `DISCORD_BOT_TOKEN`, пробує також активні треди, і відповідає саме в `channel_id` знайденого повідомлення. Якщо в якомусь каналі бот не має права читати історію або писати — цей канал буде пропущений з помилкою в результаті запуску.

`DISCORD_RECRUITMENT_ADVICE_MAX_CHANNELS=100` — захисний ліміт, щоб cron не обходив сотні каналів за один запуск. Це не список каналів, а лише верхня межа.

`DISCORD_RECRUITMENT_ADVICE_MIN_RIO=0` означає адаптивний поріг за складом: система бере RIO-персонажів і рахує високорівневу групу відносно поточного roster. Якщо потрібно жорстко відсікати слабких персонажів — виставити, наприклад, `1800` або `2200`.

## Cron

У `vercel.json` додано погодинний cron:

```json
{ "path": "/api/discord/recruitment-advice", "schedule": "0 * * * *" }
```

Перший запуск після увімкнення перевірить останні 2 дні в усіх доступних текстових каналах/активних тредах. Далі система не дублює відповідь на вже оброблені повідомлення.

## Важливо

Боту потрібен доступ Discord API до історії каналу й message content. Якщо Discord повертає порожній `content`, відповідь не буде згенерована — треба перевірити права бота/intent у Discord Developer Portal і права на конкретний канал.
