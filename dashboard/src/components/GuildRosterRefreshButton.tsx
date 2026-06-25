"use client";

import { useEffect, useRef, useState } from "react";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";

type RefreshState = "idle" | "loading" | "done" | "error";

type GuildRosterRefreshPayload = {
  ok?: boolean;
  error?: string;
  memberCount?: number;
  hasMore?: boolean;
  refresh?: {
    sync?: {
      status?: string;
      phase?: string;
      totalMembers?: number;
      processed?: {
        roster?: number;
        battleNet?: number;
        raiderIo?: number;
      };
      errors?: string[];
    };
    battleNet?: {
      remaining?: number;
      checked?: number;
      totalCandidates?: number;
    };
    raiderIo?: {
      remaining?: number;
      checked?: number;
      totalCandidates?: number;
    };
  };
};

type GuildRosterRefreshSettings = {
  clientDrivenSyncEnabled?: boolean;
  clientStepDelayMs?: number;
  clientRequestTimeoutMs?: number;
  clientMaxSteps?: number;
};

type Props = {
  settings?: GuildRosterRefreshSettings;
  autoStartMissingRecords?: boolean;
};

function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function phaseLabel(phase?: string) {
  if (phase === "roster") return "оновлення списку";
  if (phase === "battlenet") return "оновлення деталей";
  if (phase === "raiderio") return "оновлення прогресу";
  if (phase === "completed") return "завершено";
  if (phase === "failed") return "помилка";
  return "очікування";
}

export default function GuildRosterRefreshButton({
  settings,
  autoStartMissingRecords = false,
}: Props) {
  const [state, setState] = useState<RefreshState>("idle");
  const [message, setMessage] = useState("");
  const runIdRef = useRef(0);
  const autoStartedRef = useRef(false);

  const clientDrivenSyncEnabled = settings?.clientDrivenSyncEnabled !== false;
  const maxSteps = boundedInt(settings?.clientMaxSteps, 2200, 1, 10_000);
  const stepDelayMs = boundedInt(settings?.clientStepDelayMs, 250, 0, 5_000);
  const requestTimeoutMs = boundedInt(
    settings?.clientRequestTimeoutMs,
    40_000,
    5_000,
    60_000,
  );

  async function runRefreshStep(step: number) {
    return dashboardApiJson<GuildRosterRefreshPayload>("/api/guild/refresh", {
      method: "POST",
      headers: { "X-Dashboard-Action": "guild-roster-refresh" },
      json: {
        force: step === 0,
        continue: step > 0,
        includeMembers: false,
      },
      retries: 0,
      timeoutMs: requestTimeoutMs,
    });
  }

  async function refreshRoster() {
    if (state === "loading") return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setState("loading");
    setMessage("Оновлюю склад у фоні. Поточні дані залишаються доступними.");

    try {
      let payload: GuildRosterRefreshPayload | null = null;
      const stepsToRun = clientDrivenSyncEnabled ? maxSteps : 1;

      for (let step = 0; step < stepsToRun; step += 1) {
        if (runIdRef.current !== runId) return;

        payload = await runRefreshStep(step);

        if (payload?.ok === false) {
          throw new Error(payload?.error || "Оновлення не виконалось.");
        }

        notifyDashboardDataChanged({
          scope: "guild",
          source: "guild-roster-refresh",
          action: "refresh-step",
          revision: `${Date.now()}-${step}`,
        });

        const sync = payload.refresh?.sync;
        const battleNetLeft = Math.max(
          0,
          Number(payload.refresh?.battleNet?.remaining || 0),
        );
        const rioLeft = Math.max(
          0,
          Number(payload.refresh?.raiderIo?.remaining || 0),
        );
        const rioReason = String((payload.refresh?.raiderIo as { reason?: unknown } | undefined)?.reason || "");
        const rioRateLimited = rioReason.startsWith("raiderio_rate_limited");
        const processedBattleNet = Math.max(
          0,
          Number(sync?.processed?.battleNet || 0),
        );
        const processedRio = Math.max(
          0,
          Number(sync?.processed?.raiderIo || 0),
        );
        const total = Math.max(
          0,
          Number(sync?.totalMembers || payload.memberCount || 0),
        );

        const processedTotal = Math.max(processedBattleNet, processedRio);
        const remainingTotal = Math.max(battleNetLeft, rioLeft);
        setMessage(
          `Оновлення: ${phaseLabel(sync?.phase)}. Оброблено ${processedTotal}/${total}. Залишилось приблизно ${remainingTotal}.`,
        );

        if (rioRateLimited) {
          const seconds = Number(rioReason.split(":")[1]?.replace("s", ""));
          setMessage(
            `Зовнішній сервіс тимчасово обмежив запити. Уже отримані дані збережено. Продовжити можна приблизно через ${Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 60)) : 15} хв.`,
          );
          break;
        }

        if (
          !payload.hasMore ||
          sync?.status === "completed" ||
          sync?.status === "failed"
        )
          break;
        if (!clientDrivenSyncEnabled) break;
        if (stepDelayMs > 0) await wait(stepDelayMs);
      }

      if (payload?.refresh?.sync?.status === "failed") {
        const lastSyncError = payload.refresh.sync.errors?.at(-1);
        throw new Error(
          payload.error || lastSyncError || "Синхронізація зупинилась з помилкою.",
        );
      }

      setState("done");
      setMessage(
        payload?.hasMore
          ? clientDrivenSyncEnabled
            ? `Досягнуто ліміт кроків (${maxSteps}). Частину даних уже збережено, натисни “Оновити склад” ще раз для продовження.`
            : `Перший крок виконано: збережено ${payload?.memberCount ?? 0} персонажів. Натисни ще раз для продовження.`
          : `Готово: склад оновлено, персонажів: ${payload?.memberCount ?? 0}.`,
      );
      notifyDashboardDataChanged({
        scope: "guild",
        source: "guild-roster-refresh",
        action: "refresh-complete",
      });
      window.setTimeout(() => {
        setState("idle");
        setMessage("");
      }, 7000);
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Не вдалося оновити склад.",
      );
    }
  }

  useEffect(() => {
    if (!autoStartMissingRecords || autoStartedRef.current || state !== "idle")
      return;
    autoStartedRef.current = true;
    setMessage("Створюю перші записи складу. Поточна сторінка оновиться автоматично.");
    const timer = window.setTimeout(() => {
      void refreshRoster();
    }, 350);
    return () => window.clearTimeout(timer);
    // refreshRoster intentionally remains local to avoid restarting auto sync on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartMissingRecords, state]);

  return (
    <div className="guild-refresh-action">
      <button
        type="button"
        onClick={refreshRoster}
        disabled={state === "loading"}
        aria-busy={state === "loading"}
      >
        {state === "loading" ? "Синхронізація…" : "Оновити склад"}
      </button>
      {message ? (
        <span
          className={`guild-refresh-action__status guild-refresh-action__status--${state}`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
