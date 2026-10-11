"use client";

import { useEffect, useRef, useState } from "react";
import { DISCORD_CLEANUP_PERIODS, type DiscordCleanupPeriod } from "@/lib/discordCleanupPolicy";
import type { CleanupTab, DiscordCleanupRow, DiscordCleanupSettings, DiscordCleanupState } from "@/lib/discordMemberCleanup";

type Page = { rows: DiscordCleanupRow[]; cursor: string | null; scanId: string | null; stale?: boolean };
type RoleOption = { id: string; name: string; blockedReason: string | null };
type Props = { initial: { settings: DiscordCleanupSettings; state: DiscordCleanupState; page: Page }; roles: RoleOption[]; canConfigure: boolean; warning: string | null };
const API = "/api/dashboard/discord/member-cleanup";
function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Невідомо";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function elapsed(joinedAt: string | null, until: string | null, now: number) {
  if (!joinedAt) return "Дата невідома";
  const days = Math.max(0, Math.floor(((until ? Date.parse(until) : now) - Date.parse(joinedAt)) / 86_400_000));
  return `${days.toLocaleString("uk-UA")} діб`;
}
async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || data.toast?.message || "Запит не виконано.");
  return data;
}
export default function DiscordMemberCleanupPanel({ initial, roles, canConfigure, warning }: Props) {
  const [settings, setSettings] = useState(initial.settings);
  const [state, setState] = useState(initial.state);
  const [page, setPage] = useState<Page>(initial.page);
  const [tab, setTab] = useState<CleanupTab>("candidates");
  const [roleId, setRoleId] = useState(initial.settings.roleId);
  const [period, setPeriod] = useState<DiscordCleanupPeriod>(initial.settings.period);
  const [enabled, setEnabled] = useState(initial.settings.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const generation = useRef(0);
  const currentTab = useRef<CleanupTab>("candidates");
  const loading = useRef(false);
  async function load(nextTab: CleanupTab, more = false, quiet = false) {
    if (loading.current) return;
    loading.current = true;
    const requestId = ++generation.current;
    setBusy(true);
    if (!quiet) setError(null);
    try {
      const params = new URLSearchParams({ tab: nextTab });
      if (more && page.cursor) params.set("cursor", page.cursor);
      if (more && page.scanId) params.set("scanId", page.scanId);
      let data = await jsonRequest(`${API}?${params}`);
      if (data.page.stale) data = await jsonRequest(`${API}?tab=${nextTab}`);
      // Live refresh keeps the number of rows the administrator expanded.
      // Every request remains bounded to 25; a new scan resets its cursors.
      if (quiet && page.rows.length > 25 && page.scanId === data.page.scanId) {
        const expanded: Page = { ...data.page, rows: [...data.page.rows] };
        while (expanded.cursor && expanded.rows.length < page.rows.length) {
          const nextParams = new URLSearchParams({ tab: nextTab, cursor: expanded.cursor });
          if (expanded.scanId) nextParams.set("scanId", expanded.scanId);
          const nextPage = (await jsonRequest(`${API}?${nextParams}`)).page as Page;
          if (nextPage.stale || nextPage.scanId !== expanded.scanId) break;
          expanded.rows.push(...nextPage.rows);
          expanded.cursor = nextPage.cursor;
        }
        data.page = expanded;
      }
      if (requestId !== generation.current || nextTab !== currentTab.current) return;
      setSettings(data.settings); setState(data.state);
      setPage((previous) => ({ ...data.page, rows: more && !data.page.stale && previous.scanId === data.page.scanId ? [...previous.rows, ...data.page.rows.filter((row: DiscordCleanupRow) => !previous.rows.some((old) => old.id === row.id))] : data.page.rows }));
      setNow(Date.now());
    } catch (failure) {
      if (requestId === generation.current) setError(failure instanceof Error ? failure.message : "Список недоступний.");
    } finally { loading.current = false; setBusy(false); }
  }
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && !loading.current && !busy) void load(currentTab.current, false, true);
    }, 30_000);
    return () => { clearInterval(timer); };
  }, [busy, tab]);
  useEffect(() => () => { generation.current++; }, []);
  function switchTab(next: CleanupTab) {
    if (busy || next === tab) return;
    generation.current++; currentTab.current = next; setTab(next);
    setPage({ rows: [], cursor: null, scanId: null });
    void load(next);
  }
  async function action(kind: "settings" | "scan" | "pause") {
    if (busy || loading.current) return;
    generation.current++; setBusy(true); setError(null); setNotice(null);
    try {
      const data = await jsonRequest(API, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(kind === "settings" ? { action: kind, roleId, period, enabled } : { action: kind }) });
      if (kind === "settings" || kind === "pause") { setSettings(data.settings); setEnabled(data.settings.enabled); setNotice(data.settings.enabled ? "Налаштування збережено. Автоматичне виключення увімкнено." : "Налаштування збережено. Автоматичне виключення призупинено."); }
      else setNotice(data.result.skipped ? "Перевірка вже виконується або ще не налаштована." : data.result.scanning ? "Перевірку розпочато. Решта списку оновиться автоматично." : "Список перевірено й оновлено.");
      await load(currentTab.current);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Дію не виконано."); }
    finally { setBusy(false); }
  }
  const selectedRoleMissing = Boolean(roleId && !roles.some((role) => role.id === roleId));
  return (
    <div className="discord-cleanup">
      <section className="panel discord-cleanup-settings" aria-labelledby="cleanup-settings-title">
        <div className="discord-cleanup-heading">
          <div><span className="eyebrow">Автоматизація Discord</span><h2 id="cleanup-settings-title">Правило очищення</h2></div>
          <span className={`status-pill ${settings.enabled ? "warning" : "good"}`}>{settings.enabled ? "Автоматично" : "На паузі"}</span>
          {settings.enabled && canConfigure ? <button type="button" className="btn subtle" disabled={busy} onClick={() => void action("pause")}>Призупинити</button> : null}
        </div>
        <p className="discord-cleanup-intro">У списку — люди без ролей або з <strong>лише однією вибраною роллю</strong>. Будь-яка додаткова роль захищає від цього правила. Боти ігноруються.</p>
        <form onSubmit={(event) => { event.preventDefault(); void action("settings"); }}>
          <fieldset disabled={!canConfigure || busy}>
            <div className="discord-cleanup-fields">
              <label htmlFor="cleanup-role">Єдина дозволена роль<select id="cleanup-role" value={roleId} onChange={(event) => setRoleId(event.target.value)} required><option value="">Вибери роль</option>{selectedRoleMissing ? <option value={roleId} disabled>{settings.roleName || roleId} — недоступна</option> : null}{roles.map((role) => <option key={role.id} value={role.id} disabled={Boolean(role.blockedReason)}>{role.name}{role.blockedReason ? " — недоступна" : ""}</option>)}</select></label>
              <label htmlFor="cleanup-period">Строк від вступу на сервер<select id="cleanup-period" value={period} onChange={(event) => setPeriod(event.target.value as DiscordCleanupPeriod)}>{DISCORD_CLEANUP_PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
            <label className="discord-cleanup-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>Автоматично виключати після спливу строку</strong><small>Планувальник перевіряє чергу щохвилини. Ролі та дата вступу звіряються перед кожною дією.</small></span></label>
            <div className="discord-cleanup-form-footer"><p>Відлік починається з останнього вступу. Місяці та рік — календарні. Виключення дозволяє повторний вступ за запрошенням.</p><button type="submit" className="btn primary" disabled={!roleId || selectedRoleMissing}>{busy ? "Зберігаю…" : "Зберегти налаштування"}</button></div>
          </fieldset>
        </form>
        {!canConfigure ? <p className="discord-cleanup-note">Налаштовувати автоматичне виключення може власник сервера. Перегляд і перевірка списку доступні адміністраторам з правом керування Discord.</p> : null}
      </section>
      {(warning || state.lastError || error) ? <div className="discord-cleanup-alert" role="alert">{error || state.lastError || warning}</div> : null}
      {notice ? <p className="discord-cleanup-notice" role="status">{notice}</p> : null}
      <section className="discord-cleanup-metrics" aria-label="Результат останньої повної перевірки">
        <div><small>Перевірено учасників</small><strong>{state.checked.toLocaleString("uk-UA")}</strong><span>{state.lastScanAt ? date(state.lastScanAt) : "Повної перевірки ще немає"}</span></div>
        <div><small>Відповідали правилу</small><strong>{state.candidates.toLocaleString("uk-UA")}</strong><span>{state.overdue} зі спливлим строком · {state.blocked} захищено</span></div>
        <div><small>Виключено системою</small><strong>{state.kickedTotal.toLocaleString("uk-UA")}</strong><span>Підтверджені виключення за весь час</span></div>
      </section>
      <section className="panel discord-cleanup-members" aria-labelledby="cleanup-members-title" aria-busy={busy}>
        <div className="discord-cleanup-heading"><div><h2 id="cleanup-members-title">Учасники та історія</h2><p>{state.scan ? `Триває перевірка: ${state.scan.checked} учасників. Поки показуємо останній завершений список.` : "Список оновлюється щогодини. Історія зберігається після перезапуску."}</p></div><button type="button" className="btn subtle" onClick={() => void action("scan")} disabled={busy || !settings.roleId}>{busy ? "Зачекай…" : "Оновити список"}</button></div>
        <div className="discord-cleanup-tabs" role="tablist" aria-label="Списки учасників">
          {([{ id: "candidates", text: "Учасники" }, { id: "kicked", text: "Виключені" }, { id: "uncertain", text: "Потребують уваги" }] as const).map((item) => <button type="button" className="btn subtle" key={item.id} id={`cleanup-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls="cleanup-list" tabIndex={tab === item.id ? 0 : -1} disabled={busy} onClick={() => switchTab(item.id)} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const tabs: CleanupTab[] = ["candidates", "kicked", "uncertain"]; const index = tabs.indexOf(tab); const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3]; switchTab(target); document.getElementById(`cleanup-tab-${target}`)?.focus(); }}>{item.text}{item.id === "uncertain" && state.uncertainTotal > 0 ? ` (${state.uncertainTotal})` : ""}</button>)}
        </div>
        <div id="cleanup-list" role="tabpanel" aria-labelledby={`cleanup-tab-${tab}`} tabIndex={0}>
          {tab === "uncertain" ? <p className="discord-cleanup-note">Запит міг виконатися, але підтвердження перервалося. Система не повторює виключення для цього вступу. Перевір учасника та журнал аудиту Discord за ID спроби.</p> : null}
          {!page.rows.length ? <div className="discord-cleanup-empty"><strong>{busy ? "Завантажую…" : tab === "kicked" ? "Виключень ще немає" : tab === "uncertain" ? "Непідтверджених дій немає" : !settings.roleId ? "Спочатку вибери роль і строк" : state.scan ? "Формуємо список" : "Учасників за цим правилом немає"}</strong><p>{tab === "candidates" ? "Учасники з іншими або додатковими ролями сюди не потрапляють." : "Тут з’являтимуться результати роботи системи."}</p></div> : <ul className="discord-cleanup-list">{page.rows.map((member) => {
            const overdue = member.dueAt && (now || Date.parse(member.checkedAt)) > Date.parse(member.dueAt);
            return <li key={member.id} className="discord-cleanup-member"><div className="discord-cleanup-person"><span className="discord-cleanup-avatar" aria-hidden="true">{Array.from(member.displayName)[0]?.toUpperCase() || "?"}</span><div><strong>{member.displayName}</strong><code>{member.userId}</code></div></div><div className="discord-cleanup-member-info"><span className="discord-cleanup-label">Роль</span><strong>{member.roleName}</strong></div><div className="discord-cleanup-member-info"><span className="discord-cleanup-label">На сервері</span><strong>{elapsed(member.joinedAt, member.kickedAt, now || Date.parse(member.checkedAt))}</strong><small>Вступ: {date(member.joinedAt)}</small></div><div className="discord-cleanup-member-info"><span className="discord-cleanup-label">{tab === "kicked" ? "Виключено" : "Строк спливає"}</span><strong>{date(tab === "kicked" ? member.kickedAt : member.dueAt)}</strong><small className={member.blockedReason || member.lastError ? "is-warning" : ""}>{tab === "kicked" ? "Виключення підтверджено" : member.blockedReason || member.lastError || (overdue ? settings.enabled ? "Очікує автоматичної перевірки" : "Строк сплив · автоматизація на паузі" : "Строк ще не сплив")}</small>{tab === "uncertain" && "attemptId" in member ? <code>Спроба: {String(member.attemptId)}</code> : null}</div></li>;
          })}</ul>}
          <div className="discord-cleanup-list-footer"><span>Показано: {page.rows.length}{page.cursor ? " · є ще" : ""}</span>{page.cursor ? <button type="button" className="btn subtle" disabled={busy} onClick={() => void load(tab, true)}>{busy ? "Завантажую…" : "Показати ще 25"}</button> : null}</div>
        </div>
      </section>
      {state.recentRuns.length ? <details className="panel discord-cleanup-runs"><summary>Останні запуски автоматизації</summary><ul>{state.recentRuns.map((run) => <li key={run.at}><time dateTime={run.at}>{date(run.at)}</time><span>{run.summary}</span></li>)}</ul></details> : null}
    </div>
  );
}
