import "server-only";

export type DiscordRawEmbed = {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  fields?: Array<{ name?: string; value?: string; inline?: boolean }>;
  author?: { name?: string };
  footer?: { text?: string };
};

export type DiscordRawInteractionMessage = {
  id?: string;
  channel_id?: string;
  content?: string;
  timestamp?: string;
  embeds?: DiscordRawEmbed[];
};

export function asInteractionMessage(value: unknown): DiscordRawInteractionMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as DiscordRawInteractionMessage;
}

export function firstInteractionEmbed(value: unknown): DiscordRawEmbed | null {
  const message = asInteractionMessage(value);
  const embed = Array.isArray(message?.embeds) ? message?.embeds?.[0] : null;
  return embed && typeof embed === "object" ? embed : null;
}

export function interactionField(value: unknown, matcher: RegExp | string) {
  const embed = firstInteractionEmbed(value);
  const fields = Array.isArray(embed?.fields) ? embed.fields : [];
  for (const field of fields) {
    const name = String(field?.name || "").trim();
    const matched = typeof matcher === "string"
      ? name.toLowerCase().includes(matcher.toLowerCase())
      : matcher.test(name);
    if (matched) return String(field?.value || "").trim();
  }
  return "";
}

export function interactionMessageTimestamp(value: unknown) {
  const message = asInteractionMessage(value);
  const embed = firstInteractionEmbed(value);
  const raw = String(embed?.timestamp || message?.timestamp || "").trim();
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

export function firstDiscordTimestampSeconds(value: unknown) {
  const text = String(value || "");
  const match = text.match(/<t:(\d{9,12})(?::[tTdDfFR])?>/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function firstInteger(value: unknown) {
  const match = String(value || "").match(/-?\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export function fraction(value: unknown) {
  const match = String(value || "").match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  return { current: Number(match[1]), total: Number(match[2]) };
}

export function stripLeadingEmojiTitle(value: unknown) {
  return String(value || "")
    .replace(/^[\s\uFE0F\u200D\p{Extended_Pictographic}]+/u, "")
    .trim();
}

export function stripDifficultySuffix(value: unknown) {
  const text = stripLeadingEmojiTitle(value);
  return text.replace(/\s+[—-]\s+(Нормал|Героїк|Міфік)\s*(?:•\s*Закрито)?$/iu, "").trim();
}

export function inferDifficultyFromTitle(value: unknown): "normal" | "heroic" | "mythic" {
  const text = String(value || "").toLowerCase();
  if (text.includes("міфік") || text.includes("mythic")) return "mythic";
  if (text.includes("нормал") || text.includes("normal")) return "normal";
  return "heroic";
}

export function kyivDateTimeFromEpochSeconds(seconds: number | null) {
  if (!seconds) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = get("hour");
  const minute = get("minute");
  if (hour === "24") hour = "00";
  return year && month && day && hour && minute
    ? { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` }
    : null;
}

export function isExplicitlyZero(value: unknown) {
  const n = firstInteger(value);
  return n === 0;
}

/** Flatten the public Discord message into searchable text. Older messages do
 * not always preserve exactly the same field names, so orphan recovery should
 * rely on visible evidence, not on one historical embed layout. */
export function interactionMessageText(value: unknown) {
  const message = asInteractionMessage(value);
  const embed = firstInteractionEmbed(value);
  const parts: string[] = [
    String(message?.content || ""),
    String(embed?.title || ""),
    String(embed?.description || ""),
    String(embed?.footer?.text || ""),
  ];
  for (const field of Array.isArray(embed?.fields) ? embed.fields : []) {
    parts.push(String(field?.name || ""), String(field?.value || ""));
  }
  return parts.join("\n").replace(/\s+/g, " ").trim();
}

export function interactionShowsEmptyRaid(value: unknown) {
  const text = interactionMessageText(value);
  if (!text) return false;
  return /склад\s+рейду.{0,90}\b0\s*\/\s*(?:0|\d+)/iu.test(text)
    || /0\s*танк(?:и|ів)?.{0,30}0\s*хіл(?:и|ів)?.{0,30}0\s*дд/iu.test(text);
}

export function interactionShowsEmptyPoll(value: unknown) {
  const text = interactionMessageText(value);
  if (!text) return false;
  return /проголосували.{0,40}(?:^|\s)0(?:\s|$)/iu.test(text)
    || /голоси\s+за\s+днями.{0,180}(?:пн|пон).{0,20}[—-]\s*0/iu.test(text);
}

export function interactionShowsEmptyRoster(value: unknown) {
  const text = interactionMessageText(value);
  if (!text) return false;
  return /склад\s*\(\s*0\s*\/\s*\d+\s*\)/iu.test(text)
    || /ще\s+ніхто\s+не\s+обрав/iu.test(text);
}
