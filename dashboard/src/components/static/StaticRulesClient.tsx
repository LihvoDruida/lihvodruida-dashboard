"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StaticMarkdown } from "./StaticMarkdown";
import { StaticMarkdownEditor } from "./StaticMarkdownEditor";
import { StaticSubnav } from "./StaticSubnav";
import styles from "./static.module.css";
type RulesResponse = { ok: boolean; settings: { text: string; version: number; updatedAt: string | null }; permissions: { edit: boolean }; template?: string; error?: string };
export default function StaticRulesClient() {
  const [record, setRecord] = useState<RulesResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/static/rules", { cache: "no-store" })
      .then(async res => { const data = await res.json(); if (!res.ok) throw new Error(data.error || "Немає доступу."); return data as RulesResponse; })
      .then(data => { if (active) { setRecord(data); setDraft(data.settings.text); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Не вдалося завантажити правила."); });
    return () => { active = false; };
  }, []);
  async function save() {
    if (!record || !record.permissions.edit) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/static/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: draft }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Помилка збереження.");
      setRecord({ ...record, settings: data.settings }); setDraft(data.settings.text);
      setNotice(`Правила збережено (версія ${data.settings.version}).`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка збереження."); }
    finally { setBusy(false); }
  }
  function loadDocument() {
    if (!record?.permissions.edit || !record.template) return;
    if (draft !== record.template && draft.trim() && !window.confirm("Замінити поточний текст правилами з документа? Незбережені зміни буде втрачено. Правила набудуть чинності лише після збереження.")) return;
    setDraft(record.template);
    setNotice("Шаблон із документа завантажено в редактор. Перевір правила й натисни «Зберегти правила».");
  }
  const dirty = Boolean(record && draft !== record.settings.text);
  return <div className={styles.wrap}>
    <header className="hero panel"><div className="eyebrow">Статик • документ</div><h1>Правила Статика</h1><p className="lead">Окремий документ з власною версією. Формат Markdown для перегляду та редагування.</p></header>
    <StaticSubnav active="/discord/static/rules" />
    {error ? <div role="alert" className="notice panel error-note">{error}</div> : null}
    {notice ? <div role="status" className="notice panel success">{notice}</div> : null}
    {!record ? !error ? <section className="panel">Завантажуємо правила…</section> : null : <section className={`panel ${styles.card}`}>
      <div className={styles.sectionHead}><div><h2>Чинна редакція</h2><p className={styles.muted}>Версія {record.settings.version} • змінено {record.settings.updatedAt ? new Date(record.settings.updatedAt).toLocaleString("uk-UA") : "базовий документ, до першого редагування"}</p></div><Link className="btn subtle" href="/discord/static">До Статика</Link></div>
      {record.permissions.edit ? <>
        <div className={styles.sourceActions}>
          <div><strong>Правила з документа</strong><p className={styles.muted}>Підстав текст із файлу «Правила статіка». Уже збережені зміни не замінюються автоматично.</p></div>
          <button type="button" className="btn subtle" disabled={busy || !record.template} onClick={loadDocument}>Підставити правила з документа</button>
        </div>
        <StaticMarkdownEditor value={draft} onChange={setDraft} disabled={busy} />
        <div className={styles.actions}><span>{dirty ? "Є незбережені зміни. Після збереження версія документа зміниться." : "Markdown зберігається як окремі правила Статика."}</span><button type="button" className="btn primary" disabled={busy || !dirty || draft.trim().length < 20} onClick={() => void save()}>{busy ? "Зберігаємо…" : "Зберегти правила"}</button></div>
      </> : <div className={styles.rules}><StaticMarkdown value={record.settings.text || "*Правила ще не опубліковано.*"} /></div>}
    </section>}
  </div>;
}
