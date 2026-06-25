"use client";

import { useEffect, useMemo, useState } from "react";
import { formatLocalDate, localTimeZoneName } from "@/components/HomeLocalTime";

export type HomeUpcomingRaid = {
  id: string;
  href: string;
  title: string;
  difficulty: "normal" | "heroic" | "mythic";
  difficultyLabel: string;
  statusLabel: string;
  startsAtIso: string;
  sourceTime: string;
  sourceDate: string;
  roster: number;
};

const RAID_DURATION_MS = 4 * 60 * 60 * 1000;

function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}д ${hours}г`;
  if (hours > 0) return `${hours}г ${minutes}хв`;
  return `${minutes}хв`;
}

function raidState(startsAt: Date, now: number) {
  const start = startsAt.getTime();
  const end = start + RAID_DURATION_MS;
  if (now >= start && now <= end) {
    return {
      tone: "ongoing",
      label: `Триває: ще ${formatDuration(end - now)}`,
    };
  }
  if (start > now) {
    return {
      tone: "future",
      label: `за ${formatDuration(start - now)}`,
    };
  }
  return {
    tone: "past",
    label: `завершився ${formatDuration(now - end)} тому`,
  };
}

export default function HomeUpcomingRaidList({ raids, initialNow }: { raids: HomeUpcomingRaid[]; initialNow?: number }) {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => initialNow || Date.now());
  const [zone, setZone] = useState("локальний час");

  useEffect(() => {
    setMounted(true);
    setZone(localTimeZoneName());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const preparedRaids = useMemo(() => (
    raids
      .map((raid) => ({ raid, startsAt: new Date(raid.startsAtIso) }))
      .filter((item) => Number.isFinite(item.startsAt.getTime()))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  ), [raids]);

  if (!preparedRaids.length) {
    return <p className="home-empty-text">Найближчих рейдів поки немає.</p>;
  }

  return (
    <div className="home-upcoming-events">
      {preparedRaids.map(({ raid, startsAt }) => {
        const state = raidState(startsAt, now);
        return (
          <a className={`home-upcoming-event home-upcoming-event--${raid.difficulty} home-upcoming-event--${state.tone}`} href={raid.href} key={raid.id}>
            <span className="home-upcoming-event__main">
              <strong>{raid.title}</strong>
              <small>{state.label}</small>
              <em><b>{raid.difficultyLabel}</b> • {raid.statusLabel} • {raid.roster} запис.</em>
            </span>
            <span className="home-upcoming-event__meta">
              <time dateTime={startsAt.toISOString()}>{mounted ? formatLocalDate(startsAt, "time") : raid.sourceTime}</time>
              <span>{mounted ? formatLocalDate(startsAt, "date") : raid.sourceDate}</span>
            </span>
          </a>
        );
      })}
      <p className="home-upcoming-timezone">Час показано за локальною часовою зоною переглядача: <strong>{zone}</strong>.</p>
    </div>
  );
}
