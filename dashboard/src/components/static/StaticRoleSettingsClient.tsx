"use client";
import Link from "next/link";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { ApiHttpError } from "@/lib/apiHttp";
import { useDashboardRequests } from "@/lib/useDashboardRequests";
import { useEffect, useState } from "react";
import styles from "./static.module.css";
type Role = { id: string; name: string; color: number; manageable: boolean; blockedReason?: string | null; position: number };
type Response = { settings: { memberRoleId: string; managerRoleId: string }; roles: Role[]; warning: string | null; botCanManageRoles: boolean; guildName: string | null };
export default function StaticRoleSettingsClient() {
  const [data, setData] = useState<Response | null>(null);
  const [memberRoleId, setMemberRoleId] = useState("");
  const [managerRoleId, setManagerRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requests = useDashboardRequests();
  async function read(signal: AbortSignal) {
    return dashboardApiJson<Response>("/api/dashboard/static-roles", { signal, timeoutMs: 12_000, retries: 0 });
  }
  async function load() {
    const request = requests.begin("load", 15_000);
    setError("");
    try {
      const state = await read(request.signal);
      if (!request.current()) return;
      setData(state); setMemberRoleId(state.settings.memberRoleId); setManagerRoleId(state.settings.managerRoleId);
    } catch (cause) {
      if (request.current()) setError(cause instanceof ApiHttpError ? cause.message : "Не вдалося завантажити ролі за відведений час. Повтори оновлення.");
    } finally { request.finish(); }
  }
  useEffect(() => { void load(); }, []);
  async function save() {
    if (requests.pending("save")) return;
    const request = requests.begin("save", 40_000);
    const attempted = { memberRoleId, managerRoleId };
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await dashboardApiJson<{ settings: Response["settings"] }>("/api/dashboard/static-roles", { method: "POST", json: attempted, signal: request.signal, timeoutMs: 20_000, retries: 0 });
      if (!request.current()) return;
      setData(current => current ? { ...current, settings: result.settings } : current); setNotice("Discord-ролі Статика оновлено.");
    } catch (cause) {
      if (!request.current()) return;
      if (cause instanceof ApiHttpError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) setError(cause.message);
      else {
        setNotice("Відповідь не отримано. Перевіряємо збережені ролі; зміну автоматично не повторюємо.");
        try {
          const current = await read(request.signal);
          if (!request.current()) return;
          setData(current);
          setNotice(current.settings.memberRoleId === attempted.memberRoleId && current.settings.managerRoleId === attempted.managerRoleId ? "Збережені ролі відповідають вибраним. Повторне збереження не потрібне." : "Збережений стан оновлено. Завершення попередньої зміни не підтверджено; вибір у формі збережено.");
        } catch { if (request.current()) setError("Стан збереження не підтверджено. Онови сторінку перед наступною зміною."); }
      }
    } finally { if (request.current()) setBusy(false); request.finish(); }
  }
  const memberValid = data?.roles.some(role => role.id === memberRoleId && role.manageable);
  const managerValid = data?.roles.some(role => role.id === managerRoleId);
  const changed = Boolean(data && (memberRoleId !== data.settings.memberRoleId || managerRoleId !== data.settings.managerRoleId));
  const ready = Boolean(data && !data.warning && data.botCanManageRoles && memberValid && managerValid && memberRoleId !== managerRoleId);
  return <div className={styles.wrap}>
    <section className={`panel ${styles.card}`}>
      <div className={styles.sectionHead}><h2>Discord-ролі Статика</h2><Link className="btn subtle" href="/discord/static">До Статика →</Link></div>
      <p className={styles.muted}>Налаштування змінюють тільки адміністратори або власник сервера. РЛ керує Статиком, але не може змінити власні повноваження.</p>
      {error ? <div className="notice panel error-note" role="alert">{error}</div> : null}
      {notice ? <div className="notice panel success" role="status">{notice}</div> : null}
      {!data ? !error ? <p>Завантаження ролей Discord-сервера…</p> : <button type="button" className="btn subtle" onClick={() => void load()}>Оновити ролі</button> : <>
        <p className={styles.muted}>Сервер: {data.guildName || "не визначено"} • {data.roles.length} доступних ролей</p>
        {data.warning ? <div className="notice error-note" role="alert">Discord API: {data.warning}. Збереження вимкнене до відновлення зв’язку.</div> : null}
        {!data.botCanManageRoles ? <p role="alert" className={styles.muted}>Бот не має права Manage Roles або не може керувати вибраною роллю.</p> : null}
        <div className={styles.fields}>
          <label>Роль учасника Статика<select value={memberRoleId} onChange={e => setMemberRoleId(e.target.value)} disabled={busy || Boolean(data.warning)}><option value="">Оберіть роль зі списку Discord</option>{data.roles.map(role => <option key={role.id} value={role.id} disabled={!role.manageable}>{role.name}{role.manageable ? "" : " — бот не може видати"}</option>)}</select><small className={styles.muted}>Бот повинен мати право призначати цю роль (вона нижче його найвищої ролі).</small></label>
          <label>Роль відповідального РЛ<select value={managerRoleId} onChange={e => setManagerRoleId(e.target.value)} disabled={busy || Boolean(data.warning)}><option value="">Оберіть роль РЛ</option>{data.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select><small className={styles.muted}>Роль РЛ перевіряється на сервері під час кожної зміни Статика.</small></label>
        </div>
        <div className={styles.actions}><span>{changed ? "Є незбережені зміни." : "Вибрані ролі відповідають збереженій конфігурації."}</span><button className="btn primary" type="button" disabled={busy || !changed || !ready} onClick={() => void save()}>{busy ? "Зберігаємо…" : "Зберегти Discord-ролі"}</button></div>
      </>}
    </section>
  </div>;
}
