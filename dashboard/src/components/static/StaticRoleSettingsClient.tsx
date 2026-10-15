"use client";
import Link from "next/link";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useActionFocus } from "@/lib/useActionFocus";
import { confirmStaticRoleSave, filterStaticRoles, indexStaticRoles, parseStaticRoleOverview, sameStaticRoleChoice, type StaticRoleOverview } from "@/lib/staticRoleSettingsView";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./static.module.css";
export default function StaticRoleSettingsClient() {
  const [data, setData] = useState<StaticRoleOverview | null>(null);
  const [memberRoleId, setMemberRoleId] = useState("");
  const [managerRoleId, setManagerRoleId] = useState("");
  const [pending, setPending] = useState<"load" | "save" | null>(null);
  const [loadError, setLoadError] = useState("");
  const [readNotice, setReadNotice] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const requests = useDashboardRequests();
  const changed = Boolean(data && !sameStaticRoleChoice({ memberRoleId, managerRoleId }, data.settings));
  const dirtyRef = useRef(changed);
  dirtyRef.current = changed;
  const actionFocus = useActionFocus<HTMLFormElement>(pending === "save");
  const readFocus = useActionFocus<HTMLDivElement>(pending === "load");
  async function read(signal: AbortSignal) {
    return parseStaticRoleOverview(await dashboardApiJson<unknown>("/api/dashboard/static-roles", { signal, timeoutMs: 12_000, retries: 0 }));
  }
  async function load(trigger?: HTMLElement) {
    if (requests.pending("save") || requests.pending("load")) return;
    if (trigger) readFocus.beginActionFocus(trigger, { preferResult: true });
    const request = requests.begin("load", 15_000);
    setPending("load"); setLoadError(""); setReadNotice("");
    try {
      const state = await read(request.signal);
      if (!request.current()) return;
      setData(state);
      if (!dirtyRef.current) { setMemberRoleId(state.settings.memberRoleId); setManagerRoleId(state.settings.managerRoleId); }
      setReadNotice(state.warning ? "Ролі прочитано, але зв’язок із Discord ще не відновився." : "Список ролей оновлено. Поточний вибір збережено.");
    } catch (cause) {
      if (request.current()) setLoadError(cause instanceof Error ? cause.message : "Не вдалося завантажити ролі за відведений час. Повтори оновлення.");
    } finally { if (request.current()) setPending(null); request.finish(); }
  }
  useEffect(() => { void load(); }, []);
  const indexed = useMemo(() => indexStaticRoles(data?.roles || []), [data?.roles]);
  const roleMap = useMemo(() => new Map((data?.roles || []).map(role => [role.id, role])), [data?.roles]);
  const filtered = useMemo(() => filterStaticRoles(indexed, search, { memberRoleId, managerRoleId }), [indexed, search, memberRoleId, managerRoleId]);
  const memberValid = roleMap.get(memberRoleId)?.manageable;
  const managerValid = roleMap.has(managerRoleId);
  const ready = Boolean(data && !data.warning && data.botCanManageRoles && memberValid && managerValid && memberRoleId !== managerRoleId);
  async function save(trigger?: HTMLElement | null) {
    if (!ready || !changed || requests.pending("save") || requests.pending("load")) return;
    if (trigger) actionFocus.beginActionFocus(trigger, { preferResult: true });
    const request = requests.begin("save", 40_000);
    const attempted = { memberRoleId, managerRoleId };
    setPending("save"); setError(""); setNotice("");
    try {
      const result = await dashboardApiJson<unknown>("/api/dashboard/static-roles", { method: "POST", json: attempted, signal: request.signal, timeoutMs: 20_000, retries: 0 });
      if (!request.current()) return;
      const settings = confirmStaticRoleSave(result, attempted);
      setData(current => current ? { ...current, settings } : current); setNotice("Discord-ролі Статика оновлено.");
    } catch (cause) {
      if (!request.current()) return;
      // The route can return 400 after a committed setting if writing its audit
      // fails. Reconcile ambiguous responses by GET, never replay the POST.
      if (cause instanceof ApiHttpError && [401, 403, 413, 415, 422, 428, 429].includes(cause.status)) setError(cause.message);
      else {
        setNotice("Відповідь не отримано. Перевіряємо збережені ролі; зміну автоматично не повторюємо.");
        try {
          const current = await read(request.signal);
          if (!request.current()) return;
          setData(current); setLoadError("");
          const reason = cause instanceof ApiHttpError && cause.status < 500 ? `${cause.message} ` : "";
          setNotice(sameStaticRoleChoice(current.settings, attempted) ? "Збережені ролі відповідають вибраним. Повторне збереження не потрібне." : `${reason}Збережений стан оновлено. Завершення попередньої зміни не підтверджено; вибір у формі збережено.`);
        } catch {
          if (request.current()) { setNotice(""); setError("Стан збереження не підтверджено. Повтори читання ролей перед наступною зміною; вибір у формі збережено."); }
        }
      }
    } finally { if (request.current()) setPending(null); request.finish(); }
  }
  const busy = pending !== null;
  return <div className={styles.wrap} aria-busy={busy}>
    <section className={`panel ${styles.card}`}>
      <div className={styles.sectionHead}><h2>Discord-ролі Статика</h2><Link className="btn subtle" href="/discord/static">До Статика →</Link></div>
      <p className={styles.muted}>Налаштування змінюють тільки адміністратори або власник сервера. РЛ керує Статиком, але не може змінити власні повноваження.</p>
      <div ref={readFocus.scopeRef}>
        <button type="button" className="btn subtle" disabled={busy} onClick={event => void load(event.currentTarget)}>{pending === "load" ? "Оновлюємо ролі…" : "Оновити ролі"}</button>
        <p className={styles.muted} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="">{pending === "load" ? "Читаємо ролі Discord…" : loadError ? "Не вдалося прочитати ролі. Поточний вибір збережено." : readNotice}</p>
        {loadError ? <div className="notice panel error-note" role="alert">{loadError}</div> : null}
      </div>
      {data ? <>
        <p className={styles.muted}>Сервер: {data.guildName || "не визначено"} • {data.roles.length} доступних ролей</p>
        {data.warning ? <div className="notice error-note" role="alert">Discord API: {data.warning}. Збереження вимкнене до відновлення зв’язку.</div> : null}
        {!data.botCanManageRoles ? <p role="alert" className={styles.muted}>Бот не має права Manage Roles або не може керувати вибраною роллю.</p> : null}
        <form ref={actionFocus.scopeRef} data-toast-managed="true" data-dirty={changed ? "true" : "false"} data-submitting={pending === "save" ? "true" : "false"} onSubmit={event => { event.preventDefault(); void save((event.nativeEvent as SubmitEvent).submitter); }}>
          <label className={styles.muted} htmlFor="static-role-search">Пошук Discord-ролей</label>
          <div className={styles.fields}><input id="static-role-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} disabled={busy} placeholder="Назва або ID ролі" aria-describedby="static-role-search-result" /></div>
          <p className={styles.muted} id="static-role-search-result" role="status">{search ? filtered.matches ? `Знайдено: ${filtered.matches}. Вибрані ролі залишаються у списках.` : "За пошуком ролей не знайдено." : "Пошук у списку ролей. Вибрані ролі залишаються видимими."}</p>
          <div className={styles.fields}>
            <label>Роль учасника Статика<select value={memberRoleId} onChange={e => setMemberRoleId(e.target.value)} disabled={busy || Boolean(data.warning)}><option value="">Оберіть роль зі списку Discord</option>{memberRoleId && !roleMap.has(memberRoleId) ? <option value={memberRoleId} disabled>Роль {memberRoleId} — недоступна</option> : null}{filtered.roles.map(role => <option key={role.id} value={role.id} disabled={!role.manageable}>{role.name}{role.manageable ? "" : " — бот не може видати"}</option>)}</select><small className={styles.muted}>Бот повинен мати право призначати цю роль (вона нижче його найвищої ролі).</small></label>
            <label>Роль відповідального РЛ<select value={managerRoleId} onChange={e => setManagerRoleId(e.target.value)} disabled={busy || Boolean(data.warning)}><option value="">Оберіть роль РЛ</option>{managerRoleId && !roleMap.has(managerRoleId) ? <option value={managerRoleId} disabled>Роль {managerRoleId} — недоступна</option> : null}{filtered.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select><small className={styles.muted}>Роль РЛ перевіряється на сервері під час кожної зміни Статика.</small></label>
          </div>
          {memberRoleId && memberRoleId === managerRoleId ? <p className={styles.muted}>Для учасника та РЛ потрібні дві різні ролі.</p> : null}
          <div className={styles.actions}><span>{changed ? "Є незбережені зміни." : "Вибрані ролі відповідають збереженій конфігурації."}</span><button className="btn primary" type="submit" disabled={busy || !changed || !ready}>{pending === "save" ? "Зберігаємо…" : "Зберегти Discord-ролі"}</button></div>
          <p className={error ? "notice panel error-note" : styles.muted} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="">{error || notice}</p>
        </form>
      </> : null}
    </section>
  </div>;
}
