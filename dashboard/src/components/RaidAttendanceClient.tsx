"use client";

import { useEffect, useState } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";

type RaidSignupStatus = "going" | "tentative" | "late" | "skipped";
type ToastPayload = {
  tone?: "info" | "success" | "warning" | "error";
  title?: string;
  message?: string;
  ttl?: number;
};

export type RaidSignupCharacterOption = {
  key: string;
  label: string;
  meta?: string;
};

type RaidAttendanceClientProps = {
  raidId: string;
  closed: boolean;
  full: boolean;
  viewerAlreadyActive: boolean;
  activeJoinDisabled: boolean;
  skipDisabled: boolean;
  registrationLocked?: boolean;
  registrationLockMessage?: string;
  showRequirement: boolean;
  requirementTitle: string;
  requirementMessage: string;
  loginHref: string;
  profileHref: string;
  rulesHref: string;
  characterOptions?: RaidSignupCharacterOption[];
  selectedCharacterKey?: string;
  /** Другий метод запису: клас+спек для тих, у кого немає персонажів. */
  manualClasses?: RaidManualClassOption[];
  title?: string;
};

export type RaidManualClassOption = {
  key: string;
  label: string;
  emoji?: string;
  specs: { key: string; label: string; role: string; roleLabel: string }[];
};

function toastFromResponse(data: unknown, responseOk: boolean): ToastPayload {
  if (data && typeof data === "object" && "toast" in data) {
    const toast = (data as { toast?: ToastPayload }).toast;
    if (toast?.title) return toast;
  }
  if (data && typeof data === "object" && "content" in data) {
    const message = String((data as { content?: unknown }).content || "").trim();
    if (message) return { tone: responseOk ? "success" : "error", title: responseOk ? "Запис оновлено" : "Запис не оновлено", message };
  }
  return responseOk
    ? { tone: "success", title: "Запис оновлено", message: "Склад рейду оновлено." }
    : { tone: "error", title: "Запис не оновлено", message: "Сервер не повернув зрозумілу відповідь." };
}

function actionLabel(action: RaidSignupStatus, busyAction: RaidSignupStatus | null, full: boolean, viewerAlreadyActive: boolean) {
  if (busyAction === action) return "Оновлюємо...";
  if (action === "going") return full && !viewerAlreadyActive ? "✓ У лаву запасних" : viewerAlreadyActive ? "✓ Змінити персонажа" : "✓ Підписатися";
  if (action === "tentative") return "❓ 50/50";
  if (action === "late") return "🕒 Затримаюсь";
  return "↩ Пропустити";
}

