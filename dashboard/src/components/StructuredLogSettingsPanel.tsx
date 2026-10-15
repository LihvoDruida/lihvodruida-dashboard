"use client";

import { useEffect, useRef, useState } from "react";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useActionFocus } from "@/lib/useActionFocus";
import { confirmLogSettingsSave, confirmSecurityMirrorTest, logSettingsDraft, parseLogSettingsSnapshot, sameLogSettingsChoice, validLogSettingsDraft, type LogSettingsDraft, type LogSettingsSnapshot } from "@/lib/logSettingsView";
import type { StructuredLogSettings } from "@/lib/logSettings";
import styles from "@/app/dashboard/logs/logs.module.css";

export default function StructuredLogSettingsPanel({ initialSettings, canEdit, canTuneStorage, configured = true, initialError = "" }: {
  initialSettings: StructuredLogSettings; canEdit: boolean; canTuneStorage: boolean; configured?: boolean; initialError?: string;
}) {
  const [state, setState] = useState<LogSettingsSnapshot>({ settings: initialSettings, configured, canEdit, canTuneStorage });
  const [draft, setDraft] = useState(() => logSettingsDraft(initialSettings));
  const [pending, setPending] = useState<"save" | "test" | "read" | null>(null);
  const [notice, setNotice] = useState(""); const [error, setError] = useState(initialError);
  const [readNotice, setReadNotice] = useState(""); const [loadError, setLoadError] = useState("");
  const [uncertain, setUncertain] = useState(Boolean(initialError));
  const requests = useDashboardRequests();
  const busy = pending !== null;
  const saved = state.settings;
  const changed = !sameLogSettingsChoice(draft, logSettingsDraft(saved), state.canTuneStorage);
  const dirtyRef = useRef(changed); dirtyRef.current = changed;
  const editable = state.canEdit && state.configured;
  const ready = editable && changed && !uncertain && validLogSettingsDraft(draft, state.canTuneStorage);
  const testReady = editable && !changed && !uncertain && saved.securityDiscordEnabled && Boolean(saved.securityDiscordChannelId);
  const actionFocus = useActionFocus<HTMLFormElement>(pending === "save" || pending === "test");
  const readFocus = useActionFocus<HTMLDivElement>(pending === "read");
  const initialKey = JSON.stringify(initialSettings);
  useEffect(() => {
    setState(current => ({ ...current, configured, canEdit, canTuneStorage }));
    if (requests.pending("action")) return;
    const settings = JSON.parse(initialKey) as StructuredLogSettings;
    setState({ settings, configured, canEdit, canTuneStorage });
    setUncertain(Boolean(initialError));
    if (!dirtyRef.current) setDraft(logSettingsDraft(settings));
  }, [initialKey, configured, canEdit, canTuneStorage, initialError]);
  function patch<K extends keyof LogSettingsDraft>(key: K, value: LogSettingsDraft[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }
  function applySnapshot(next: LogSettingsSnapshot) {
    setState(next);
    if (!dirtyRef.current) setDraft(logSettingsDraft(next.settings));
  }
  async function read(signal: AbortSignal) {
    return parseLogSettingsSnapshot(await dashboardApiJson<unknown>("/api/dashboard/logs/settings", { signal, timeoutMs: 12_000, retries: 0 }));
  }
  async function load(trigger: HTMLElement) {
    if (requests.pending("action")) return;
    readFocus.beginActionFocus(trigger, { preferResult: true });
    const request = requests.begin("action", 15_000);
    setPending("read"); setReadNotice(""); setLoadError("");
    try {
      const next = await read(request.signal);
      if (!request.current()) return;
      applySnapshot(next); setUncertain(false);
      if (initialError) setError(current => current === initialError ? "" : current);
      setReadNotice("Збережені налаштування оновлено. Поточний вибір у формі збережено.");
    } catch (cause) { if (request.current()) setLoadError(cause instanceof Error ? cause.message : "Не вдалося прочитати налаштування."); }
    finally { if (request.current()) setPending(null); request.finish(); }
  }
  async function save(trigger: HTMLElement | null) {
    if (!ready || requests.pending("action")) return;
    if (trigger) actionFocus.beginActionFocus(trigger, { preferResult: true });
    const request = requests.begin("action", 40_000);
    const attempted = { ...draft };
    const tuneStorage = state.canTuneStorage;
    setPending("save"); setNotice(""); setError("");
    const body = new URLSearchParams({ ...attempted, securityDiscordEnabled: attempted.securityDiscordEnabled ? "1" : "0" });
    try {
      const result = await dashboardApiJson<unknown>("/api/dashboard/logs/settings", { method: "POST", body, headers: { "X-Dashboard-Action": "live" }, signal: request.signal, timeoutMs: 20_000, retries: 0 });
      if (!request.current()) return;
      const settings = confirmLogSettingsSave(result, attempted, tuneStorage);
      setState(current => ({ ...current, settings })); setDraft(logSettingsDraft(settings)); setUncertain(false);
      setNotice("Налаштування журналу збережено.");
    } catch (cause) {
      if (!request.current()) return;
      if (cause instanceof ApiHttpError && [401,403,413,415,422,428,429].includes(cause.status)) setError(cause.message);
      else {
        setNotice("Перевіряємо збережений стан. Зміну автоматично не повторюємо.");
        try {
          const current = await read(request.signal);
          if (!request.current()) return;
          applySnapshot(current); setUncertain(false); setLoadError("");
          const matches = current.configured && current.settings.source === "database" && sameLogSettingsChoice(logSettingsDraft(current.settings), attempted, tuneStorage);
          const reason = cause instanceof ApiHttpError && cause.status < 500 ? `${cause.message} ` : "";
          setNotice(matches ? "Збережені налаштування відповідають вибраним. Повторне збереження не потрібне." : `${reason}Збережений стан прочитано. Попередню зміну не підтверджено; чернетку залишено у формі.`);
        } catch {
          if (request.current()) { setNotice(""); setUncertain(true); setError("Збереження не підтверджено. Онови налаштування перед наступною зміною; чернетку збережено."); }
        }
      }
    } finally { if (request.current()) setPending(null); request.finish(); }
  }
  async function testDiscord(trigger: HTMLElement) {
    if (!testReady || requests.pending("action")) return;
    actionFocus.beginActionFocus(trigger, { preferResult: true });
    const request = requests.begin("action", 15_000);
    setPending("test"); setNotice(""); setError("");
    try {
      const result = await dashboardApiJson<unknown>("/api/dashboard/logs/security-test", { method: "POST", headers: { "X-Dashboard-Action": "live" }, signal: request.signal, timeoutMs: 12_000, retries: 0 });
      if (!request.current()) return;
      if (!confirmSecurityMirrorTest(result, saved.securityDiscordChannelId)) throw new Error("Unconfirmed Discord receipt");
      setNotice("Тестове Security-повідомлення доставлено у збережений канал Discord.");
    } catch (cause) {
      if (!request.current()) return;
      const body = cause instanceof ApiHttpError && cause.body && typeof cause.body === "object" ? cause.body as Record<string, unknown> : null;
      const rejected = ["settings_unavailable", "security_mirror_disabled", "security_channel_missing", "discord_bot_token_missing", "below_min_level"].includes(String(body?.reason)) || typeof body?.status === "number" && body.status >= 400 && body.status < 500;
      if (cause instanceof ApiHttpError && (rejected || [401,403,413,422,429].includes(cause.status))) setError(cause.message);
      else setError("Доставку тесту не підтверджено. Перевір канал Discord перед новою спробою: повідомлення могло бути надіслане. Автоматичного повтору немає.");
    } finally { if (request.current()) setPending(null); request.finish(); }
  }
  return (
    <section className={styles.settingsPanel} aria-busy={busy} aria-label="Налаштування журналу">
      <div className={styles.settingsHeader}>
        <div>
          <span className={styles.sectionEyebrow}>Security → Discord</span>
          <h2>Зберігання та Security mirror</h2>
          <p>
            Основний журнал зберігається тільки у PostgreSQL. Discord отримує лише Security-події,
            якщо дзеркало увімкнене.
          </p>
        </div>
        <div className={styles.settingsStatusBlock}>
          <span className={`${styles.mirrorStatus} ${!uncertain && saved.securityDiscordEnabled ? styles.mirrorEnabled : styles.mirrorDisabled}`}>
            <i /> {uncertain ? "Стан потребує перевірки" : saved.securityDiscordEnabled ? "Security mirror увімкнено" : "Security mirror вимкнено"}
          </span>
          <small>{saved.source === "database" ? "Налаштування: PostgreSQL" : "Налаштування: ENV defaults"}</small>
        </div>
      </div>

      <form ref={actionFocus.scopeRef} className={styles.settingsForm} data-toast-managed="true" data-dirty={changed ? "true" : "false"} data-submitting={busy ? "true" : "false"} onSubmit={event => { event.preventDefault(); void save((event.nativeEvent as SubmitEvent).submitter); }}>
        {!state.configured ? <p className={styles.error} role="alert">PostgreSQL для журналу не налаштований. Збереження й тест недоступні.</p> : null}
        {changed ? <p className={styles.storageNote}>Є незбережені зміни. Індикатор і ліміти показують збережений стан.</p> : null}
        {changed && !validLogSettingsDraft(draft, state.canTuneStorage) ? <p className={styles.error} role="alert">Перевір ID каналу (16–25 цифр) і цілі ліміти: 32–1024 МБ, 5 000–250 000 записів та 50–500 рядків у браузері.</p> : null}
        <div className={styles.settingsLayout}>
          <div className={styles.settingsPrimary}>
            <div className={styles.settingsSectionTitle}>
              <div><strong>Discord Security</strong><small>Єдина категорія, яку дозволено дублювати за межі VPS.</small></div>
            </div>

            <label className={styles.switchRow}>
              <span>
                <strong>Дублювати Security у Discord</strong>
                <small>API, Action, Auth, Database, Integration, Discord та System залишаються тільки на сервері.</small>
              </span>
              <input
                type="checkbox"
                checked={draft.securityDiscordEnabled}
                onChange={(event) => patch("securityDiscordEnabled", event.target.checked)}
                disabled={!editable || busy}
              />
            </label>

            <div className={styles.formGrid2}>
              <label className={styles.field}>
                <span>Security channel ID</span>
                <input
                  name="securityDiscordChannelId"
                  inputMode="numeric"
                  pattern="[0-9]{16,25}"
                  maxLength={25}
                  autoComplete="off"
                  value={draft.securityDiscordChannelId}
                  onChange={(event) => patch("securityDiscordChannelId", event.target.value)}
                  placeholder="123456789012345678"
                  disabled={!editable || busy}
                />
                <small>Боту потрібні View Channel, Send Messages та Embed Links.</small>
              </label>
              <label className={styles.field}>
                <span>Мінімальний рівень</span>
                <select
                  name="securityDiscordMinLevel"
                  value={draft.securityDiscordMinLevel}
                  onChange={(event) => patch("securityDiscordMinLevel", event.target.value as LogSettingsDraft["securityDiscordMinLevel"])}
                  disabled={!editable || busy}
                >
                  <option value="info">Info, Warning і Error</option>
                  <option value="warning">Warning і Error</option>
                  <option value="error">Тільки Error</option>
                </select>
                <small>Фільтр діє тільки для Security mirror.</small>
              </label>
            </div>

            <div className={styles.settingsActions}>
              <button className="btn primary" type="submit" disabled={!ready || busy}>
                {pending === "save" ? "Зберігаємо…" : "Зберегти налаштування"}
              </button>
              <button className="btn" type="button" onClick={event => void testDiscord(event.currentTarget)} disabled={!testReady || busy}>
                {pending === "test" ? "Перевіряємо…" : "Надіслати тест у Discord"}
              </button>
            </div>
            <p className={styles.storageNote}>Тест використовує збережений канал. Спочатку збережи зміни; тест надсилається лише після натискання кнопки.</p>
            <p role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="" className={styles.settingsResult}>{pending === "save" ? "Зберігаємо налаштування…" : pending === "test" ? "Чекаємо підтвердження Discord…" : error ? "Дію не завершено." : notice}</p>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {uncertain ? <p className={styles.storageNote}>Перед наступним збереженням онови налаштування. Чернетка залишиться у формі.</p> : null}
            <div ref={readFocus.scopeRef} className={styles.settingsRead}>
              <button className="btn subtle" type="button" disabled={busy} onClick={event => void load(event.currentTarget)}>{pending === "read" ? "Оновлюємо…" : "Оновити налаштування"}</button>
              <p role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="" className={styles.settingsResult}>{pending === "read" ? "Читаємо збережені налаштування…" : loadError ? "Не вдалося оновити налаштування. Чернетку збережено." : readNotice}</p>
              {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
            </div>
          </div>

          <aside className={styles.storageCard}>
            <div className={styles.settingsSectionTitle}>
              <div><strong>Ліміт локального журналу</strong><small>Жорсткі межі для VPS; retention завжди 3 дні.</small></div>
            </div>
            <div className={styles.storageFacts}>
              <span><small>Retention</small><strong>3 дні</strong></span>
              <span><small>Storage</small><strong>{saved.maxStorageMb} МБ</strong></span>
              <span><small>Max rows</small><strong>{saved.maxRows.toLocaleString("uk-UA")}</strong></span>
              <span><small>Browser</small><strong>{saved.queryLimit}</strong></span>
            </div>
            <div className={styles.storageFields}>
              <label className={styles.field}>
                <span>Ліміт таблиці, МБ</span>
                <input type="number" name="maxStorageMb" min="32" max="1024" step="1" value={draft.maxStorageMb}
                  onChange={(event) => patch("maxStorageMb", event.target.value)} disabled={!state.canTuneStorage || !editable || busy} />
              </label>
              <label className={styles.field}>
                <span>Максимум записів</span>
                <input type="number" name="maxRows" min="5000" max="250000" step="1" value={draft.maxRows}
                  onChange={(event) => patch("maxRows", event.target.value)} disabled={!state.canTuneStorage || !editable || busy} />
              </label>
              <label className={styles.field}>
                <span>Рядків у браузері</span>
                <input type="number" name="queryLimit" min="50" max="500" step="1" value={draft.queryLimit}
                  onChange={(event) => patch("queryLimit", event.target.value)} disabled={!state.canTuneStorage || !editable || busy} />
              </label>
            </div>
            <p className={styles.storageNote}>
              Після перевищення row/storage budget maintenance видаляє найстаріші записи. Volumes, БД інших модулів і Docker cache це не зачіпає.
            </p>
          </aside>
        </div>
      </form>
    </section>
  );
}
