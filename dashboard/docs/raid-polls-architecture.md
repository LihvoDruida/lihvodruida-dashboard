# Raid Polls Architecture

## Рішення

Створення рейд-пулу виконується тільки через сайт. Slash command `/create-raid-poll` не використовується.

Потік даних:

1. Офіцер відкриває `/discord` або `/polls/new`. Основна форма створення інтегрована в Discord Hub як блок `Створення рейд-голосування`.
2. Сайт створює документ у Firestore `dashboardRaidPolls`.
3. Сайт публікує Discord embed через наявний Discord Admin/Worker relay.
4. Учасники голосують у Discord через приватний (ephemeral) пульт. Публічне повідомлення має єдину кнопку `mbv1:poll_vote_prompt:{pollId}`, яка відкриває пульт із рядками:
   - `mbv1:poll_role:{pollId}` — роль у рейді: танк / хіл / дд.
   - `mbv1:poll_quick:{pollId}` — швидке заповнення всіх днів одним значенням.
   - `mbv1:poll_schedule_{day}:{pollId}` — один варіант часу або «Не можу» для конкретного дня.
   - `mbv1:poll_schedule_page_{n}:{pollId}` — перемикання сторінки днів (кільцеве).
   - `mbv1:poll_submit:{pollId}` — зарахування голосу.

   Легасі `mbv1:poll_character_prompt:` і `mbv1:poll_character:` досі приймаються і трактуються як «відкрий пульт»: у Discord лишаються опубліковані embed-и зі старими `custom_id`.
5. Cloudflare Worker приймає Discord interaction і прокидає його в dashboard API.
6. Dashboard API записує голос у Firestore транзакцією та оновлює Discord-повідомлення.
7. Після дедлайну `/api/polls/close-due` або будь-яке читання/клік закриває прострочений пул і вимикає components.

## Firestore schema

Колекція: `dashboardRaidPolls`

```ts
{
  id: string;
  title: string;
  difficulty: "normal" | "heroic" | "mythic";
  description: string;
  status: "open" | "closed";
  closeAfterMinutes: number;
  closesAt: string;
  closesAtMs: number;
  closedAt?: string | null;
  closedReason?: "manual" | "auto" | null;
  createdByDiscordId: string;
  createdByName: string;
  channelId?: string | null;
  messageId?: string | null;
  messageUrl?: string | null;
  votesByDiscordId: {
    [discordId: string]: {
      discordId: string;
      discordName: string;
      guildId: string;
      guildName: string;
      /** Роль у рейді, вибрана вручну. Персонажа Battle.net голос не містить. */
      role: "tank" | "healer" | "dps" | null;
      /** Один найраніший доступний час на день або явна відсутність. */
      schedule: Partial<Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", "20:00" | "20:30" | "21:00" | "absent">>;
      /** Legacy-дзеркала розкладу для старих документів. */
      selectedDays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
      selectedTime: "20:00" | "20:30" | "21:00" | null;
      createdAt: string;
      updatedAt: string;
    }
  };
  createdAt: string;
  createdAtMs: number;
  updatedAt: string;
  updatedAtMs: number;
}
```

## API

### `POST /api/polls`

Site-only endpoint. Creates Firestore document and publishes Discord message. Supports both legacy `FormData` submits from `/polls/new` and JSON submits from `/discord`.

Fields/body:

- `title`
- `difficulty`
- `description`
- `closeAfterMinutes`
- `channelId`

JSON response mode is selected by `Accept: application/json` or `Content-Type: application/json` and returns `{ ok, pollId, redirectTo, poll }`.

### `GET /api/polls`

Returns poll list for authorized dashboard users.

### `GET /api/polls/[pollId]`

Returns one poll with normalized votes.

### `POST /api/polls/[pollId]/vote`

Internal endpoint for Cloudflare Worker only. Requires internal bearer token.

Body:

```json
{
  "kind": "schedule",
  "values": ["mon:20:00", "wed:absent"],
  "userId": "123456789012345678",
  "userName": "Sebas",
  "guildId": "123456789012345678",
  "guildName": "Mistblossom Vanguard",
  "channelId": "123456789012345678",
  "messageId": "123456789012345678"
}
```

### `POST /api/polls/[pollId]/close`

Manual close by raid manager.

### `POST /api/polls/close-due`

Internal endpoint for cron/worker. Closes overdue polls and updates Discord messages.

## Discord API limitation

Public message components are global for the message. They cannot render different selected/default values for each viewer. Because of that the public message stays generic, while each user receives their personal saved state only in the ephemeral interaction response.


## Ідентичність голосу

Пул свідомо не питає персонажа Battle.net. Голос відповідає на два питання —
**коли** і **в якій ролі**, а підпис бере з гільдійного ніку Discord
(`interaction.member.nick`), рівно як запис на рейд. Наслідки:

- голосувати може будь-хто, хто бачить повідомлення в Discord гільдії;
- немає залежності від привʼязки Battle.net, guild roster і Raider.IO;
- рекомендації слотів рахують тільки ядро ролей — класи, спеки, melee/ranged
  і utility-checklist для пулів не застосовуються;
- очищення голосів за складом гільдії WoW прибране. Актуальність підтримує
  `removeRaidPollVotesForAccounts`, яку викликає очищення акаунтів за фактом
  виходу людини з Discord. Закриті пули при цьому не змінюються — це історія.

## Час рейду

Доступні слоти: `20:00`, `20:30`, `21:00`. Раніші години прибрані — гільдія
не починає рейд до 20:00. Уже збережені голоси з `18:00`–`19:30` мапляться на
`20:00`, а `21:30`/`22:00` — на `21:00` (`RAID_POLL_LEGACY_TIMES` у
`src/lib/raidPollShared.ts`), тому архів голосувань лишається валідним.

`RAID_POLL_REPEAT_TIMES` (08:00–23:00) — це окреме поняття: година, коли cron
**перестворює** пул, а не час рейду. Її діапазон не змінювався.
