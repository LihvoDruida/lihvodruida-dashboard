"use client";

import { useEffect, useId, useRef, useState } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useActionFocus } from "@/lib/useActionFocus";

type RaidSignupStatus = "going" | "tentative" | "late" | "skipped";
type RaidRole = "tank" | "healer" | "dps";
type ToastPayload = { tone?: "info" | "success" | "warning" | "error"; title?: string; message?: string; ttl?: number };
export type RaidSignupCharacterOption = { key: string; label: string; meta?: string };
export type RaidManualClassOption = {
  key: string; label: string; emoji?: string;
  specs: { key: string; label: string; role: string; roleLabel: string }[];
};
type Props = {
  raidId: string; closed: boolean; full: boolean; viewerAlreadyActive: boolean;
  activeJoinDisabled: boolean; skipDisabled: boolean;
  registrationLocked?: boolean; registrationLockMessage?: string;
  showRequirement: boolean; requirementTitle: string; requirementMessage: string;
  loginHref: string; profileHref: string; rulesHref: string;
  characterOptions?: RaidSignupCharacterOption[]; selectedCharacterKey?: string;
  selectedStatus?: RaidSignupStatus; selectedRole?: RaidRole;
  selectedManualClassKey?: string; selectedManualSpecKey?: string;
  manualClasses?: RaidManualClassOption[]; title?: string;
};
const ATTENDANCE: { value: RaidSignupStatus; label: string; detail: string }[] = [
  { value: "going", label: "Буду", detail: "Підтверджую участь" },
  { value: "tentative", label: "50/50", detail: "Ще не впевнений" },
  { value: "late", label: "Затримаюсь", detail: "Приєднаюсь пізніше" },
  { value: "skipped", label: "Пропускаю", detail: "Не беру участі" },
];
const ROLES: { value: RaidRole; label: string }[] = [
  { value: "tank", label: "🛡️ Танк" }, { value: "healer", label: "💚 Хіл" }, { value: "dps", label: "⚔️ ДД" },
];
function toastFromResponse(data: unknown, responseOk: boolean): ToastPayload {
  if (data && typeof data === "object" && "toast" in data) {
    const toast = (data as { toast?: ToastPayload }).toast;
    if (toast?.title) return toast;
  }
  return responseOk
    ? { tone: "success", title: "Запис оновлено", message: "Склад рейду оновлено." }
    : { tone: "error", title: "Запис не оновлено", message: "Помилка збереження. Спробуй ще раз." };
}

