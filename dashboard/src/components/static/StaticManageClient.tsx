"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./static.module.css";
import { StaticSubnav } from "./StaticSubnav";
type Config = { text: string; version: number; memberRoleId: string; managerRoleId: string; updatedAt: string | null };
type Invite = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; createdBy: string };
type Member = { userId: string; name: string; status: string; blocked: boolean; acceptedAt: string | null; version: number; removedAt: string | null };
type Snapshot = { settings: Config; permissions: { view: boolean; edit: boolean; admin: boolean }; invites: Invite[]; members: Member[] };
const date = (s: string | null) => s ? new Date(s).toLocaleString("uk-UA") : "—";
export default function StaticManageClient() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [generated, setGenerated] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/static/manage", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Недостатньо прав.");
    setState(json as Snapshot);
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
    <header className="hero panel"><div className="eyebrow">Mistblossom Vanguard • рейдовий склад</div><h1>Рейдовий Статик</h1><p className="lead">Огляд складу та запрошень. Правила й історія дій мають власні сторінки.</p></header>
    <StaticSubnav active="/discord/static" />
    {error ? <div className="notice panel error-note" role="alert">{error}</div> : null}
    {notice ? <div className="notice panel success" role="status">{notice}</div> : null}
    {!state ? !error ? <section className="panel">Завантаження даних…</section> : null : <>
      <div className={styles.metrics}>
        <div className="panel"><div className="eyebrow">У складі</div><strong>{state.members.filter(x => x.status === "active").length}</strong></div>
        <div className="panel"><div className="eyebrow">Активні запрошення</div><strong>{state.invites.filter(x => !x.revokedAt && Date.parse(x.expiresAt) > Date.now()).length}</strong></div>
        <div className="panel"><div className="eyebrow">Версія правил</div><strong>{state.settings.version}</strong></div>
      </div>
      <div className={styles.linksGrid}>
        <Link href="/discord/static/rules" className={`panel ${styles.linkCard}`}><span className="eyebrow">Документ</span><strong>Правила Статика →</strong><span>Читати актуальну редакцію{canEdit ? ", редагувати Markdown" : ""}.</span></Link>
        <Link href="/discord/static/events" className={`panel ${styles.linkCard}`}><span className="eyebrow">Історія</span><strong>Журнал подій →</strong><span>Прийняття правил, запрошення, зміни й виключення.</span></Link>
      </div>
      {!state.settings.memberRoleId || !state.settings.managerRoleId ? <div role="status" className="notice panel">Discord-ролі Статика ще не налаштовані.{state.permissions.admin ? <> <Link href="/dashboard/settings">Відкрити налаштування панелі →</Link></> : " Звернись до адміністратора."}</div> : null}
      <section className={`panel ${styles.card}`}><div className={styles.sectionHead}><h2>Посилання-запрошення</h2>{canEdit ? <button className="btn primary" disabled={busy || !state.settings.text || !state.settings.memberRoleId} onClick={() => void action("create-invite")}>Створити на 24 години</button> : null}</div>
        {generated ? <div className={styles.challenge}><strong>Нове посилання — збережи його зараз</strong><div className={styles.code}><input readOnly value={generated} aria-label="Нове запрошення" /><button className="btn subtle" onClick={() => void navigator.clipboard.writeText(generated)}>Копіювати</button></div><p className={styles.muted}>Одне посилання працює для всіх кандидатів протягом 24 годин. Повний токен повторно не показується.</p></div> : null}
        <div className={styles.list}>{state.invites.length === 0 ? <p className={styles.muted}>Запрошень поки немає.</p> : state.invites.map(invite => <div className={styles.listRow} key={invite.id}><div><strong>{!invite.revokedAt && Date.parse(invite.expiresAt) > Date.now() ? "Активне" : invite.revokedAt ? "Відкликане" : "Завершене"}</strong><div className={styles.muted}>Створено {date(invite.createdAt)} • до {date(invite.expiresAt)}</div></div>{canEdit && !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now() ? <button className="btn subtle" disabled={busy} onClick={() => void action("revoke-invite", { id: invite.id }, "Відкликати запрошення для всіх кандидатів?")}>Відкликати</button> : null}</div>)}</div>
      </section>
      <section className={`panel ${styles.card}`}><div className={styles.sectionHead}><h2>Склад Статика</h2><span>{state.members.length} записів</span></div><div className={styles.list}>{state.members.length === 0 ? <p className={styles.muted}>Поки немає підписантів.</p> : state.members.map(member => <div className={styles.listRow} key={member.userId}><div><strong>{member.name || member.userId}</strong><div className={styles.muted}>ID {member.userId} • {member.status === "active" ? `Підпис v${member.version}: ${date(member.acceptedAt)}` : `Виключено ${date(member.removedAt)}`}</div></div>{canEdit ? member.blocked ? <button className="btn subtle" disabled={busy} onClick={() => void action("unblock-member", { userId: member.userId }, "Зняти заборону на повторний вступ?")}>Дозволити вступ</button> : <button className="btn subtle" disabled={busy} onClick={() => void action("remove-member", { userId: member.userId }, "Виключити зі Статика та зняти Discord-роль?")}>Виключити</button> : null}</div>)}</div></section>
    </>}
  </div>;
}
