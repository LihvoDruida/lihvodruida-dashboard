"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DockerStorageMetric, ServerStatusSnapshot } from "@/lib/serverStatusTypes";

type HistoryPoint = {
  at: number;
  cpu: number | null;
  memory: number;
  swap: number | null;
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

const POLL_MS = 2_000;
const SLOW_REFRESH_MS = 60_000;
const MAX_HISTORY = 90;

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ", "ПБ"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 3 ? 1 : 0;
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

function swapPercent(snapshot: ServerStatusSnapshot) {
  const total = snapshot.memory.swapTotalBytes;
  const used = snapshot.memory.swapUsedBytes;
  if (!total || used === null) return null;
  return Math.max(0, Math.min(100, (used / total) * 100));
}

function addHistory(history: HistoryPoint[], snapshot: ServerStatusSnapshot) {
  const at = Date.parse(snapshot.sampledAt) || Date.now();
  if (history.at(-1)?.at === at) return history;
  const next: HistoryPoint = {
    at,
    cpu: snapshot.cpu.usagePercent,
    memory: snapshot.memory.usagePercent,
    swap: swapPercent(snapshot),
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

function DockerMetricCard({ metric, label }: { metric: DockerStorageMetric | null; label: string }) {
  if (!metric) {
    return (
      <article className="server-docker-card is-neutral">
        <span>{label}</span>
        <strong>—</strong>
        <small>Дані ще не зібрані</small>
      </article>
    );
  }
  const tone = metric.reclaimableBytes && metric.reclaimableBytes >= 2 * 1024 ** 3 ? "is-warning" : "is-good";
  return (
    <article className={`server-docker-card ${tone}`}>
      <span>{label}</span>
      <strong>{formatBytes(metric.sizeBytes)}</strong>
      <small>
        {metric.reclaimableBytes ? `${formatBytes(metric.reclaimableBytes)} можна звільнити` : "reclaimable 0 Б"}
        {metric.totalCount !== null ? ` · ${metric.totalCount} об.` : ""}
      </small>
    </article>
  );
}

export default function ServerStatusDashboard({ initialSnapshot }: { initialSnapshot: ServerStatusSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [history, setHistory] = useState<HistoryPoint[]>(() => addHistory([], initialSnapshot));
  const [paused, setPaused] = useState(false);
  const [manualLoading, setManualLoading] = useState(false);
  const [error, setError] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const inFlight = useRef(false);
  const lastSlowRefresh = useRef(Date.now());
  const errorCount = useRef(0);

  const refresh = useCallback(async ({ manual = false, includeDocker = false }: { manual?: boolean; includeDocker?: boolean } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (manual) setManualLoading(true);
    const started = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4_000);
    try {
      const requestOptions: RequestInit = {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      };
      const response = includeDocker
        ? await fetch("/api/dashboard/server-status", requestOptions)
        : await fetch("/api/dashboard/server-status?scope=fast", requestOptions);
      const payload = await response.json().catch(() => ({ ok: false })) as ApiPayload;
      if (response.status === 401 && payload.loginUrl) {
        window.location.assign(payload.loginUrl);
        return;
      }
      if (!response.ok || !payload.ok || !payload.snapshot) {
        throw new Error(payload.message || (response.status === 403 ? "Ця сторінка доступна лише власнику сервера." : "Метрики сервера тимчасово недоступні."));
      }
      const incoming = payload.snapshot;
      startTransition(() => {
        setSnapshot((current) => ({ ...incoming, docker: incoming.docker ?? current.docker }));
        setHistory((current) => addHistory(current, incoming));
      });
      setLatencyMs(Math.round(performance.now() - started));
      setError("");
      errorCount.current = 0;
      if (includeDocker) lastSlowRefresh.current = Date.now();
    } catch (reason) {
      errorCount.current += 1;
      setError(reason instanceof Error && reason.name !== "AbortError" ? reason.message : "Сервер не встиг відповісти на запит метрик.");
    } finally {
      window.clearTimeout(timeout);
      if (manual) setManualLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;
      if (paused || document.visibilityState !== "visible") {
        schedule(POLL_MS);
        return;
      }
      const includeDocker = Date.now() - lastSlowRefresh.current >= SLOW_REFRESH_MS;
      await refresh({ includeDocker });
      const backoff = errorCount.current ? Math.min(12_000, POLL_MS * (errorCount.current + 1)) : POLL_MS;
      schedule(backoff);
    };

    const onVisibility = () => {
      if (!cancelled && !paused && document.visibilityState === "visible") schedule(150);
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule(650);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paused, refresh]);

  const coreHistories = useMemo(
    () => snapshot.cpu.cores.map((_, coreIndex) => history.map((point) => point.cores[coreIndex] ?? null)),
    [history, snapshot.cpu.cores],
  );

  const sampledAt = new Date(snapshot.sampledAt);
  const swapUsage = swapPercent(snapshot);
  const docker = snapshot.docker;
  const dockerCache = docker?.buildCache ?? null;
  const dockerCacheDiskPercent = dockerCache?.sizeBytes && snapshot.disk.totalBytes
    ? Math.min(100, (dockerCache.sizeBytes / snapshot.disk.totalBytes) * 100)
    : null;
  const dockerWarning = Boolean(
    dockerCache?.sizeBytes && dockerCache.sizeBytes >= 8 * 1024 ** 3
    || dockerCache?.reclaimableBytes && dockerCache.reclaimableBytes >= 3 * 1024 ** 3,
  );

  return (
    <div className="server-status-dashboard">
      <section className="panel server-status-toolbar" aria-label="Керування моніторингом сервера">
        <div className="server-status-toolbar__state">
          <span className={`server-live-dot ${paused ? "is-paused" : error ? "is-error" : "is-live"}`} aria-hidden="true" />
          <div>
            <span className="eyebrow">Live monitoring</span>
            <strong>{paused ? "Автооновлення призупинено" : error ? "Працюємо з останнім успішним знімком" : `Тихе автооновлення кожні ${POLL_MS / 1000} с`}</strong>
            <small>
              Останній знімок: {Number.isNaN(sampledAt.getTime()) ? "—" : sampledAt.toLocaleTimeString("uk-UA")}
              {latencyMs !== null ? ` · ${latencyMs} мс` : ""}
            </small>
          </div>
        </div>
        <div className="server-status-toolbar__actions">
          <button type="button" className="btn secondary" onClick={() => setPaused((value) => !value)}>
            {paused ? "Продовжити" : "Пауза"}
          </button>
          <button type="button" className="btn primary" onClick={() => void refresh({ manual: true, includeDocker: true })} disabled={manualLoading}>
            {manualLoading ? "Оновлюю…" : "Оновити все"}
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
        <article className={`panel server-summary-card ${percentClass(swapUsage)}`}>
          <span>Swap</span>
          <strong>{snapshot.memory.swapTotalBytes ? formatPercent(swapUsage, 1) : "Вимкнено"}</strong>
          <UsageBar value={swapUsage} />
          <small>{snapshot.memory.swapTotalBytes ? `${formatBytes(snapshot.memory.swapUsedBytes)} зайнято · ${formatBytes(snapshot.memory.swapFreeBytes)} вільно` : "Для 4 GB VPS рекомендовано 1–2 GB swap"}</small>
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
        <MetricGraph label="Використання Swap" value={snapshot.memory.swapTotalBytes ? formatPercent(swapUsage, 1) : "Вимкнено"} history={history.map((point) => point.swap)} className={percentClass(swapUsage)} />
        <MetricGraph label="Заповнення диска" value={formatPercent(snapshot.disk.usagePercent, 1)} history={history.map((point) => point.disk)} className={percentClass(snapshot.disk.usagePercent)} />
      </section>

      <section className="panel server-section server-docker-section" aria-labelledby="server-docker-title">
        <div className="server-section__head">
          <div>
            <span className="eyebrow">Docker storage</span>
            <h2 id="server-docker-title">Docker / BuildKit</h2>
          </div>
          <p>{docker?.sampledAt ? `Знімок ${new Date(docker.sampledAt).toLocaleString("uk-UA")}` : "Знімок створюється після deploy / clean-cache"}</p>
        </div>
        {docker?.available ? (
          <>
            <div className="server-docker-grid">
              <DockerMetricCard metric={docker.images} label="Images" />
              <DockerMetricCard metric={docker.containers} label="Containers" />
              <DockerMetricCard metric={docker.volumes} label="Volumes" />
              <DockerMetricCard metric={docker.buildCache} label="Build cache" />
            </div>
            <div className={`server-cache-health ${dockerWarning ? "is-warning" : "is-good"}`}>
              <div>
                <strong>{dockerWarning ? "Build cache потребує уваги" : "Build cache у нормі"}</strong>
                <small>
                  {dockerCache ? `${formatBytes(dockerCache.sizeBytes)} загалом · ${formatBytes(dockerCache.reclaimableBytes)} reclaimable` : "Немає даних"}
                  {dockerCacheDiskPercent !== null ? ` · ${dockerCacheDiskPercent.toFixed(1)}% диска` : ""}
                </small>
              </div>
              <code>make clean-cache</code>
            </div>
          </>
        ) : (
          <div className="server-docker-empty">
            <strong>Docker snapshot ще не створений</strong>
            <p>Після наступного <code>make up</code> або <code>make clean-cache</code> тут зʼявляться Images, Volumes і Build Cache без доступу dashboard до Docker socket.</p>
          </div>
        )}
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
          <div className="server-detail-card__head"><span>Swap</span><strong>{snapshot.memory.swapTotalBytes === null ? "—" : formatPercent(swapUsage, 1)}</strong></div>
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
        Швидкі метрики оновлюються окремим легким запитом і не пишуться в PostgreSQL. Docker/BuildKit читається з безпечного host-snapshot файлу, тому dashboard не отримує доступу до Docker socket. Старий невикористаний build cache автоматично обмежується після deploy.
      </p>
    </div>
  );
}
