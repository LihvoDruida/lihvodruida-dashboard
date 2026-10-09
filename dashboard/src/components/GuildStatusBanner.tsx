"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { nextRetailEuWeeklyReset, splitResetCountdown } from "@/lib/wowWeeklyReset";

export type GuildStatusRaid = {
  name: string;
  totalBosses: number;
  normalKills: number;
  heroicKills: number;
  mythicKills: number;
  updatedAt?: string | null;
} | null;

const COLLAPSED_CLASS = "guild-banner-collapsed";
const SCROLL_THRESHOLD = 28;
const SCROLL_DELTA = 6;

function raidKills(value: number, total: number) {
  return `${Math.max(0, Math.min(total, Math.floor(value)))}/${total}`;
}

export default function GuildStatusBanner({
  guildName,
  raid,
  raidHref,
  resetUtcHour = 4,
}: {
  guildName: string;
  raid: GuildStatusRaid;
  raidHref: string;
  resetUtcHour?: number;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let lastScrollY = window.scrollY;
    let frame = 0;
    const root = document.documentElement;

    const update = () => {
      frame = 0;
      const current = window.scrollY;
      if (current <= SCROLL_THRESHOLD) {
        root.classList.remove(COLLAPSED_CLASS);
      } else if (current > lastScrollY + SCROLL_DELTA) {
        root.classList.add(COLLAPSED_CLASS);
      } else if (current < lastScrollY - SCROLL_DELTA) {
        root.classList.remove(COLLAPSED_CLASS);
      }
      if (current <= SCROLL_THRESHOLD || Math.abs(current - lastScrollY) > SCROLL_DELTA) lastScrollY = current;
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    // Reloading a page deep in the document must not cover its content.
    root.classList.toggle(COLLAPSED_CLASS, lastScrollY > SCROLL_THRESHOLD);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      root.classList.remove(COLLAPSED_CLASS);
    };
  }, []);

  const countdown = now === null ? null : splitResetCountdown(nextRetailEuWeeklyReset(now, resetUtcHour) - now);
  const digits = (value: number) => String(value).padStart(2, "0");
  const resetAt = now === null ? null : nextRetailEuWeeklyReset(now, resetUtcHour);
  const resetLabel = resetAt === null
    ? "Середа, 04:00 UTC"
    : new Intl.DateTimeFormat("uk-UA", {
      weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      timeZone: "Europe/Kyiv",
    }).format(resetAt);

  return (
    <div className="guild-status-banner" aria-label="Статус гільдії та наступне тижневе скидання WoW Retail EU">
      <div className="guild-status-banner__inner">
        <Link prefetch={false} href={raidHref} className="guild-status-banner__raid">
          <span className="guild-status-banner__eyebrow">Актуальний рейд · Retail</span>
          <strong className="guild-status-banner__raid-name" title={raid?.name || "Рейдовий прогрес очікує оновлення"}>
            {raid?.name || "Прогрес оновлюється"}
          </strong>
          <span className="guild-status-banner__raid-progress">
            {raid && raid.totalBosses > 0 ? (
              <>
                <span><b>{raidKills(raid.mythicKills, raid.totalBosses)}</b> M</span>
                <span><b>{raidKills(raid.heroicKills, raid.totalBosses)}</b> H</span>
                <span><b>{raidKills(raid.normalKills, raid.totalBosses)}</b> N</span>
              </>
            ) : "Дані гільдії з Raider.IO"}
          </span>
        </Link>

        <div className="guild-status-banner__brand" aria-label={guildName}>
          <strong title={guildName}>{guildName}</strong>
          <span className="guild-status-banner__brand-sub"><i aria-hidden="true" /> World of Warcraft <i aria-hidden="true" /></span>
        </div>

        <div className="guild-status-banner__reset" title={`Наступне EU скидання: ${resetLabel} (Київ)`}>
          <span className="guild-status-banner__eyebrow">
            <span className="guild-status-banner__reset-desktop-label">До скидання КД · EU</span>
            <span className="guild-status-banner__reset-mobile-label">КД · EU</span>
          </span>
          <div className="guild-status-banner__clock" role="timer" aria-label={countdown ? `${countdown.days} днів, ${countdown.hours} годин, ${countdown.minutes} хвилин, ${countdown.seconds} секунд` : "Завантаження таймера"}>
            {[countdown?.days, countdown?.hours, countdown?.minutes, countdown?.seconds].map((part, index) => (
              <span className="guild-status-banner__clock-part" key={index}>
                <b>{part === undefined ? "--" : digits(part)}</b>
                <small>{["ДН", "ГОД", "ХВ", "СЕК"][index]}</small>
              </span>
            ))}
          </div>
          <span className="guild-status-banner__reset-caption" suppressHydrationWarning>{resetLabel} · Київ</span>
        </div>
      </div>
    </div>
  );
}
