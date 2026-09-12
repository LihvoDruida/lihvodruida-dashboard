"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import styles from "@/app/dashboard/logs/logs.module.css";

type Level = "debug" | "info" | "success" | "warning" | "error";
type Category = "security" | "api" | "action" | "auth" | "discord" | "database" | "integration" | "system";

type LogItem = {
  id: string;
  createdAt: string;
  level: Level;
  category: Category;
  source: string;
  event: string;
  message: string | null;
  actorId: string | null;
  actorName: string | null;
  actorGroupId: string | null;
  requestId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  ip: string | null;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
};

type Overview = {
  total: number;
  warnings: number;
  errors: number;
  security: number;
  categories: Record<string, number>;
  timeline: Array<{ at: string; total: number; warnings: number; errors: number }>;
  storageBytes: number;
  oldestAt: string | null;
  newestAt: string | null;
};

type Settings = {
  retentionDays: 3;
  maxStorageMb: number;
  maxRows: number;
  queryLimit: number;
  securityDiscordEnabled: boolean;
  securityDiscordChannelId: string;
  securityDiscordMinLevel: "info" | "warning" | "error";
};

type QueryResponse = {
  ok: boolean;
  items: LogItem[];
  overview: Overview;
  settings: Settings;
  now: string;
};

const CATEGORY_LABELS: Record<Category, string> = {
  security: "Безпека",
  api: "API",
  action: "Дії",
  auth: "Авторизація",
  discord: "Discord",
  database: "База",
  integration: "Інтеграції",
  system: "Система",
};

const LEVEL_LABELS: Record<Level, string> = {
  debug: "Debug",
  info: "Info",
  success: "Success",
  warning: "Warning",
  error: "Error",
};

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
  } catch {
    return "—";
  }
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
  } catch {
    return value;
  }
}

function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 МБ";
  return `${(value / 1024 / 1024).toLocaleString("uk-UA", { maximumFractionDigits: 1 })} МБ`;
}

function detailsText(details: Record<string, unknown>) {
  try { return JSON.stringify(details || {}, null, 2); } catch { return "{}"; }
}

function normalizedTimeline(
  input: Overview["timeline"],
  hours: number,
  nowIso: string,
) {
  const stepMinutes = hours >= 72 ? 60 : 15;
  const stepMs = stepMinutes * 60_000;
  const nowMs = Number.isFinite(Date.parse(nowIso)) ? Date.parse(nowIso) : Date.now();
  const end = Math.floor(nowMs / stepMs) * stepMs;
  const count = Math.max(4, Math.min(96, Math.ceil((hours * 60) / stepMinutes)));
  const start = end - (count - 1) * stepMs;
  const buckets = Array.from({ length: count }, (_, index) => ({
    at: new Date(start + index * stepMs).toISOString(),
    total: 0,
    warnings: 0,
    errors: 0,
  }));
  for (const item of input) {
    const at = Date.parse(item.at);
    if (!Number.isFinite(at)) continue;
    const slot = Math.floor((at - start) / stepMs);
    if (slot < 0 || slot >= buckets.length) continue;
    buckets[slot].total += item.total || 0;
    buckets[slot].warnings += item.warnings || 0;
    buckets[slot].errors += item.errors || 0;
  }
  return buckets;
}

