# Raid Polls Architecture

## Рішення

Створення рейд-пулу виконується тільки через сайт. Slash command `/create-raid-poll` не використовується.

Потік даних:

1. Офіцер відкриває `/discord` або `/polls/new`. Основна форма створення інтегрована в Discord Hub як блок `Створення рейд-голосування`.
2. Сайт створює документ у Firestore `dashboardRaidPolls`.
3. Сайт публікує Discord embed через наявний Discord Admin/Worker relay.
4. Учасники голосують у Discord через select-menu:
   - `mbv1:poll_days:{pollId}` — multi-select днів.
   - `mbv1:poll_time:{pollId}` — dropdown часу.
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
      selectedDays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
      selectedTime: "19:00" | "19:30" | "20:00" | "20:30" | "21:00" | null;
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
  "kind": "days",
  "values": ["mon", "wed"],
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

