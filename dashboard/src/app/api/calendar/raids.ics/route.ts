import { NextResponse } from "next/server";
import { dashboardBaseUrl } from "@/lib/seo";
import {
  listRaids,
  raidActiveRosterSize,
  raidDifficultyLabel,
  raidTitle,
  type RaidItem,
} from "@/lib/raids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RAID_TIME_ZONE = process.env.RAID_TIME_ZONE || process.env.NEXT_PUBLIC_RAID_TIME_ZONE || "Europe/Kyiv";
const DEFAULT_DURATION_MINUTES = 180;

function calendarDurationMinutes() {
  const value = Number(process.env.RAID_CALENDAR_EVENT_DURATION_MINUTES || DEFAULT_DURATION_MINUTES);
  return Number.isFinite(value) ? Math.max(30, Math.min(Math.floor(value), 12 * 60)) : DEFAULT_DURATION_MINUTES;
}

function escapeIcsText(value: unknown) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcsLine(line: string) {
  const limit = 74;
  if (line.length <= limit) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > limit) {
    chunks.push(rest.slice(0, limit));
    rest = ` ${rest.slice(limit)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

function localIcsDateTime(date: string, time: string) {
  const cleanDate = String(date || "").replace(/-/g, "");
  const [hour = "20", minute = "00"] = String(time || "20:00").split(":");
  return `${cleanDate}T${hour.padStart(2, "0")}${minute.padStart(2, "0")}00`;
}

function addMinutesToLocal(date: string, time: string, minutesToAdd: number) {
  const [year, month, day] = String(date || "").split("-").map(Number);
  const [hour = 20, minute = 0] = String(time || "20:00").split(":").map(Number);
  const local = new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1, Number.isFinite(hour) ? hour : 20, Number.isFinite(minute) ? minute : 0));
  local.setUTCMinutes(local.getUTCMinutes() + minutesToAdd);
  return `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, "0")}${String(local.getUTCDate()).padStart(2, "0")}T${String(local.getUTCHours()).padStart(2, "0")}${String(local.getUTCMinutes()).padStart(2, "0")}00`;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function raidUrl(raid: RaidItem) {
  return `${dashboardBaseUrl()}/raids/${encodeURIComponent(raid.id)}`;
}

function eventLines(raid: RaidItem) {
  const duration = calendarDurationMinutes();
  const url = raidUrl(raid);
  const summary = raidTitle(raid);
  const description = [
    raid.description,
    `Складність: ${raidDifficultyLabel(raid.difficulty)}`,
    `Записано: ${raidActiveRosterSize(raid)} гравців`,
    raid.status === "closed" ? "Статус: рейд закрито" : "Статус: рейд опубліковано",
    url,
  ].filter(Boolean).join("\n");

  return [
    "BEGIN:VEVENT",
    `UID:raid-${escapeIcsText(raid.id)}@mistblossom-vanguard`,
    `DTSTAMP:${timestamp()}`,
    `DTSTART;TZID=${RAID_TIME_ZONE}:${localIcsDateTime(raid.date, raid.time)}`,
    `DTEND;TZID=${RAID_TIME_ZONE}:${addMinutesToLocal(raid.date, raid.time, duration)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `URL:${escapeIcsText(url)}`,
    "CATEGORIES:World of Warcraft,Raid,Mistblossom Vanguard",
    "STATUS:CONFIRMED",
    "END:VEVENT",
  ];
}

export async function GET() {
  const raids = await listRaids(200).catch(() => []);
  const events = raids
    .filter((raid) => raid.status !== "draft" && raid.date)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mistblossom Vanguard//Raid Calendar//UK",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Mistblossom Vanguard — рейди",
    "X-WR-CALDESC:Опубліковані рейди гільдії Mistblossom Vanguard",
    `X-WR-TIMEZONE:${RAID_TIME_ZONE}`,
    ...events.flatMap(eventLines),
    "END:VCALENDAR",
  ].map(foldIcsLine).join("\r\n");

  return new NextResponse(`${lines}\r\n`, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mistblossom-raids.ics"',
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