export default function StructuredLogsExplorer({
  initialItems,
  initialOverview,
  settings,
}: {
  initialItems: LogItem[];
  initialOverview: Overview;
  settings: Settings;
}) {
  const [items, setItems] = useState(initialItems);
  const [overview, setOverview] = useState(initialOverview);
  const [hours, setHours] = useState(24);
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [search, setSearch] = useState("");
  const [live, setLive] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id || null);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => new Date().toISOString());
  const [isPending, startTransition] = useTransition();
  const requestRef = useRef<AbortController | null>(null);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

  const queryString = useCallback(() => {
    const params = new URLSearchParams({ hours: String(hours), limit: String(settings.queryLimit) });
    if (category) params.set("category", category);
    if (level) params.set("level", level);
    if (search.trim()) params.set("q", search.trim());
    return params.toString();
  }, [hours, category, level, search, settings.queryLimit]);

  const refresh = useCallback(async (silent = false) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(`/api/dashboard/logs/query?${queryString()}`, {
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as QueryResponse;
      if (!data.ok) throw new Error("query_failed");
      startTransition(() => {
        setItems(data.items || []);
        setOverview(data.overview);
        setLastUpdatedAt(data.now || new Date().toISOString());
        setSelectedId((current) => current && data.items.some((item) => item.id === current) ? current : data.items[0]?.id || null);
      });
      setError("");
    } catch (fetchError) {
      if ((fetchError as Error)?.name === "AbortError") return;
      if (!silent) setError("Не вдалося оновити журнал. Дані на екрані залишено без змін.");
    }
  }, [queryString]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(true), 250);
    return () => window.clearTimeout(timer);
  }, [hours, category, level, search, refresh]);

  useEffect(() => {
    if (!live) return;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh(true);
        schedule();
      }, 5000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [live, refresh]);

  const timeline = useMemo(
    () => normalizedTimeline(overview.timeline, hours, lastUpdatedAt),
    [overview.timeline, hours, lastUpdatedAt],
  );
  const maxTimeline = Math.max(1, ...timeline.map((item) => item.total));
  const filteredExportHref = `/api/dashboard/logs/export?scope=filtered&${queryString()}`;
  const fullExportHref = "/api/dashboard/logs/export?scope=all";

  return (
    <div className={styles.workspace}>
      <section className={styles.controls} aria-label="Фільтри журналу">
        <div className={styles.searchRow}>
          <label className={styles.searchBox}>
            <span>Пошук</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="event, path, користувач, текст…" />
          </label>
          <div className={styles.rangeGroup} aria-label="Період">
            {[1, 6, 24, 72].map((value) => (
              <button key={value} type="button" className={`btn ${hours === value ? styles.activeChip : styles.chip}`} onClick={() => setHours(value)}>
                {value === 72 ? "3 дні" : `${value} год`}
              </button>
            ))}
          </div>
          <button type="button" className={`btn ${live ? styles.liveButton : styles.chip}`} onClick={() => setLive((value) => !value)}>
            <span className={styles.liveDot} /> {live ? "Live" : "Пауза"}
          </button>
          <button type="button" className={`btn ${styles.chip}`} onClick={() => void refresh(false)} disabled={isPending}>↻ Оновити</button>
          <div className={styles.exportGroup} aria-label="Експорт журналу">
            <a className={`btn ${styles.chip}`} href={filteredExportHref}>⇩ Фільтр JSON</a>
            <a className={`btn ${styles.chip}`} href={fullExportHref}>⇩ Усі 3 дні JSON</a>
          </div>
        </div>

        <div className={styles.filterRow}>
          <button type="button" className={`btn ${!category ? styles.activeChip : styles.chip}`} onClick={() => setCategory("")}>Усі <strong>{overview.total}</strong></button>
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((key) => (
            <button key={key} type="button" className={`btn ${category === key ? styles.activeChip : styles.chip}`} onClick={() => setCategory(key)}>
              {CATEGORY_LABELS[key]} <strong>{overview.categories[key] || 0}</strong>
            </button>
          ))}
          <span className={styles.separator} />
          {(["error", "warning", "info", "success"] as Level[]).map((key) => (
            <button key={key} type="button" className={`btn ${level === key ? styles.activeChip : styles.chip}`} onClick={() => setLevel(level === key ? "" : key)}>
              {LEVEL_LABELS[key]}
            </button>
          ))}
        </div>

        <div className={styles.timeline} aria-label="Активність журналу">
          {timeline.length ? timeline.map((bucket) => (
            <div key={bucket.at} className={styles.timelineSlot} title={`${formatDateTime(bucket.at)} · ${bucket.total}`}>
              <span className={styles.timelineBar} style={{ height: `${Math.max(6, (bucket.total / maxTimeline) * 100)}%` }} />
              {bucket.errors ? <span className={styles.timelineError} style={{ height: `${Math.max(4, (bucket.errors / maxTimeline) * 100)}%` }} /> : null}
            </div>
          )) : <div className={styles.timelineEmpty}>За вибраний період подій немає.</div>}
        </div>

        <div className={styles.summaryStrip}>
          <span><strong>{overview.total}</strong><small>подій</small></span>
          <span><strong>{overview.warnings}</strong><small>warning</small></span>
          <span><strong>{overview.errors}</strong><small>errors</small></span>
          <span><strong>{overview.security}</strong><small>security</small></span>
          <span><strong>{bytes(overview.storageBytes)}</strong><small>таблиця логів</small></span>
          <span><strong>{settings.maxStorageMb} МБ</strong><small>ліміт сховища</small></span>
          <span><strong>3 дні</strong><small>retention</small></span>
          <span><strong>{formatTime(lastUpdatedAt)}</strong><small>оновлено</small></span>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>

      <div className={styles.dataArea}>
        <section className={styles.logTable} aria-label="Події журналу">
          <div className={styles.tableHeader}>
            <span>Час</span><span>Рівень</span><span>Категорія</span><span>Запит / подія</span><span>Повідомлення</span>
          </div>
          <div className={styles.rows}>
            {items.length ? items.map((item) => (
              <button key={item.id} type="button" className={`btn ${styles.logRow} ${selectedId === item.id ? styles.logRowSelected : ""}`} onClick={() => setSelectedId(item.id)}>
                <time>{formatTime(item.createdAt)}</time>
                <span className={`${styles.level} ${styles[`level_${item.level}`]}`}>{LEVEL_LABELS[item.level]}</span>
                <span className={`${styles.category} ${styles[`category_${item.category}`]}`}>{CATEGORY_LABELS[item.category]}</span>
                <span className={styles.requestCell}>
                  {item.method || item.path ? <strong>{item.method || "EVT"} {item.path || item.event}</strong> : <strong>{item.event}</strong>}
                  <small>{item.statusCode ? `HTTP ${item.statusCode}` : item.source}{item.durationMs !== null ? ` · ${item.durationMs} ms` : ""}</small>
                </span>
                <span className={styles.messageCell}>{item.message || item.event}</span>
              </button>
            )) : <div className={styles.empty}>Немає логів за вибраними фільтрами.</div>}
          </div>
        </section>

        <aside className={styles.detailsPanel} aria-label="Деталі події">
          {selected ? (
            <>
              <div className={styles.detailsHead}>
                <div>
                  <span className={`${styles.level} ${styles[`level_${selected.level}`]}`}>{LEVEL_LABELS[selected.level]}</span>
                  <h2>{selected.event}</h2>
                </div>
                <button type="button" className="btn" onClick={() => setSelectedId(null)} aria-label="Закрити деталі">×</button>
              </div>
              <dl className={styles.metaGrid}>
                <div><dt>Час</dt><dd>{formatDateTime(selected.createdAt)}</dd></div>
                <div><dt>Категорія</dt><dd>{CATEGORY_LABELS[selected.category]}</dd></div>
                <div><dt>Джерело</dt><dd>{selected.source}</dd></div>
                <div><dt>Actor</dt><dd>{selected.actorName || selected.actorId || "—"}</dd></div>
                <div><dt>Request ID</dt><dd>{selected.requestId || "—"}</dd></div>
                <div><dt>IP</dt><dd>{selected.ip || "—"}</dd></div>
                <div><dt>HTTP</dt><dd>{selected.method || selected.statusCode ? `${selected.method || "—"} · ${selected.statusCode || "—"}` : "—"}</dd></div>
                <div><dt>Duration</dt><dd>{selected.durationMs !== null ? `${selected.durationMs} ms` : "—"}</dd></div>
              </dl>
              {selected.path ? <div className={styles.pathBlock}><small>Path</small><code>{selected.path}</code></div> : null}
              {selected.message ? <p className={styles.detailMessage}>{selected.message}</p> : null}
              <div className={styles.jsonBlock}>
                <span>Details</span>
                <pre>{detailsText(selected.details)}</pre>
              </div>
            </>
          ) : <div className={styles.emptyDetails}>Вибери рядок журналу, щоб переглянути повні дані.</div>}
        </aside>
      </div>
    </div>
  );
}
