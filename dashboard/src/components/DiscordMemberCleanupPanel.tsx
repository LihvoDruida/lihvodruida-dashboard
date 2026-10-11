"use client";

import { useEffect, useRef, useState } from "react";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { DISCORD_CLEANUP_PERIODS, type DiscordCleanupPeriod } from "@/lib/discordCleanupPolicy";
import type { CleanupTab, DiscordCleanupRow, DiscordCleanupSettings, DiscordCleanupState, DiscordCleanupExecution } from "@/lib/discordMemberCleanup";

type Page = { rows: DiscordCleanupRow[]; cursor: string | null; scanId: string | null; stale?: boolean };
type RoleOption = { id: string; name: string; blockedReason: string | null };
type Overview = { settings: DiscordCleanupSettings; state: DiscordCleanupState; execution?: DiscordCleanupExecution; page: Page };
type Props = { initial: Overview; roles: RoleOption[]; canConfigure: boolean; warning: string | null };
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
async function readOverview(url: string, signal: AbortSignal) {
  const data = await dashboardApiJson<Overview & { ok: boolean; error?: string }>(url, { signal, timeoutMs: 12_000, retries: 0 });
  if (!data.ok) throw new Error(data.error || "Список недоступний.");
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
  const [loading, setLoading] = useState(false);
  const [mutation, setMutation] = useState<"settings" | "scan" | "pause" | null>(null);
  const [execution, setExecution] = useState(initial.execution);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const requests = useDashboardRequests();
  const currentTab = useRef<CleanupTab>("candidates");
  const pageRef = useRef(page);
  pageRef.current = page;
  async function load(nextTab: CleanupTab, more = false, quiet = false) {
    const request = requests.begin("list", 15_000);
    const previous = pageRef.current;
    setLoading(true);
    if (!quiet) setError(null);
    try {
      const params = new URLSearchParams({ tab: nextTab });
      if (more && previous.cursor) params.set("cursor", previous.cursor);
      if (more && previous.scanId) params.set("scanId", previous.scanId);
      let data = await readOverview(`${API}?${params}`, request.signal);
      const stale = Boolean(data.page.stale);
      if (stale) data = await readOverview(`${API}?tab=${nextTab}`, request.signal);
      // One overall deadline includes every page of an expanded live refresh.
      if (quiet && previous.rows.length > 25 && previous.scanId === data.page.scanId) {
        const expanded: Page = { ...data.page, rows: [...data.page.rows] };
        while (expanded.cursor && expanded.rows.length < previous.rows.length) {
          const nextParams = new URLSearchParams({ tab: nextTab, cursor: expanded.cursor });
          if (expanded.scanId) nextParams.set("scanId", expanded.scanId);
          const nextPage = (await readOverview(`${API}?${nextParams}`, request.signal)).page;
          if (nextPage.stale || nextPage.scanId !== expanded.scanId) break;
          expanded.rows.push(...nextPage.rows);
          expanded.cursor = nextPage.cursor;
        }
        data.page = expanded;
      }
      if (!request.current() || nextTab !== currentTab.current) return null;
      setSettings(data.settings); setState(data.state); setExecution(data.execution);
      setPage({ ...data.page, rows: more && !stale && previous.scanId === data.page.scanId ? [...previous.rows, ...data.page.rows.filter((row) => !previous.rows.some((old) => old.id === row.id))] : data.page.rows });
      setNow(Date.now());
      return data;
    } catch (failure) {
      if (request.current()) setError(failure instanceof ApiHttpError ? failure.message : "Не вдалося оновити список за відведений час. Спробуй оновити його ще раз.");
      return null;
    } finally { if (request.current()) setLoading(false); request.finish(); }
  }
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && !requests.pending("list") && !requests.pending("action")) void load(currentTab.current, false, true);
    }, settings.enabled ? 10_000 : 30_000);
    return () => { clearInterval(timer); };
  }, [settings.enabled]);
  function switchTab(next: CleanupTab) {
    if (next === currentTab.current) return;
    currentTab.current = next; setTab(next);
    setPage({ rows: [], cursor: null, scanId: null });
    void load(next);
  }
  async function action(kind: "settings" | "scan" | "pause") {
    if (requests.pending("action") && kind !== "pause") return;
    if (mutation === "pause") return;
    requests.cancel("list"); setLoading(false);
    const request = requests.begin("action", kind === "scan" ? 45_000 : 25_000);
    const input = kind === "settings" ? { action: kind, roleId, period, enabled } : { action: kind };
    setMutation(kind); setError(null); setNotice(null);
    try {
      const data = await dashboardApiJson<{ ok: boolean; error?: string; settings: DiscordCleanupSettings; execution?: DiscordCleanupExecution; result: { skipped: boolean; scanning: boolean } }>(API, {
        method: "POST", json: input, signal: request.signal, retries: 0, timeoutMs: kind === "scan" ? 40_000 : kind === "pause" ? 10_000 : 20_000,
      });
      if (!request.current()) return;
      if (!data.ok) throw new Error(data.error || "Дію не підтверджено.");
      request.stopDeadline();
      if (kind === "settings" || kind === "pause") {
        setSettings(data.settings); setEnabled(data.settings.enabled); setExecution(data.execution);
        setNotice(kind === "pause" ? data.execution?.inFlight ? "Паузу прийнято. Одна дія вже почата; очікуємо її результат. Подальші виключення зупинено." : "Паузу прийнято. Автоматичне виключення призупинено." : data.settings.enabled ? "Налаштування збережено. Автоматичне виключення увімкнено." : "Налаштування збережено. Автоматичне виключення призупинено.");
      } else setNotice(data.result.skipped ? "Перевірка вже виконується або ще не налаштована." : data.result.scanning ? "Перевірку розпочато. Решта списку оновиться автоматично." : "Список перевірено й оновлено.");
      await load(currentTab.current, false, true);
    } catch (failure) {
      if (!request.current()) return;
      request.stopDeadline();
      if (failure instanceof ApiHttpError && failure.status >= 400 && failure.status < 500 && failure.status !== 408) {
        setError(failure.message);
      } else {
        setNotice("Відповідь на дію не отримано. Перевіряємо збережений стан; дію автоматично не повторюємо.");
        const recovered = await load(currentTab.current, false, true);
        if (!request.current()) return;
        if (recovered) {
          // Reading current state is reconciliation, never a replay or proof of the timed-out operation.
          if (kind === "pause" || kind === "settings") setEnabled(recovered.settings.enabled);
          setNotice(kind === "pause" && !recovered.settings.enabled ? "Збережений стан: автоматичне виключення на паузі." : "Збережений стан оновлено. Попередню дію не повторювали; її завершення не підтверджено.");
        }
      }
    } finally { if (request.current()) setMutation(null); request.finish(); }
  }
  const selectedRoleMissing = Boolean(roleId && !roles.some((role) => role.id === roleId));
  return (
    <div className="discord-cleanup">
      <section className="panel discord-cleanup-settings" aria-labelledby="cleanup-settings-title">
        <div className="discord-cleanup-heading">
          <div><span className="eyebrow">Автоматизація Discord</span><h2 id="cleanup-settings-title">Правило очищення</h2></div>
          <span className={`status-pill ${settings.enabled ? "warning" : "good"}`}>{settings.enabled ? "Автоматично" : "На паузі"}</span>
          {(settings.enabled || (mutation === "settings" && enabled)) && canConfigure ? <button type="button" className="btn subtle" disabled={mutation === "pause"} onClick={() => void action("pause")}>{mutation === "pause" ? "Призупиняю…" : "Призупинити"}</button> : null}
        </div>
        <p className="discord-cleanup-intro">У списку — люди без ролей або з <strong>лише однією вибраною роллю</strong>. Будь-яка додаткова роль захищає від цього правила. Боти ігноруються.</p>
        <form onSubmit={(event) => { event.preventDefault(); void action("settings"); }}>
          <fieldset disabled={!canConfigure || Boolean(mutation)}>
            <div className="discord-cleanup-fields">
              <label htmlFor="cleanup-role">Єдина дозволена роль<select id="cleanup-role" value={roleId} onChange={(event) => setRoleId(event.target.value)} required><option value="">Вибери роль</option>{selectedRoleMissing ? <option value={roleId} disabled>{settings.roleName || roleId} — недоступна</option> : null}{roles.map((role) => <option key={role.id} value={role.id} disabled={Boolean(role.blockedReason)}>{role.name}{role.blockedReason ? " — недоступна" : ""}</option>)}</select></label>
              <label htmlFor="cleanup-period">Строк від вступу на сервер<select id="cleanup-period" value={period} onChange={(event) => setPeriod(event.target.value as DiscordCleanupPeriod)}>{DISCORD_CLEANUP_PERIODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
            <label className="discord-cleanup-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>Автоматично виключати після спливу строку</strong><small>Активна черга обробляється порціями по 5 з інтервалом 10 секунд. У спокої Discord API не опитується; повний список оновлюється щогодини. Перед виключенням перевіряються актуальні ролі та дата вступу.</small></span></label>
            <div className="discord-cleanup-form-footer"><p>Відлік починається з останнього вступу. Місяці та рік — календарні. Виключення дозволяє повторний вступ за запрошенням.</p><button type="submit" className="btn primary" disabled={!roleId || selectedRoleMissing}>{mutation === "settings" ? "Зберігаю…" : "Зберегти налаштування"}</button></div>
          </fieldset>
        </form>
        {!canConfigure ? <p className="discord-cleanup-note">Налаштовувати автоматичне виключення може власник сервера. Перегляд і перевірка списку доступні адміністраторам з правом керування Discord.</p> : null}
      </section>
      {(warning || state.lastError || error) ? <div className="discord-cleanup-alert" role="alert">{error || state.lastError || warning}</div> : null}
      {notice ? <p className="discord-cleanup-notice" role="status">{notice}</p> : null}
      {!settings.enabled && execution?.inFlight ? <p className="discord-cleanup-note" role="status">Паузу прийнято. Для {execution.inFlight.displayName} дія вже почата або очікує підтвердження. Її результат буде в історії або списку «Потребують уваги».</p> : null}
      <p className="discord-cleanup-note" role="status">Планувальник: {state.lastAutomaticRunAt ? `останній виклик ${date(state.lastAutomaticRunAt)}` : "автоматичних викликів ще немає"}. «Оновити список» перевіряє учасників; виключення виконує планувальник.</p>
      {settings.enabled && state.lastScanAt && now && now - Date.parse(state.lastScanAt) > 180_000 && (!state.lastAutomaticRunAt || now - Date.parse(state.lastAutomaticRunAt) > 180_000) ? <div className="discord-cleanup-alert" role="alert">Планувальник не виходив на зв’язок понад 3 хвилини. Перевір стан cron-контейнера та його журнал; оновлення списку саме по собі не запускає виключення.</div> : null}
      <section className="discord-cleanup-metrics" aria-label="Результат останньої повної перевірки">
        <div><small>Перевірено учасників</small><strong>{state.checked.toLocaleString("uk-UA")}</strong><span>{state.lastScanAt ? date(state.lastScanAt) : "Повної перевірки ще немає"}</span></div>
        <div><small>Відповідали правилу</small><strong>{state.candidates.toLocaleString("uk-UA")}</strong><span>{state.overdue} зі спливлим строком · {state.blocked} захищено</span></div>
        <div><small>Виключено системою</small><strong>{state.kickedTotal.toLocaleString("uk-UA")}</strong><span>Підтверджені виключення за весь час</span></div>
      </section>
      <section className="panel discord-cleanup-members" aria-labelledby="cleanup-members-title" aria-busy={loading || mutation === "scan"}>
        <div className="discord-cleanup-heading"><div><h2 id="cleanup-members-title">Учасники та історія</h2><p>{state.scan ? `Триває перевірка: ${state.scan.checked} учасників. Поки показуємо останній завершений список.` : "Список оновлюється щогодини. Історія зберігається після перезапуску."}</p></div><button type="button" className="btn subtle" onClick={() => void action("scan")} disabled={Boolean(mutation) || !settings.roleId}>{mutation === "scan" ? "Перевіряю…" : "Оновити список"}</button></div>
        <div className="discord-cleanup-tabs" role="tablist" aria-label="Списки учасників">
          {([{ id: "candidates", text: "Учасники" }, { id: "kicked", text: "Виключені" }, { id: "uncertain", text: "Потребують уваги" }] as const).map((item) => <button type="button" className="btn subtle" key={item.id} id={`cleanup-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls="cleanup-list" tabIndex={tab === item.id ? 0 : -1} onClick={() => switchTab(item.id)} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const tabs: CleanupTab[] = ["candidates", "kicked", "uncertain"]; const index = tabs.indexOf(tab); const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[2] : tabs[(index + (event.key === "ArrowRight" ? 1 : 2)) % 3]; switchTab(target); document.getElementById(`cleanup-tab-${target}`)?.focus(); }}>{item.text}{item.id === "uncertain" && state.uncertainTotal > 0 ? ` (${state.uncertainTotal})` : ""}</button>)}
        </div>
        <div id="cleanup-list" role="tabpanel" aria-labelledby={`cleanup-tab-${tab}`} tabIndex={0}>
          {tab === "uncertain" ? <p className="discord-cleanup-note">Запит міг виконатися, але підтвердження перервалося. Система не повторює виключення для цього вступу. Перевір учасника та журнал аудиту Discord за ID спроби.</p> : null}
          {!page.rows.length ? <div className="discord-cleanup-empty"><strong>{loading ? "Завантажую…" : tab === "kicked" ? "Виключень ще немає" : tab === "uncertain" ? "Непідтверджених дій немає" : !settings.roleId ? "Спочатку вибери роль і строк" : state.scan ? "Формуємо список" : "Учасників за цим правилом немає"}</strong><p>{tab === "candidates" ? "Учасники з іншими або додатковими ролями сюди не потрапляють." : "Тут з’являтимуться результати роботи системи."}</p></div> : <ul className="discord-cleanup-list">{page.rows.map((member) => {
            const overdue = member.dueAt && (now || Date.parse(member.checkedAt)) > Date.parse(member.dueAt);
            return <li key={member.id} className="discord-cleanup-member"><div className="discord-cleanup-person"><span className="discord-cleanup-avatar" aria-hidden="true">{Array.from(member.displayName)[0]?.toUpperCase() || "?"}</span><div><strong>{member.displayName}</strong><code>{member.userId}</code></div></div><div className="discord-cleanup-member-info"><span className="discord-cleanup-label">Роль</span><strong>{member.roleName}</strong></div><div className="discord-cleanup-member-info"><span className="discord-cleanup-label">На сервері</span><strong>{elapsed(member.joinedAt, member.kickedAt, now || Date.parse(member.checkedAt))}</strong><small>Вступ: {date(member.joinedAt)}</small></div><div className="discord-cleanup-member-info"><span className="discord-cleanup-label">{tab === "kicked" ? "Виключено" : "Строк спливає"}</span><strong>{date(tab === "kicked" ? member.kickedAt : member.dueAt)}</strong><small className={member.blockedReason || member.lastError ? "is-warning" : ""}>{tab === "kicked" ? "Виключення підтверджено" : member.blockedReason || member.lastError || (overdue ? settings.enabled ? "У черзі автоматичного виключення" : "Строк сплив · автоматизація на паузі" : "Строк ще не сплив")}</small>{tab === "uncertain" && "attemptId" in member ? <code>Спроба: {String(member.attemptId)}</code> : null}</div></li>;
          })}</ul>}
          <div className="discord-cleanup-list-footer"><span>Показано: {page.rows.length}{page.cursor ? " · є ще" : ""}</span>{page.cursor ? <button type="button" className="btn subtle" disabled={loading} onClick={() => void load(tab, true)}>{loading ? "Завантажую…" : "Показати ще 25"}</button> : null}</div>
        </div>
      </section>
      {state.recentRuns.length ? <details className="panel discord-cleanup-runs"><summary>Останні запуски автоматизації</summary><ul>{state.recentRuns.map((run) => <li key={run.at}><time dateTime={run.at}>{date(run.at)}</time><span>{run.summary}</span></li>)}</ul></details> : null}
    </div>
  );
}
