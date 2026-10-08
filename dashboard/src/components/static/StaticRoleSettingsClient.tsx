"use client";
import Link from "next/link";
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
  async function load() {
    const res = await fetch("/api/dashboard/static-roles", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Немає доступу до налаштувань.");
    const state = json as Response;
    setData(state); setMemberRoleId(state.settings.memberRoleId); setManagerRoleId(state.settings.managerRoleId);
  }
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : "Помилка завантаження.")); }, []);
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/dashboard/static-roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ memberRoleId, managerRoleId }) });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Помилка збереження.");
      await load(); setNotice("Discord-ролі Статика оновлено.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося зберегти ролі."); }
    finally { setBusy(false); }
  }
  const memberValid = data?.roles.some(role => role.id === memberRoleId && role.manageable);
  const managerValid = data?.roles.some(role => role.id === managerRoleId);
  const changed = Boolean(data && (memberRoleId !== data.settings.memberRoleId || managerRoleId !== data.settings.managerRoleId));
  const ready = Boolean(data && !data.warning && data.botCanManageRoles && memberValid && managerValid && memberRoleId !== managerRoleId);
  return <div className={styles.wrap}>
    <header className="hero panel"><div className="eyebrow">Панель керування • Discord</div><h1>Налаштування</h1><p className="lead">Налаштування ролей Статика: кого бот приймає до складу та хто може керувати ним.</p></header>
    <section className={`panel ${styles.card}`}>
      <div className={styles.sectionHead}><h2>Discord-ролі Статика</h2><Link className="btn subtle" href="/discord/static">До Статика →</Link></div>
      <p className={styles.muted}>Налаштування змінюють тільки адміністратори або власник сервера. РЛ керує Статиком, але не може змінити власні повноваження.</p>
      {error ? <div className="notice panel error-note" role="alert">{error}</div> : null}
      {notice ? <div className="notice panel success" role="status">{notice}</div> : null}
      {!data ? !error ? <p>Завантаження ролей Discord-сервера…</p> : null : <>
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