export default function RaidAttendanceClient({
  raidId,
  closed,
  full,
  viewerAlreadyActive,
  activeJoinDisabled,
  skipDisabled,
  registrationLocked = false,
  registrationLockMessage = "",
  showRequirement,
  requirementTitle,
  requirementMessage,
  loginHref,
  profileHref,
  rulesHref,
  characterOptions = [],
  selectedCharacterKey = "",
  manualClasses = [],
  title,
}: RaidAttendanceClientProps) {
  const [busyAction, setBusyAction] = useState<RaidSignupStatus | null>(null);
  const [characterKey, setCharacterKey] = useState(selectedCharacterKey || "");
  const [manualClassKey, setManualClassKey] = useState("");
  const [manualSpecKey, setManualSpecKey] = useState("");
  // Ручний метод показуємо лише коли персонажів немає взагалі.
  const manualMode = Boolean(manualClasses.length) && characterOptions.length === 0;
  const manualClass = manualClasses.find((item) => item.key === manualClassKey) || null;
  const manualSpec = manualClass?.specs.find((item) => item.key === manualSpecKey) || null;
  const needsCharacterChoice = characterOptions.length > 0;
  const selectedCharacter = characterOptions.find((item) => item.key === characterKey) || null;
  const activeDisabled = activeJoinDisabled || (needsCharacterChoice && !selectedCharacter);

  useEffect(() => {
    setCharacterKey((current) => {
      if (current && characterOptions.some((item) => item.key === current)) return current;
      return selectedCharacterKey || "";
    });
  }, [characterOptions, selectedCharacterKey]);

  async function submitAttendance(action: RaidSignupStatus) {
    if (busyAction) return;
    if ((action === "going" || action === "tentative" || action === "late") && activeDisabled) return;
    if (action === "skipped" && skipDisabled) return;

    if ((action === "going" || action === "tentative" || action === "late") && needsCharacterChoice && !selectedCharacter) {
      dispatchDashboardToast({
        tone: "warning",
        title: "Вибери персонажа",
        message: "Перед записом на рейд потрібно вибрати, яким персонажем ти йдеш.",
        ttl: 5600,
      });
      return;
    }

    setBusyAction(action);
    dispatchDashboardToast({
      tone: "info",
      title: "Оновлюємо запис",
      message: "Записуємо дію та синхронізуємо склад сайту й Discord.",
      ttl: 3200,
    });

    const formData = new FormData();
    formData.set("action", action);
    if (characterKey) formData.set("characterKey", characterKey);
    if (manualMode && manualClassKey && manualSpecKey) {
      formData.set("classKey", manualClassKey);
      formData.set("specKey", manualSpecKey);
    }

    try {
      const response = await fetch(`/api/raids/${encodeURIComponent(raidId)}/attendance`, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "X-Dashboard-Action": "live",
        },
      });
      const data = await response.json().catch(() => null);
      const toast = toastFromResponse(data, response.ok);

      dispatchDashboardToast({
        tone: toast.tone || (response.ok ? "success" : "error"),
        title: toast.title || (response.ok ? "Запис оновлено" : "Запис не оновлено"),
        message: toast.message,
        ttl: toast.ttl || (response.ok ? 4600 : 8200),
      });

      const loginUrl = data && typeof data === "object" && "loginUrl" in data
        ? String((data as { loginUrl?: unknown }).loginUrl || "")
        : "";
      if (!response.ok && loginUrl) {
        window.setTimeout(() => window.location.assign(loginUrl), 650);
        return;
      }

      if (response.ok) {
        const revision = data && typeof data === "object" && "revision" in data
          ? String((data as { revision?: unknown }).revision || "")
          : "";
        notifyDashboardDataChanged({
          scope: "raids",
          kind: "raid",
          resourceId: raidId,
          raidId,
          revision,
          source: "raid-attendance",
          action,
        });
      }
    } catch {
      dispatchDashboardToast({
        tone: "error",
        title: "Немає відповіді від сервера",
        message: "Перевір інтернет або повтори дію через кілька секунд.",
        ttl: 8200,
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="raid-attendance-stack">
      {registrationLocked && registrationLockMessage ? (
        <div className="raid-action-requirement" role="note">
          <strong>Запис заблоковано</strong>
          <span>{registrationLockMessage}</span>
        </div>
      ) : null}

      {showRequirement ? (
        <div className="raid-action-requirement" role="note">
          <strong>{requirementTitle}</strong>
          <span>{requirementMessage}</span>
          <span className="raid-action-requirement-links">
            <a href={loginHref}>Увійти через Discord</a>
            <a href={profileHref}>Відкрити профіль</a>
            <a href={rulesHref} target="_blank" rel="noreferrer">Правила рейду</a>
          </span>
        </div>
      ) : null}

      {manualMode ? (
        <div className="raid-manual-picker">
          <div className="raid-manual-picker__head">
            <strong>Запис без персонажа Battle.net</strong>
            <small>Обери клас і спек — роль визначиться автоматично. Привʼязати Battle.net можна пізніше в профілі.</small>
          </div>
          <div className="raid-manual-picker__row">
            <label className="field-label">
              Клас
              <select
                className="select"
                value={manualClassKey}
                onChange={(event) => {
                  setManualClassKey(event.target.value);
                  setManualSpecKey("");
                }}
                disabled={closed || registrationLocked || Boolean(busyAction)}
              >
                <option value="">Обери клас</option>
                {manualClasses.map((cls) => (
                  <option key={cls.key} value={cls.key}>{cls.emoji ? `${cls.emoji} ` : ""}{cls.label}</option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Спек
              <select
                className="select"
                value={manualSpecKey}
                onChange={(event) => setManualSpecKey(event.target.value)}
                disabled={!manualClass || closed || registrationLocked || Boolean(busyAction)}
              >
                <option value="">{manualClass ? "Обери спек" : "Спершу клас"}</option>
                {(manualClass?.specs || []).map((spec) => (
                  <option key={spec.key} value={spec.key}>{spec.label}</option>
                ))}
              </select>
            </label>
          </div>
          {manualSpec ? (
            <span className="raid-manual-picker__role">Роль у складі: {manualSpec.roleLabel}</span>
          ) : (
            <small className="raid-manual-picker__hint">Запис стане доступним після вибору класу й спеку.</small>
          )}
        </div>
      ) : null}

      {needsCharacterChoice ? (
        <label className="raid-character-picker">
          <span>Персонаж для запису</span>
          <select className="select" value={characterKey} onChange={(event) => setCharacterKey(event.target.value)} disabled={closed || registrationLocked || Boolean(busyAction)} required>
            <option value="">Змінити персонажа рейду</option>
            {characterOptions.map((character) => (
              <option key={character.key} value={character.key}>{character.label}</option>
            ))}
          </select>
          {selectedCharacter?.meta ? <small>{selectedCharacter.meta}</small> : <small>Автовибір вимкнено: запис почнеться тільки після явного вибору персонажа.</small>}
        </label>
      ) : null}

      <div
        className={`raid-preview-buttons raid-preview-buttons--interactive${busyAction ? " is-submitting" : ""}`}
        aria-disabled={closed || activeDisabled}
        aria-busy={busyAction ? "true" : undefined}
      >
        <button
          className="raid-action raid-action--go"
          type="button"
          disabled={activeDisabled || Boolean(busyAction)}
          title={title}
          onClick={() => submitAttendance("going")}
        >
          {actionLabel("going", busyAction, full, viewerAlreadyActive)}
        </button>
        <button
          className="raid-action raid-action--maybe"
          type="button"
          disabled={activeDisabled || Boolean(busyAction)}
          title={title}
          onClick={() => submitAttendance("tentative")}
        >
          {actionLabel("tentative", busyAction, full, viewerAlreadyActive)}
        </button>
        <button
          className="raid-action raid-action--skip"
          type="button"
          disabled={skipDisabled || Boolean(busyAction)}
          title={skipDisabled ? title : undefined}
          onClick={() => submitAttendance("skipped")}
        >
          {actionLabel("skipped", busyAction, full, viewerAlreadyActive)}
        </button>
        <button
          className="raid-action raid-action--late"
          type="button"
          disabled={activeDisabled || Boolean(busyAction)}
          title={title}
          onClick={() => submitAttendance("late")}
        >
          {actionLabel("late", busyAction, full, viewerAlreadyActive)}
        </button>
      </div>
    </div>
  );
}
