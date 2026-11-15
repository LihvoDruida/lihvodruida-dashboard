import "server-only";
import { type RaidPollCardModel } from "@/components/RaidPollBrowser";

import { RAID_POLL_DAYS, RAID_POLL_TIMES, pollVoteCounts, raidPollDifficultyLabel, raidPollSlotSummary, raidPollUniqueDayRecommendations, raidPollStatusLabel, raidPollRemainingLabel, raidPollStateKey, raidPollRepeatScheduleLabel, type RaidPollItem } from "@/lib/raidPolls";

export function formatDateTime(isoOrMs: string | number | null | undefined) {
  if (!isoOrMs) return "—";
  const date = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: process.env.RAID_TIME_ZONE || process.env.NEXT_PUBLIC_RAID_TIME_ZONE || "Europe/Kyiv",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function shortPollId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function pollCloseLabel(poll: RaidPollItem) {
  if (poll.status === "scheduled") return formatDateTime(poll.scheduledPublishAtMs || poll.scheduledPublishAt);
  if (poll.status === "closed") return poll.closedAt ? formatDateTime(poll.closedAt) : "Завершено";
  return formatDateTime(poll.closesAtMs);
}

export function bestDaySummary(poll: RaidPollItem, relatedPolls: RaidPollItem[] = [poll]) {
  const recommendations = raidPollUniqueDayRecommendations(poll, relatedPolls, 3);
  if (!recommendations.length) return raidPollSlotSummary(null);
  return recommendations.map((slot, index) => `${index + 1}) ${index === 2 ? "Дод.: " : ""}${raidPollSlotSummary(slot)}`).join(" / ");
}

export function roleBreakdown(poll: RaidPollItem) {
  let tanks = 0;
  let healers = 0;
  let dps = 0;
  for (const vote of poll.votes) {
    if (vote.role === "tank") tanks += 1;
    else if (vote.role === "healer") healers += 1;
    else if (vote.role === "dps") dps += 1;
  }
  return { tanks, healers, dps };
}

/**
 * Серверна проєкція пулу в легку модель для клієнтського списку.
 * Важкі розрахунки (рекомендації, ролі) лишаються на сервері — у браузер
 * їде тільки готовий текст, а не весь масив голосів.
 */
export function buildRaidPollCardModel(poll: RaidPollItem, relatedPolls: RaidPollItem[] = [poll]): RaidPollCardModel {
  const counts = pollVoteCounts(poll);
  const roles = roleBreakdown(poll);
  const state = raidPollStateKey(poll);

  return {
    id: poll.id,
    shortId: shortPollId(poll.id),
    title: poll.title,
    description: poll.description,
    difficulty: poll.difficulty,
    difficultyLabel: raidPollDifficultyLabel(poll.difficulty),
    state,
    statusLabel: raidPollStatusLabel(poll),
    dayLabels: pollDays(poll).map((day) => day.label),
    votes: counts.total,
    tanks: roles.tanks,
    healers: roles.healers,
    dps: roles.dps,
    deadlineCaption: state === "scheduled" ? "Публікація" : state === "closed" ? "Завершено" : state === "paused" ? "Заморожено" : "До закриття",
    deadlineLabel: pollCloseLabel(poll),
    remainingLabel: state === "closed" ? "—" : raidPollRemainingLabel(poll),
    recommendation: state === "scheduled" ? "Зʼявиться після початку голосування" : bestDaySummary(poll, relatedPolls),
    repeatLabel: raidPollRepeatScheduleLabel(poll),
    autoRepeat: Boolean(poll.autoRepeatWeekly),
    pausedNote: poll.pausedNote || null,
    messageUrl: poll.messageUrl || null,
  };
}

export function pollDays(poll: RaidPollItem) {
  const active = poll.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value);
  return RAID_POLL_DAYS.filter((day) => active.includes(day.value));
}

/**
 * Приймає вже пораховані counts. Раніше функція викликала pollVoteCounts()
 * усередині й запускалась для кожного з 7 днів — сім повних перерахунків
 * матриці голосів на один рендер сторінки.
 */
export function bestTimeForDay(counts: Record<string, number>) {
  const best = RAID_POLL_TIMES
    .map((time) => ({ time, count: counts[time] || 0 }))
    .sort((a, b) => b.count - a.count || RAID_POLL_TIMES.indexOf(a.time) - RAID_POLL_TIMES.indexOf(b.time))[0];
  return best && best.count > 0 ? `${best.time} · ${best.count}` : "—";
}

/** Підпис голосу — гільдійний нік Discord. Персонажів у пулі більше немає. */
export function voteDisplayName(vote: RaidPollItem["votes"][number]) {
  return vote.discordName || "Гравець";
}

