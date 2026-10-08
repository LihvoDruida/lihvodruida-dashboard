"use client";
import { PageIntro } from "@/components/ui/PagePrimitives";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StaticSubnav } from "./StaticSubnav";
import styles from "./static.module.css";
type Violation = { id: string; description: string; createdAt: string; createdBy: string };
type Member = { userId: string; name: string; avatarUrl: string | null; violations: Violation[]; banUntil?: string | null; banned: boolean };
const date = (s?: string | null) => s ? new Date(s).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" }) : "—";
export default function StaticBansClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const reload = useCallback(async () => {
    const response = await fetch("/api/static/bans", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Немає доступу.");
    setMembers(json.members as Member[]);
    setCanEdit(Boolean(json.permissions?.edit));
  }, []);
  useEffect(() => { void reload().catch(e => setError(String(e))).finally(() => setLoading(false)); }, [reload]);
  async function mutate(action: string, payload: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/static/manage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Помилка збереження.");
      setAddingTo(null); setDescription("");
      await reload();
      setNotice(data.warning || "Запис оновлено.");
    } catch (e) { setError(e instanceof Error ? e.message : "Помилка запиту."); }
    finally { setBusy(false); }
  }
  const filtered = useMemo(() => members.filter(member => `${member.name} ${member.userId}`.toLocaleLowerCase("uk-UA").includes(query.trim().toLocaleLowerCase("uk-UA"))), [members, query]);
  return <div className={styles.wrap}>
    <PageIntro eyebrow="Статик • дисципліна" title="Порушення та банліст" description="У цьому списку зберігаються всі учасники з хоча б одним чинним порушенням. Третє порушення автоматично знімає роль Статика на місяць." />
    <StaticSubnav active="/discord/static/bans" />
    {error ? <div role="alert" className="notice panel error-note">{error}</div> : null}{notice ? <div role="status" className="notice panel success">{notice}</div> : null}
    <section className={`panel ${styles.card}`}><div className={styles.sectionHead}><div><h2>Дисциплінарні записи</h2><span className={styles.muted}>{filtered.length} записів · {members.filter(m => m.banned).length} з активним баном</span></div><input type="search" className={styles.banSearch} value={query} onChange={e => setQuery(e.target.value)} maxLength={100} placeholder="Пошук за іменем / ID" aria-label="Пошук порушень" /></div>
      {loading ? <p>Завантаження…</p> : filtered.length ? <div className={styles.banGrid}>{filtered.map(member => <article className={styles.banCard} key={member.userId}>
        <div className={styles.banHead}><div className={styles.rosterIdentity}><div className={styles.discordAvatar}>{member.avatarUrl ? <img src={member.avatarUrl} alt="" loading="lazy" /> : member.name.slice(0,1).toUpperCase()}</div><div className={styles.memberName}><strong>{member.name}</strong><small>ID {member.userId}</small></div></div><span className={`${styles.statusPill} ${member.banned ? styles.pillBanned : styles.pillRemoved}`}>{member.banned ? "Бан до " + date(member.banUntil) : `${member.violations.length}/3`}</span></div>
        <div className={styles.violationSlots}>{[0,1,2].map(index => { const violation = member.violations[index]; return <div className={styles.violationSlot} key={index}><div><strong>Порушення {index + 1}</strong>{violation ? <><p>{violation.description}</p><small>{date(violation.createdAt)} · РЛ {violation.createdBy}</small></> : <p className={styles.muted}>Не зафіксовано</p>}</div>{violation && canEdit ? <button className="btn subtle" type="button" disabled={busy} onClick={() => { if (window.confirm("Зняти це порушення? При трьох порушеннях бан буде скасовано, але роль не повернеться автоматично.")) void mutate("remove-violation", { userId: member.userId, violationId: violation.id }); }}>Зняти</button> : null}</div>; })}</div>
        {canEdit && member.violations.length < 3 ? addingTo === member.userId ? <form className={styles.violationInline} onSubmit={e => { e.preventDefault(); if(description.trim()) void mutate("add-violation", { userId: member.userId, description }); }}><label>Опис порушення<input required maxLength={128} value={description} onChange={e => setDescription(e.target.value)} placeholder="До 128 символів" /></label><span>{description.length}/128</span><button className="btn primary" type="submit" disabled={busy || !description.trim()}>Додати</button><button type="button" className="btn subtle" onClick={() => setAddingTo(null)}>Скасувати</button></form> : <button type="button" className="btn subtle" disabled={busy} onClick={() => {setAddingTo(member.userId);setDescription("");}}>＋ Додати порушення</button> : null}
      </article>)}</div> : <p className={styles.muted}>Порушень за заданим фільтром немає.</p>}
    </section>
  </div>;
}