export default function RaidAttendanceClient({
  raidId, closed, full, viewerAlreadyActive, activeJoinDisabled, skipDisabled,
  registrationLocked = false, registrationLockMessage = "", showRequirement,
  requirementTitle, requirementMessage, loginHref, profileHref, rulesHref,
  characterOptions = [], selectedCharacterKey = "", selectedStatus = "going", selectedRole = "dps",
  selectedManualClassKey = "", selectedManualSpecKey = "", manualClasses = [], title,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogId = useId();
  const requests = useDashboardRequests();
  const submitLock = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"character" | "manual">(selectedManualClassKey ? "manual" : characterOptions.length ? "character" : "manual");
  const [status, setStatus] = useState<RaidSignupStatus>(selectedStatus);
  const [characterKey, setCharacterKey] = useState(selectedCharacterKey);
  const [manualClassKey, setManualClassKey] = useState(selectedManualClassKey);
  const [manualSpecKey, setManualSpecKey] = useState(selectedManualSpecKey);
  const [role, setRole] = useState<RaidRole>(selectedRole);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [preferenceState, setPreferenceState] = useState<"loading" | "ready" | "failed">("loading");
  const [preferenceAttempt, setPreferenceAttempt] = useState(0);
  const [notice, setNotice] = useState("");
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLDivElement>(preferenceState === "loading");
  const manualClass = manualClasses.find((entry) => entry.key === manualClassKey) || null;
  const manualSpec = manualClass?.specs.find((entry) => entry.key === manualSpecKey) || null;
  const selectedCharacter = characterOptions.find((entry) => entry.key === characterKey) || null;
  const cannotSubmit = closed || registrationLocked || busy ||
    (status === "skipped" ? skipDisabled : activeJoinDisabled) ||
    (status !== "skipped" && (mode === "character" ? !selectedCharacter : !manualSpec)) ||
    (preferenceState !== "ready" && !showRequirement);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    titleRef.current?.focus({ preventScroll: true });
    return () => { if (dialog?.open) dialog.close(); };
  }, [open]);
  useEffect(() => {
    if (!open || showRequirement) return;
    const lane = requests.begin("raid-reminder-read", 12_000);
    setPreferenceState("loading");
    dashboardApiJson<{ enabled: boolean }>("/api/raids/reminder-preference", { signal: lane.signal, timeoutMs: 12_000, retries: 0 })
      .then((data) => {
        if (!lane.current()) return;
        if (typeof data?.enabled !== "boolean") throw new Error("invalid_preference");
        setReminderEnabled(data.enabled);
        setPreferenceState("ready");
      })
      .catch(() => { if (lane.current()) setPreferenceState("failed"); })
      .finally(() => lane.finish());
    return () => lane.abort();
  }, [open, showRequirement, preferenceAttempt]);

  function openModal() {
    setMode(selectedManualClassKey ? "manual" : characterOptions.length ? "character" : "manual");
    setCharacterKey(selectedCharacterKey);
    setManualClassKey(selectedManualClassKey);
    setManualSpecKey(selectedManualSpecKey);
    setStatus(selectedStatus);
    setRole(selectedRole);
    setPreferenceState("loading");
    setNotice("");
    setOpen(true);
  }

  function closeModal() {
    if (busy) return;
    dialogRef.current?.close();
    setOpen(false);
  }

  async function submitAttendance() {
    if (cannotSubmit || submitLock.current) return;
    submitLock.current = true;
    const lane = requests.begin("raid-attendance-write", 25_000);
    setBusy(true);
    setNotice("");
    const formData = new FormData();
    formData.set("action", status);
    if (status !== "skipped") {
      if (mode === "character") {
        formData.set("characterKey", characterKey);
        formData.set("signupRole", role);
      } else {
        formData.set("classKey", manualClassKey);
        formData.set("specKey", manualSpecKey);
      }
    }
    formData.set("reminderEnabled", String(reminderEnabled));
    try {
      const data = await dashboardApiJson<{ ok: boolean; revision?: string; toast?: ToastPayload }>(`/api/raids/${encodeURIComponent(raidId)}/attendance`, {
        method: "POST", body: formData, credentials: "same-origin", cache: "no-store",
        headers: { Accept: "application/json", "X-Dashboard-Action": "live" },
        signal: lane.signal, timeoutMs: 25_000, retries: 0,
      });
      if (!lane.current()) return;
      // A redirect to an HTML login page can also end with HTTP 200.
      if (data?.ok !== true) throw new Error("unconfirmed_attendance");
      const toast = toastFromResponse(data, true);
      dispatchDashboardToast({ tone: toast.tone || "success", title: toast.title || "Запис у рейд",
        message: toast.message, ttl: toast.ttl || 4600 });
      closeModalAfterSave();
      notifyDashboardDataChanged({ scope: "raids", kind: "raid", resourceId: raidId,
        raidId, revision: typeof data.revision === "string" ? data.revision : "", source: "raid-attendance", action: status });
    } catch (error) {
      if (!lane.current()) return;
      const toast = error instanceof ApiHttpError ? toastFromResponse(error.body, false) : {
        tone: "warning" as const, title: "Запис ще не підтверджено",
        message: "Відповідь не отримано або не розпізнано. Вибір залишився у формі. Закрий її та перевір свій запис у складі рейду перед повторною дією.",
      };
      setNotice(toast.message || toast.title || "Запис не підтверджено.");
      dispatchDashboardToast({ ...toast, title: toast.title || "Запис не оновлено", ttl: toast.ttl || 8200 });
      const body = error instanceof ApiHttpError ? error.body as { loginUrl?: unknown } | null : null;
      if (body && typeof body.loginUrl === "string") {
        try {
          const login = new URL(body.loginUrl, window.location.origin);
          if (login.origin === window.location.origin && login.pathname === "/login") window.location.assign(login.href);
        } catch { /* Keep the draft if an intermediary returned an invalid destination. */ }
      }
    } finally {
      if (lane.current()) setBusy(false);
      submitLock.current = false;
      lane.finish();
    }
  }
  function closeModalAfterSave() {
    dialogRef.current?.close();
    setOpen(false);
  }

  return (
    <div ref={scopeRef} className="raid-attendance-stack">
      <div className="raid-signup-launcher">
        <button className="raid-action raid-action--go raid-signup-launcher__button" type="button"
          disabled={closed || registrationLocked} title={title} onClick={openModal}>
          {viewerAlreadyActive ? "✎ Змінити запис" : full ? "✓ Записатися до запасу" : "✓ Записатися в рейд"}
        </button>
        {registrationLocked && registrationLockMessage ? <small role="note">{registrationLockMessage}</small> : null}
      </div>
      {open ? (
        <dialog ref={dialogRef} className="raid-signup-modal" aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`}
          onClose={() => setOpen(false)} onCancel={(event) => { if (busy) event.preventDefault(); }}
          onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <div className="raid-signup-modal__panel">
            <header className="raid-signup-modal__header">
              <div><span className="raid-signup-modal__eyebrow">Mistblossom Vanguard · Рейди</span>
                <h2 ref={titleRef} id={`${dialogId}-title`} data-workflow-title tabIndex={-1}>{viewerAlreadyActive ? "Змінити запис на рейд" : "Записатися в рейд"}</h2>
                <p id={`${dialogId}-description`}>Обери, ким і як береш участь. Усі зміни збережуться на сайті й у Discord.</p></div>
              <button type="button" className="btn btn-icon raid-signup-modal__close" onClick={closeModal} disabled={busy} aria-label="Закрити форму">×</button>
            </header>
            {showRequirement ? (
              <div className="raid-action-requirement" role="note"><strong>{requirementTitle}</strong><span>{requirementMessage}</span>
                <span className="raid-action-requirement-links"><a href={loginHref}>Увійти через Discord</a>
                  <a href={profileHref}>Профіль</a><a href={rulesHref} target="_blank" rel="noreferrer">Правила рейду</a></span></div>
            ) : (
              <form className="raid-signup-modal__form" data-dirty="true" data-submitting={busy ? "true" : undefined} aria-busy={busy}
                onSubmit={(event) => { event.preventDefault(); void submitAttendance(); }}>
                <div className="raid-signup-modal__section">
                  <strong>1. Спосіб запису</strong>
                  <div className="raid-signup-modal__tabs" role="group" aria-label="Спосіб запису">
                    <button type="button" aria-pressed={mode === "character"} className={`btn ${mode === "character" ? "is-active" : ""}`}
                      disabled={busy || !characterOptions.length} onClick={() => setMode("character")}>Мої персонажі</button>
                    <button type="button" aria-pressed={mode === "manual"} className={`btn ${mode === "manual" ? "is-active" : ""}`}
                      disabled={busy} onClick={() => setMode("manual")}>Клас і спеціалізація</button>
                  </div>
                  {mode === "character" ? (
                    <div className="raid-signup-modal__fields">
                      <label className="field-label">Персонаж
                        <select className="select" value={characterKey} onChange={(event) => setCharacterKey(event.target.value)} disabled={busy}>
                          <option value="">Обери персонажа</option>
                          {characterOptions.map((character) => <option key={character.key} value={character.key}>{character.label}</option>)}
                        </select>
                        {selectedCharacter?.meta ? <small>{selectedCharacter.meta}</small> : null}
                      </label>
                      <label className="field-label">Роль у рейді
                        <select className="select" value={role} onChange={(event) => setRole(event.target.value as RaidRole)} disabled={busy}>
                          {ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                        </select>
                      </label>
                    </div>
                  ) : (
                    <div className="raid-signup-modal__fields">
                      <label className="field-label">Клас
                        <select className="select" value={manualClassKey} onChange={(event) => { setManualClassKey(event.target.value); setManualSpecKey(""); }} disabled={busy}>
                          <option value="">Обери клас</option>
                          {manualClasses.map((item) => <option key={item.key} value={item.key}>{item.emoji ? `${item.emoji} ` : ""}{item.label}</option>)}
                        </select>
                      </label>
                      <label className="field-label">Спеціалізація
                        <select className="select" value={manualSpecKey} onChange={(event) => setManualSpecKey(event.target.value)} disabled={busy || !manualClass}>
                          <option value="">{manualClass ? "Обери спеціалізацію" : "Спершу обери клас"}</option>
                          {manualClass?.specs.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                        </select>
                        {manualSpec ? <small>Роль: {manualSpec.roleLabel}</small> : null}
                      </label>
                    </div>
                  )}
                </div>
                <fieldset className="raid-signup-modal__section raid-signup-modal__attendance">
                  <legend>2. Участь у рейді</legend>
                  <div className="raid-signup-modal__statuses">
                    {ATTENDANCE.map((item) => <label key={item.value} className={status === item.value ? "is-active" : ""}>
                      <input type="radio" name="raid-status" value={item.value} checked={status === item.value}
                        onChange={() => setStatus(item.value)} disabled={busy || (item.value === "skipped" ? skipDisabled : false)} />
                      <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                    </label>)}
                  </div>
                </fieldset>
                <div className="raid-signup-modal__section raid-signup-modal__reminder">
                  <strong>3. Нагадування</strong>
                  <label><input type="checkbox" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)}
                    disabled={busy || preferenceState !== "ready"} /><span>Нагадати в особисті Discord за 15 хвилин до рейду
                      <small>Налаштування збережеться для наступних рейдів і твого профілю.</small></span></label>
                  <small data-action-result tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{preferenceState === "loading" ? "Завантажуємо твоє налаштування…" : preferenceState === "ready" ? "Налаштування нагадувань завантажено." : ""}</small>
                  {preferenceState === "failed" ? <div className="raid-signup-modal__error" role="alert">Не вдалося отримати налаштування нагадувань. Твій вибір залишився у формі.
                    <button className="btn ghost" type="button" onClick={(event) => { beginActionFocus(event.currentTarget); setPreferenceState("loading"); setPreferenceAttempt((attempt) => attempt + 1); }}>Повторити завантаження</button>
                  </div> : null}
                </div>
                {notice ? <div className="raid-signup-modal__error" role="alert">{notice}</div> : null}
                <footer className="raid-signup-modal__footer">
                  <button className="btn ghost" type="button" onClick={closeModal} disabled={busy}>Скасувати</button>
                  <button className="raid-action raid-action--go" type="submit" disabled={cannotSubmit}>
                    {busy ? "Зберігаємо…" : status === "skipped" ? "Підтвердити пропуск" : viewerAlreadyActive ? "Зберегти зміни" : "Підтвердити запис"}
                  </button>
                </footer>
              </form>
            )}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
