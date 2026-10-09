"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./static.module.css";
import { StaticSubnav } from "./StaticSubnav";

type Config = { text: string; version: number; memberRoleId: string; managerRoleId: string; updatedAt: string | null };
type Invite = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; createdBy: string };
type Violation = { id: string; description: string; createdAt: string; createdBy: string };
type Member = { userId: string; name: string; status: string; blocked: boolean; acceptedAt: string | null; version: number; removedAt: string | null; violations?: Violation[]; banUntil?: string | null; discord: { avatarUrl: string | null; username: string | null; nick: string | null; roleIds: string[]; joinedAt: string | null } | null };
type Snapshot = { settings: Config; permissions: { view: boolean; edit: boolean; admin: boolean }; invites: Invite[]; members: Member[]; discordSynced: boolean };
const date = (value: string | null | undefined) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Kyiv" }).format(new Date(value)) : "—";
const banned = (member: Member) => Boolean(member.banUntil && Date.parse(member.banUntil) > Date.now());

export default function StaticManageClient() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [generated, setGenerated] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [visible, setVisible] = useState(30);
  const [violationFor, setViolationFor] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/static/manage", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Недостатньо прав.");
    setState(json as Snapshot);
  }, []);
  useEffect(() => { void refresh().catch(cause => setError(String(cause.message || cause))); }, [refresh]);
  async function action(actionName: string, payload: Record<string, unknown> = {}, question = "") {
    if (question && !window.confirm(question)) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/static/manage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, ...payload }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Помилка операції.");
      if (actionName === "create-invite" && json.invite?.token) setGenerated(`${window.location.origin}/static/accept?t=${encodeURIComponent(json.invite.token)}`);
      if (actionName === "add-violation") { setViolationFor(null); setDescription(""); }
      await refresh();
      setNotice(json.warning || "Дію виконано.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не вдалося виконати дію."); }
    finally { setBusy(false); }
  }
  const filtered = useMemo(() => state?.members.filter(member => {
    const searchText = `${member.name} ${member.userId} ${member.discord?.username || ""}`.toLocaleLowerCase("uk-UA");
    const statusOk = filter === "all" || (filter === "active" && member.status === "active" && !banned(member)) || (filter === "removed" && member.status !== "active") || (filter === "violations" && Boolean(member.violations?.length));
    return statusOk && searchText.includes(search.toLocaleLowerCase("uk-UA").trim());
  }) || [], [state, search, filter]);
  const canEdit = Boolean(state?.permissions.edit);
  return <div className={styles.wrap}>
    <header className="hero panel"><div className="eyebrow">Mistblossom Vanguard • Рейдовий склад</div><h1>Склад Статика</h1><p className="lead">Учасники Discord із зафіксованою датою прийняття правил. Структура таблиці та фільтрів узгоджена зі складом гільдії.</p></header>
    <StaticSubnav active="/discord/static" />
    {error ? <div className="notice panel error-note" role="alert">{error}</div> : null}
    {notice ? <div className="notice panel success" role="status">{notice}</div> : null}
    {!state ? !error ? <section className="panel">Завантаження даних…</section> : null : <>
      <div className={styles.rosterMetrics} aria-label="Статистика Статика">
        <div><small>Учасників</small><strong>{state.members.filter(x => x.status === "active" && !banned(x) && (!state.discordSynced || x.discord?.roleIds.includes(state.settings.memberRoleId))).length}</strong></div>
        <div><small>З порушеннями</small><strong>{state.members.filter(x => (x.violations?.length || 0) > 0).length}</strong></div>
        <div><small>Блокування</small><strong>{state.members.filter(banned).length}</strong></div>
        <div><small>Активні запрошення</small><strong>{state.invites.filter(x => !x.revokedAt && Date.parse(x.expiresAt) > Date.now()).length}</strong></div>
        <div><small>Правила v</small><strong>{state.settings.version}</strong></div>
      </div>
      <div className={styles.linksGrid}>
        <Link href="/discord/static/rules" className={`panel ${styles.linkCard}`}><span className="eyebrow">Документ</span><strong>Правила Статика →</strong><span>Актуальна версія та Markdown-редактор для відповідального РЛ.</span></Link>
        <Link href="/discord/static/events" className={`panel ${styles.linkCard}`}><span className="eyebrow">Аудит</span><strong>Журнал подій →</strong><span>Реєстр змін і рішень.</span></Link>
        <Link href="/discord/static/bans" className={`panel ${styles.linkCard}`}><span className="eyebrow">Дисципліна</span><strong>Порушення та банліст →</strong><span>Три слоти порушень на кожного учасника, строки заборони та скасування.</span></Link>
      </div>
      {!state.settings.memberRoleId || !state.settings.managerRoleId ? <div className="notice panel">Discord-ролі не налаштовані. {state.permissions.admin ? <Link href="/dashboard/settings">Налаштування →</Link> : "Зверніться до адміністратора."}</div> : null}
      <section className={`panel ${styles.card}`}><div className={styles.sectionHead}><h2>Запрошення на 24 години</h2>{canEdit ? <button className="btn primary" disabled={busy || !state.settings.text || !state.settings.memberRoleId} onClick={() => void action("create-invite")}>Створити посилання</button> : null}</div>
        {generated ? <div className={styles.challenge}><strong>Посилання — скопіюй його зараз</strong><div className={styles.code}><input readOnly value={generated} aria-label="Посилання-запрошення" /><button className="btn subtle" onClick={() => void navigator.clipboard.writeText(generated)}>Копіювати</button></div></div> : null}
        <div className={styles.list}>{state.invites.length === 0 ? <p className={styles.muted}>Запрошень немає.</p> : state.invites.slice(0, 12).map(invite => <div className={styles.listRow} key={invite.id}><div><strong>{!invite.revokedAt && Date.parse(invite.expiresAt) > Date.now() ? "Активне" : invite.revokedAt ? "Відкликане" : "Завершене"}</strong><span className={styles.muted}>{date(invite.createdAt)} — {date(invite.expiresAt)}</span></div>{canEdit && !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now() ? <button className="btn subtle" disabled={busy} onClick={() => void action("revoke-invite", { id: invite.id }, "Відкликати запрошення?")}>Відкликати</button> : null}</div>)}</div>
      </section>
      <section className={`panel ${styles.rosterPanel}`} aria-label="Склад Статика">
        <div className={styles.rosterToolbar}><div><h2>Учасники Статика</h2><span className={styles.muted}>{filtered.length} з {state.members.length}</span></div>
          <div className={styles.rosterFilters}><input type="search" maxLength={100} value={search} onChange={e => { setSearch(e.target.value); setVisible(30); }} placeholder="Нік або Discord ID" aria-label="Пошук учасника Статика" />
            <select aria-label="Фільтр учасників" value={filter} onChange={e => { setFilter(e.target.value); setVisible(30); }}><option value="active">У складі</option><option value="all">Усі записи</option><option value="violations">З порушеннями</option><option value="removed">Виключені</option></select></div></div>
        <div className={styles.syncNote}>{state.discordSynced ? "● Актуальні профілі Discord" : "○ Discord API недоступний — показано збережені імена; дані ролей не підтверджені"}</div>
        <div className={styles.rosterScroll}><div className={styles.rosterTable} role="table" aria-label="Склад Статика">
          <div className={styles.rosterHead} role="row"><span>Discord-учасник</span><span>Стан</span><span>Прийнято до складу</span><span>Порушення</span><span>Дії</span></div>
          {filtered.slice(0, visible).map(member => <div className={styles.rosterRow} role="row" key={member.userId}>
            <div className={styles.rosterIdentity} role="cell" data-label="Учасник"><div className={styles.discordAvatar}>{member.discord?.avatarUrl ? <img src={member.discord.avatarUrl} alt="" loading="lazy" /> : member.name?.slice(0, 1).toUpperCase()}</div><div className={styles.memberName}><strong>{member.name || member.userId}</strong><small>{member.discord?.username ? `@${member.discord.username} · ` : ""}ID {member.userId}</small></div></div>
            <div role="cell" data-label="Стан"><span className={`${styles.statusPill} ${banned(member) ? styles.pillBanned : member.status === "active" && (!state.discordSynced || member.discord?.roleIds.includes(state.settings.memberRoleId)) ? styles.pillActive : styles.pillRemoved}`}>{banned(member) ? "Бан" : member.status !== "active" ? "Виключено" : state.discordSynced && !member.discord?.roleIds.includes(state.settings.memberRoleId) ? "Роль відсутня" : "Статик"}</span></div>
            <div role="cell" data-label="Прийнято"><strong>{date(member.acceptedAt)}</strong><small>Правила v{member.version}</small></div>
            <div role="cell" data-label="Порушення"><strong>{(member.violations || []).length} / 3</strong>{banned(member) ? <small>до {date(member.banUntil)}</small> : null}</div>
            <div role="cell" className={styles.rosterActions} data-label="Дії">{canEdit ? <><button className="btn subtle" disabled={busy || (member.violations || []).length >= 3} onClick={() => { setViolationFor(violationFor === member.userId ? null : member.userId); setDescription(""); }}>Порушення</button>{member.status === "active" ? <button className="btn subtle" disabled={busy} onClick={() => void action("remove-member", { userId: member.userId }, `Зняти роль Статика для ${member.name}?`)}>Прибрати зі Статика</button> : member.blocked ? <button className="btn subtle" disabled={busy} onClick={() => void action("unblock-member", { userId: member.userId }, "Дозволити повторний вступ (без автоматичної видачі ролі)?")}>Дозволити вступ</button> : null}</> : <span className={styles.muted}>Перегляд</span>}</div>
            {violationFor === member.userId && canEdit ? <form className={styles.violationInline} onSubmit={e => { e.preventDefault(); if(description.trim()) void action("add-violation", { userId: member.userId, description }); }}><label>Короткий опис порушення (до 128 символів)<input required autoFocus maxLength={128} value={description} onChange={e => setDescription(e.target.value)} placeholder="За що зафіксовано порушення" /></label><span>{description.length}/128</span><button className="btn primary" disabled={busy || !description.trim()} type="submit">Зафіксувати</button><button type="button" className="btn subtle" onClick={() => setViolationFor(null)}>Скасувати</button><p className={styles.muted}>Третє порушення призведе до зняття ролі та блокування на один календарний місяць.</p></form> : null}
          </div>)}
          {filtered.length === 0 ? <p className={styles.emptyRoster}>Учасників за цими фільтрами немає.</p> : null}
        </div></div>
        {visible < filtered.length ? <div className={styles.rosterFooter}><button className="btn subtle" onClick={() => setVisible(n => n + 30)}>Показати ще ({filtered.length - visible})</button></div> : null}
      </section>
    </>}
  </div>;
}
