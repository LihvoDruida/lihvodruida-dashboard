"use client";

import { useEffect, useRef, useState } from "react";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";

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
    return () => { if (dialog?.open) dialog.close(); };
  }, [open]);
  useEffect(() => {
    if (selectedCharacterKey && characterOptions.some((item) => item.key === selectedCharacterKey)) setCharacterKey(selectedCharacterKey);
  }, [selectedCharacterKey, characterOptions]);
  useEffect(() => {
    if (!open || showRequirement) return;
    const controller = new AbortController();
    setPreferenceState("loading");
    fetch("/api/raids/reminder-preference", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("preference_failed");
        const data = await response.json();
        if (typeof data?.enabled !== "boolean") throw new Error("invalid_preference");
        setReminderEnabled(data.enabled);
        setPreferenceState("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setPreferenceState("failed"); });
    return () => controller.abort();
  }, [open, showRequirement]);

  function closeModal() {
    if (busy) return;
    dialogRef.current?.close();
    setOpen(false);
  }

  async function submitAttendance() {
    if (cannotSubmit || busy) return;
    setBusy(true);
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
      const response = await fetch(`/api/raids/${encodeURIComponent(raidId)}/attendance`, {
        method: "POST", body: formData, credentials: "same-origin", cache: "no-store",
        headers: { Accept: "application/json", "X-Dashboard-Action": "live" },
      });
      const data = await response.json().catch(() => null);
      const toast = toastFromResponse(data, response.ok);
      dispatchDashboardToast({ tone: toast.tone || (response.ok ? "success" : "error"),
        title: toast.title || "Запис у рейд", message: toast.message,
        ttl: toast.ttl || (response.ok ? 4600 : 8200) });
      const loginUrl = data && typeof data === "object" && "loginUrl" in data
        ? String((data as { loginUrl?: unknown }).loginUrl || "") : "";
      if (!response.ok && loginUrl) { window.location.assign(loginUrl); return; }
      if (response.ok) {
        closeModalAfterSave();
        const revision = data && typeof data === "object" && "revision" in data
          ? String((data as { revision?: unknown }).revision || "") : "";
        notifyDashboardDataChanged({ scope: "raids", kind: "raid", resourceId: raidId,
          raidId, revision, source: "raid-attendance", action: status });
      }
    } catch {
      dispatchDashboardToast({ tone: "error", title: "Немає відповіді від сервера",
        message: "Перевір підключення та повтори запис.", ttl: 8200 });
    } finally { setBusy(false); }
  }
  function closeModalAfterSave() {
    dialogRef.current?.close();
    setOpen(false);
  }

  return (
    <div className="raid-attendance-stack">
      <div className="raid-signup-launcher">
        <button className="raid-action raid-action--go raid-signup-launcher__button" type="button"
          disabled={closed || registrationLocked} title={title} onClick={() => setOpen(true)}>
          {viewerAlreadyActive ? "✎ Змінити запис" : full ? "✓ Записатися до запасу" : "✓ Записатися в рейд"}
        </button>
        {registrationLocked && registrationLockMessage ? <small role="note">{registrationLockMessage}</small> : null}
      </div>
      {open ? (
        <dialog ref={dialogRef} className="raid-signup-modal" aria-labelledby="raid-signup-modal-title"
          onClose={() => setOpen(false)} onCancel={(event) => { if (busy) event.preventDefault(); }}
          onClick={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <div className="raid-signup-modal__panel">
            <header className="raid-signup-modal__header">
              <div><span className="raid-signup-modal__eyebrow">Mistblossom Vanguard · Рейди</span>
                <h2 id="raid-signup-modal-title">{viewerAlreadyActive ? "Змінити запис на рейд" : "Записатися в рейд"}</h2>
                <p>Обери, ким і як береш участь. Усі зміни збережуться на сайті й у Discord.</p></div>
              <button type="button" className="btn btn-icon raid-signup-modal__close" onClick={closeModal} disabled={busy} aria-label="Закрити форму">×</button>
            </header>
            {showRequirement ? (
              <div className="raid-action-requirement" role="note"><strong>{requirementTitle}</strong><span>{requirementMessage}</span>
                <span className="raid-action-requirement-links"><a href={loginHref}>Увійти через Discord</a>
                  <a href={profileHref}>Профіль</a><a href={rulesHref} target="_blank" rel="noreferrer">Правила рейду</a></span></div>
            ) : (
              <form className="raid-signup-modal__form" onSubmit={(event) => { event.preventDefault(); void submitAttendance(); }}>
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
                  {preferenceState === "loading" ? <small>Завантажуємо твоє налаштування…</small> : null}
                  {preferenceState === "failed" ? <div className="raid-signup-modal__error" role="alert">Не вдалося отримати налаштування нагадувань. Закрий і відкрий форму знову, щоб уникнути його випадкової зміни.</div> : null}
                </div>
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
