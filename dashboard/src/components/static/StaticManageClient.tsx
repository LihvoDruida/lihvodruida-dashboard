"use client";
import { useCallback, useEffect, useState } from "react";
import styles from "./static.module.css";
type Config = { text: string; version: number; memberRoleId: string; managerRoleId: string; updatedAt: string | null };
type Invite = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; createdBy: string };
type Member = { userId: string; name: string; status: string; blocked: boolean; acceptedAt: string | null; version: number; removedAt: string | null };
type Snapshot = { settings: Config; permissions: { view: boolean; edit: boolean; admin: boolean }; invites: Invite[]; members: Member[]; audit: { id: string; kind: string; createdAt: string; actor: string }[] };
const date = (s: string | null) => s ? new Date(s).toLocaleString("uk-UA") : "—";
export default function StaticManageClient() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [rules, setRules] = useState("");
  const [memberRoleId, setMemberRoleId] = useState("");
  const [managerRoleId, setManagerRoleId] = useState("");
  const [generated, setGenerated] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/static/manage", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Недостатньо прав.");
    const data = json as Snapshot;
    setState(data); setRules(data.settings.text); setMemberRoleId(data.settings.memberRoleId); setManagerRoleId(data.settings.managerRoleId);
  }, []);
  useEffect(() => { void refresh().catch((cause) => setError(String(cause.message || cause))); }, [refresh]);
  async function action(actionName: string, payload: Record<string, unknown> = {}, question = "") {
    if (question && !window.confirm(question)) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/static/manage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, ...payload }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Помилка операції.");
      if (actionName === "create-invite" && json.invite?.token) setGenerated(`${window.location.origin}/static/accept?t=${encodeURIComponent(json.invite.token)}`);
      await refresh();
      setNotice("Дію виконано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося виконати дію."); }
    finally { setBusy(false); }
  }
  const canEdit = Boolean(state?.permissions.edit);
  return <div className={styles.wrap}>
    <header className="hero panel"><div className="eyebrow">Mistblossom Vanguard • окрема система</div><h1>Рейдовий Статик</h1><p className="lead">Власні правила, запрошення на 24 години та склад підписантів. Загальні й рейдові правила працюють окремо.</p></header>
    {error ? <div className="notice panel error-note" role="alert">{error}</div> : null}
    {notice ? <div className="notice panel success" role="status">{notice}</div> : null}
    {!state ? <section className="panel">Завантаження даних…</section> : <>
      <div className={styles.metrics}>
        <div className="panel"><div className="eyebrow">Підписанти</div><strong>{state.members.filter(x => x.status === "active").length}</strong></div>
        <div className="panel"><div className="eyebrow">Активні запрошення</div><strong>{state.invites.filter(x => !x.revokedAt && Date.parse(x.expiresAt) > Date.now()).length}</strong></div>
        <div className="panel"><div className="eyebrow">Версія правил</div><strong>{state.settings.version}</strong></div>
      </div>
      <section className={`panel ${styles.card}`}><div className={styles.sectionHead}><h2>Правила Статика</h2><span>{canEdit ? "Редагування дозволено" : "Лише перегляд"}</span></div>
        {canEdit ? <><textarea className={styles.editor} value={rules} onChange={(e) => setRules(e.target.value)} rows={12} maxLength={20000} aria-label="Текст правил Статика" /><div className={styles.actions}><span>Після зміни тексту версія правил збільшиться. Нові підписанти прийматимуть нову версію.</span><button className="btn primary" disabled={busy || rules.trim().length < 20 || rules === state.settings.text} onClick={() => void action("save-rules", { text: rules })}>Зберегти правила</button></div></> : <div className={styles.rules}>{state.settings.text || "Правила ще не опубліковано."}</div>}
      </section>
      {state.permissions.admin ? <section className={`panel ${styles.card}`}><h2>Налаштування Discord-ролей</h2><p className={styles.muted}>Тільки адміністратор або власник може змінювати ролі. Введи ID ролі «Статик» і ID відповідального РЛ. Роль Статика має бути нижчою за роль бота.</p><div className={styles.fields}><label>Роль Статика<input type="text" value={memberRoleId} onChange={(e) => setMemberRoleId(e.target.value)} placeholder="Discord Role ID" maxLength={25} /></label><label>Роль керівника Статика (РЛ)<input type="text" value={managerRoleId} onChange={(e) => setManagerRoleId(e.target.value)} placeholder="Discord Role ID" maxLength={25} /></label></div><div className={styles.actions}><button className="btn primary" disabled={busy} onClick={() => void action("save-roles", { memberRoleId, managerRoleId })}>Зберегти ролі</button></div></section> : null}
      <section className={`panel ${styles.card}`}><div className={styles.sectionHead}><h2>Посилання-запрошення</h2>{canEdit ? <button className="btn primary" disabled={busy || !state.settings.text || !state.settings.memberRoleId} onClick={() => void action("create-invite")}>Створити на 24 години</button> : null}</div>
        {generated ? <div className={styles.challenge}><strong>Нове посилання — збережи його зараз</strong><div className={styles.code}><input readOnly value={generated} aria-label="Нове запрошення" /><button className="btn subtle" onClick={() => void navigator.clipboard.writeText(generated)}>Копіювати</button></div><p className={styles.muted}>Це спільне посилання можна передавати багатьом кандидатам протягом 24 годин. Після закриття сторінки повний токен повторно не показується.</p></div> : null}
        <div className={styles.list}>{state.invites.length === 0 ? <p className={styles.muted}>Запрошень поки немає.</p> : state.invites.map((invite) => <div className={styles.listRow} key={invite.id}><div><strong>{!invite.revokedAt && Date.parse(invite.expiresAt) > Date.now() ? "Активне" : invite.revokedAt ? "Відкликане" : "Завершене"}</strong><div className={styles.muted}>Створено {date(invite.createdAt)} • до {date(invite.expiresAt)}</div></div>{canEdit && !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now() ? <button className="btn subtle" disabled={busy} onClick={() => void action("revoke-invite", { id: invite.id }, "Відкликати це запрошення для всіх кандидатів?")}>Відкликати</button> : null}</div>)}</div>
      </section>
      <section className={`panel ${styles.card}`}><div className={styles.sectionHead}><h2>Склад Статика</h2><span>{state.members.length} записів</span></div><div className={styles.list}>{state.members.length === 0 ? <p className={styles.muted}>Поки немає підписантів.</p> : state.members.map((member) => <div className={styles.listRow} key={member.userId}><div><strong>{member.name || member.userId}</strong><div className={styles.muted}>ID {member.userId} • {member.status === "active" ? `Підпис v${member.version}: ${date(member.acceptedAt)}` : `Виключено ${date(member.removedAt)}`}</div></div>{canEdit ? member.blocked ? <button className="btn subtle" disabled={busy} onClick={() => void action("unblock-member", { userId: member.userId }, "Зняти заборону? Учаснику все одно потрібно буде повторно прийняти правила.")}>Дозволити повторний вступ</button> : <button className="btn subtle" disabled={busy} onClick={() => void action("remove-member", { userId: member.userId }, "Виключити зі Статика та зняти Discord-роль?")}>Виключити</button> : null}</div>)}</div></section>
      <section className={`panel ${styles.card}`}><h2>Журнал подій</h2><div className={styles.list}>{state.audit.length ? state.audit.map((entry) => <div className={styles.listRow} key={entry.id}><span>{entry.kind} • {entry.actor}</span><small>{date(entry.createdAt)}</small></div>) : <p className={styles.muted}>Подій ще немає.</p>}</div></section>
    </>}
  </div>;
}
