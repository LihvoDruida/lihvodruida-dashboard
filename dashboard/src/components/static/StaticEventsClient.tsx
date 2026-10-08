"use client";
import { PageIntro } from "@/components/ui/PagePrimitives";
import { useEffect, useMemo, useState } from "react";
import { StaticSubnav } from "./StaticSubnav";
import styles from "./static.module.css";
type Event = { id: string; kind: string; actor: string; createdAt: string; details: Record<string, unknown> };
const LABELS: Record<string, string> = {
  "settings.changed": "Налаштування / правила змінено", "invite.created": "Посилання створено",
  "invite.revoked": "Посилання відкликано", "member.accepted": "Правила прийнято",
  "member.removed": "Учасника виключено", "member.unblocked": "Повторний вступ дозволено",
  "violation.added": "Порушення додано", "violation.removed": "Порушення знято",
  "member.banned": "Бан на місяць", "role.enforced": "Заборонену роль знято ботом", "role.enforcement_pending": "Очікується повторне зняття ролі",
};
const formatDate = (value: string) => { const stamp = new Date(value); return Number.isNaN(stamp.valueOf()) ? "—" : stamp.toLocaleString("uk-UA"); };
export default function StaticEventsClient() {
  const [events, setEvents] = useState<Event[]>([]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/static/events", { cache: "no-store" })
      .then(async res => { const json = await res.json(); if (!res.ok) throw new Error(json.error || "Немає доступу."); return json.events as Event[]; })
      .then(data => { if (active) setEvents(data); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Помилка журналу."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const types = useMemo(() => [...new Set(events.map(entry => entry.kind))], [events]);
  const filtered = useMemo(() => events.filter(entry =>
    (filter === "all" || entry.kind === filter) &&
    (!query.trim() || `${entry.kind} ${entry.actor} ${Object.values(entry.details).join(" ")}`.toLocaleLowerCase("uk-UA").includes(query.trim().toLocaleLowerCase("uk-UA")))
  ), [events, filter, query]);
  return <div className={styles.wrap}>
    <PageIntro eyebrow="Статик • історія" title="Журнал подій" description="Історія запрошень, прийняття правил, змін і дій РЛ. Події не можна редагувати з цієї сторінки." />
    <StaticSubnav active="/discord/static/events" />
    {error ? <div role="alert" className="notice panel error-note">{error}</div> : null}
    <section className={`panel ${styles.card}`}>
      <div className={styles.sectionHead}><h2>Події Статика</h2><span className={styles.muted}>{loading ? "Завантаження…" : `${filtered.length} із ${events.length}`}</span></div>
      <div className={styles.fields}><label>Тип події<select value={filter} onChange={e => { setFilter(e.target.value); setVisible(30); }}><option value="all">Усі події</option>{types.map(kind => <option key={kind} value={kind}>{LABELS[kind] || kind}</option>)}</select></label><label>Пошук за учасником або дією<input type="search" maxLength={160} value={query} onChange={e => { setQuery(e.target.value); setVisible(30); }} placeholder="Discord ID або подія" /></label></div>
      <div className={styles.list}>{!loading && !filtered.length ? <p className={styles.muted}>Подій за цими умовами немає.</p> : filtered.slice(0, visible).map(entry => <div className={styles.listRow} key={entry.id}><div><strong>{LABELS[entry.kind] || entry.kind}</strong><span className={styles.muted}>Ініціатор: {entry.actor || "—"}</span><span className={styles.eventDetails}>{Object.entries(entry.details).filter(([, val]) => typeof val !== "object").map(([key, val]) => `${key}: ${String(val)}`).join(" • ")}</span></div><time className={styles.muted} dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time></div>)}</div>
      {visible < filtered.length ? <button className="btn subtle" type="button" onClick={() => setVisible(current => current + 30)}>Показати ще</button> : null}
      {events.length >= 250 ? <p className={styles.muted}>Показано останні 250 записів. Повна історія зберігається у сховищі.</p> : null}
    </section>
  </div>;
}
