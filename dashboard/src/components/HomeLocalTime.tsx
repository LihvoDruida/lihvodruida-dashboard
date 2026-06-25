"use client";

import { useEffect, useMemo, useState } from "react";

type LocalTimeMode = "time" | "date" | "dateTime" | "compact";

type HomeLocalTimeProps = {
  value: string | number | Date | null | undefined;
  fallback?: string;
  mode?: LocalTimeMode;
  className?: string;
  showZone?: boolean;
};

function toDate(value: HomeLocalTimeProps["value"]) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatterOptions(mode: LocalTimeMode): Intl.DateTimeFormatOptions {
  if (mode === "time") {
    return { hour: "2-digit", minute: "2-digit" };
  }
  if (mode === "date") {
    return { weekday: "short", day: "2-digit", month: "short" };
  }
  if (mode === "compact") {
    return { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
  }
  return { dateStyle: "medium", timeStyle: "short" };
}

export function localTimeZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "локальний час";
  } catch {
    return "локальний час";
  }
}

export function formatLocalDate(value: HomeLocalTimeProps["value"], mode: LocalTimeMode = "dateTime") {
  const date = toDate(value);
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, formatterOptions(mode)).format(date);
  } catch {
    return date.toISOString().slice(0, mode === "time" ? 16 : 10).replace("T", " ");
  }
}

export function HomeLocalTime({ value, fallback = "—", mode = "dateTime", className, showZone = false }: HomeLocalTimeProps) {
  const [mounted, setMounted] = useState(false);
  const date = useMemo(() => toDate(value), [value]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const label = mounted && date ? formatLocalDate(date, mode) : fallback;
  const zone = mounted && showZone ? localTimeZoneName() : null;

  return (
    <time className={className} dateTime={date?.toISOString()}>
      {label}
      {zone ? <span className="home-local-time-zone"> {zone}</span> : null}
    </time>
  );
}
