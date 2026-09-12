"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ServerStatusSnapshot } from "@/lib/serverStatusTypes";

type HistoryPoint = {
  at: number;
  cpu: number | null;
  memory: number;
  disk: number | null;
  cores: Array<number | null>;
};

type ApiPayload = {
  ok: boolean;
  snapshot?: ServerStatusSnapshot;
  error?: string;
  message?: string;
  loginUrl?: string;
};

const POLL_MS = 2_500;
const MAX_HISTORY = 72;

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ", "ПБ"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 3 ? 1 : unit >= 2 ? 0 : 0;
  return `${value.toLocaleString("uk-UA", { maximumFractionDigits: digits })} ${units[unit]}`;
}

function formatPercent(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "збір…";
  return `${value.toLocaleString("uk-UA", { maximumFractionDigits: digits })}%`;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} д ${hours} год ${minutes} хв`;
  if (hours > 0) return `${hours} год ${minutes} хв`;
  return `${minutes} хв`;
}

function percentClass(value: number | null | undefined) {
  if (value === null || value === undefined) return "is-neutral";
  if (value >= 90) return "is-critical";
  if (value >= 75) return "is-warning";
  return "is-good";
}

function addHistory(history: HistoryPoint[], snapshot: ServerStatusSnapshot) {
  const next: HistoryPoint = {
    at: Date.parse(snapshot.sampledAt) || Date.now(),
    cpu: snapshot.cpu.usagePercent,
    memory: snapshot.memory.usagePercent,
    disk: snapshot.disk.usagePercent,
    cores: snapshot.cpu.cores.map((core) => core.usagePercent),
  };
  return [...history, next].slice(-MAX_HISTORY);
}

function linePoints(values: Array<number | null | undefined>, width = 600, height = 160) {
  const normalized = values.map((value) => value === null || value === undefined ? null : Math.max(0, Math.min(100, value)));
  const count = Math.max(1, normalized.length - 1);
  return normalized
    .map((value, index) => {
      if (value === null) return null;
      const x = (index / count) * width;
      const y = height - (value / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((point): point is string => Boolean(point))
    .join(" ");
}

function MetricGraph({
  label,
  value,
  history,
  className = "",
}: {
  label: string;
  value: string;
  history: Array<number | null | undefined>;
  className?: string;
}) {
  const points = linePoints(history);
  return (
    <article className={`server-graph-card ${className}`.trim()}>
      <div className="server-graph-card__head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <svg className="server-graph" viewBox="0 0 600 160" role="img" aria-label={`${label}: ${value}`} preserveAspectRatio="none">
        <line x1="0" y1="40" x2="600" y2="40" className="server-graph__grid" />
        <line x1="0" y1="80" x2="600" y2="80" className="server-graph__grid" />
        <line x1="0" y1="120" x2="600" y2="120" className="server-graph__grid" />
        {points ? <polyline points={points} className="server-graph__line" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <div className="server-graph-card__scale" aria-hidden="true">
        <span>0%</span><span>50%</span><span>100%</span>
      </div>
    </article>
  );
}

function UsageBar({ value }: { value: number | null | undefined }) {
  const width = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={`server-usage ${percentClass(value)}`} aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export default function ServerStatusDashboard({ initialSnapshot }: { initialSnapshot: ServerStatusSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [history, setHistory] = useState<HistoryPoint[]>(() => addHistory([], initialSnapshot));
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard/server-status", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({ ok: false })) as ApiPayload;
      if (response.status === 401 && payload.loginUrl) {
        window.location.assign(payload.loginUrl);
        return;
      }
      if (!response.ok || !payload.ok || !payload.snapshot) {
        throw new Error(payload.message || (response.status === 403 ? "Ця сторінка доступна лише власнику сервера." : "Метрики сервера тимчасово недоступні."));
      }
      setSnapshot(payload.snapshot);
      setHistory((current) => addHistory(current, payload.snapshot!));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося оновити стан сервера.");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => {
      if (!paused) void refresh();
    }, 700);
    const timer = window.setInterval(() => {
      if (!paused && document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [paused, refresh]);

  const coreHistories = useMemo(
    () => snapshot.cpu.cores.map((_, coreIndex) => history.map((point) => point.cores[coreIndex] ?? null)),
    [history, snapshot.cpu.cores],
  );

  const sampledAt = new Date(snapshot.sampledAt);
  const swapPercent = snapshot.memory.swapTotalBytes && snapshot.memory.swapUsedBytes !== null
    ? (snapshot.memory.swapUsedBytes / snapshot.memory.swapTotalBytes) * 100
    : null;

  return (
    <div className="server-status-dashboard">
      <section className="panel server-status-toolbar" aria-label="Керування моніторингом сервера">
        <div>
          <span className="eyebrow">Live monitoring</span>
          <strong>{error ? "Оновлення призупинено помилкою" : paused ? "Автооновлення призупинено" : `Автооновлення кожні ${POLL_MS / 1000} с`}</strong>
          <small>Останній знімок: {Number.isNaN(sampledAt.getTime()) ? "—" : sampledAt.toLocaleTimeString("uk-UA")}</small>
        </div>
        <div className="server-status-toolbar__actions">
          <button type="button" className="btn secondary" onClick={() => setPaused((value) => !value)}>
            {paused ? "Продовжити" : "Пауза"}
          </button>
          <button type="button" className="btn primary" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Оновлення…" : "Оновити зараз"}
          </button>
        </div>
        {error ? <p className="form-error server-status-error" role="alert">{error}</p> : null}
      </section>

      <section className="server-summary-grid" aria-label="Короткий стан сервера">
        <article className={`panel server-summary-card ${percentClass(snapshot.cpu.usagePercent)}`}>
          <span>CPU</span>
          <strong>{formatPercent(snapshot.cpu.usagePercent, 1)}</strong>
          <UsageBar value={snapshot.cpu.usagePercent} />
          <small>{snapshot.cpu.logicalCores} логічних ядер · Load {snapshot.cpu.loadAverage.map((value) => value.toFixed(2)).join(" / ")}</small>
        </article>
        <article className={`panel server-summary-card ${percentClass(snapshot.memory.usagePercent)}`}>
          <span>RAM</span>
          <strong>{formatPercent(snapshot.memory.usagePercent, 1)}</strong>
          <UsageBar value={snapshot.memory.usagePercent} />
          <small>{formatBytes(snapshot.memory.usedBytes)} зайнято · {formatBytes(snapshot.memory.availableBytes)} вільно</small>
        </article>
        <article className={`panel server-summary-card ${percentClass(snapshot.disk.usagePercent)}`}>
          <span>Диск</span>
          <strong>{formatPercent(snapshot.disk.usagePercent, 1)}</strong>
          <UsageBar value={snapshot.disk.usagePercent} />
          <small>{formatBytes(snapshot.disk.usedBytes)} зайнято · {formatBytes(snapshot.disk.freeBytes)} вільно</small>
        </article>
        <article className="panel server-summary-card is-good">
          <span>Uptime</span>
          <strong>{formatDuration(snapshot.uptime.systemSeconds)}</strong>
          <small>Dashboard process: {formatDuration(snapshot.uptime.processSeconds)}</small>
        </article>
      </section>

      <section className="server-graphs-grid" aria-label="Графіки використання ресурсів">
        <MetricGraph label="Загальне навантаження CPU" value={formatPercent(snapshot.cpu.usagePercent, 1)} history={history.map((point) => point.cpu)} className={percentClass(snapshot.cpu.usagePercent)} />
        <MetricGraph label="Використання RAM" value={formatPercent(snapshot.memory.usagePercent, 1)} history={history.map((point) => point.memory)} className={percentClass(snapshot.memory.usagePercent)} />
        <MetricGraph label="Заповнення диска" value={formatPercent(snapshot.disk.usagePercent, 1)} history={history.map((point) => point.disk)} className={percentClass(snapshot.disk.usagePercent)} />
      </section>

      <section className="panel server-section" aria-labelledby="server-cpu-cores-title">
        <div className="server-section__head">
          <div>
            <span className="eyebrow">CPU cores</span>
            <h2 id="server-cpu-cores-title">Навантаження по ядрах</h2>
          </div>
          <p>{snapshot.cpu.model}</p>
        </div>
        <div className="server-core-grid">
          {snapshot.cpu.cores.map((core, index) => (
            <article key={core.index} className={`server-core-card ${percentClass(core.usagePercent)}`}>
              <div className="server-core-card__head">
                <span>CPU {core.index}</span>
                <strong>{formatPercent(core.usagePercent, 1)}</strong>
              </div>
              <svg className="server-core-spark" viewBox="0 0 240 72" role="img" aria-label={`Ядро CPU ${core.index}: ${formatPercent(core.usagePercent, 1)}`} preserveAspectRatio="none">
                <line x1="0" y1="36" x2="240" y2="36" className="server-graph__grid" />
                <polyline points={linePoints(coreHistories[index] || [], 240, 72)} className="server-graph__line" vectorEffect="non-scaling-stroke" />
              </svg>
              <small>{core.speedMHz ? `${core.speedMHz.toLocaleString("uk-UA")} MHz` : "частота недоступна"}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="server-detail-grid" aria-label="Детальні системні показники">
        <article className="panel server-detail-card">
          <div className="server-detail-card__head"><span>Оперативна пам’ять</span><strong>{formatBytes(snapshot.memory.totalBytes)}</strong></div>
          <dl>
            <div><dt>Зайнято</dt><dd>{formatBytes(snapshot.memory.usedBytes)}</dd></div>
            <div><dt>Доступно</dt><dd>{formatBytes(snapshot.memory.availableBytes)}</dd></div>
            <div><dt>Dashboard RSS</dt><dd>{formatBytes(snapshot.memory.processRssBytes)}</dd></div>
            <div><dt>Node heap</dt><dd>{formatBytes(snapshot.memory.processHeapUsedBytes)} / {formatBytes(snapshot.memory.processHeapTotalBytes)}</dd></div>
          </dl>
        </article>

        <article className="panel server-detail-card">
          <div className="server-detail-card__head"><span>Swap</span><strong>{snapshot.memory.swapTotalBytes === null ? "—" : formatPercent(swapPercent, 1)}</strong></div>
          <dl>
            <div><dt>Усього</dt><dd>{formatBytes(snapshot.memory.swapTotalBytes)}</dd></div>
            <div><dt>Зайнято</dt><dd>{formatBytes(snapshot.memory.swapUsedBytes)}</dd></div>
            <div><dt>Вільно</dt><dd>{formatBytes(snapshot.memory.swapFreeBytes)}</dd></div>
          </dl>
        </article>

        <article className="panel server-detail-card">
          <div className="server-detail-card__head"><span>Сховище</span><strong>{formatBytes(snapshot.disk.totalBytes)}</strong></div>
          <dl>
            <div><dt>Точка</dt><dd>{snapshot.disk.path}</dd></div>
            <div><dt>Зайнято</dt><dd>{formatBytes(snapshot.disk.usedBytes)}</dd></div>
            <div><dt>Вільно</dt><dd>{formatBytes(snapshot.disk.freeBytes)}</dd></div>
          </dl>
        </article>

        <article className="panel server-detail-card">
          <div className="server-detail-card__head"><span>Система</span><strong>{snapshot.platform.hostname}</strong></div>
          <dl>
            <div><dt>ОС</dt><dd>{snapshot.platform.platform} {snapshot.platform.release}</dd></div>
            <div><dt>Архітектура</dt><dd>{snapshot.platform.arch}</dd></div>
            <div><dt>Node.js</dt><dd>{snapshot.platform.nodeVersion}</dd></div>
            <div><dt>Ядер</dt><dd>{snapshot.cpu.logicalCores}</dd></div>
          </dl>
        </article>
      </section>

      <p className="server-status-note">
        Графіки зберігають тільки коротку історію поточної вкладки браузера й не записуються в базу даних. Якщо dashboard працює в Docker, системні значення читаються з середовища контейнера та доступного йому файлового сховища.
      </p>
    </div>
  );
}
