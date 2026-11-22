"use client";

import { useEffect, useMemo, useState } from "react";
import { COMMUNITY_LIMITS, isCommunityLink, isCommunityLogo, type SiteCommunity } from "@/lib/siteCommunityModel";
import styles from "./communities.module.css";

type Draft = SiteCommunity & { uid: string };
type Status = { tone: "success" | "error"; text: string } | null;

let uidCounter = 0;
const uid = () => `c${Date.now().toString(36)}${(uidCounter += 1)}`;
const toDraft = (items: SiteCommunity[]) => items.map((item) => ({ ...item, details: item.details.map((d) => ({ ...d })), links: item.links.map((l) => ({ ...l })), uid: uid() }));
const blank = (): Draft => ({ uid: uid(), id: "", name: "", game: "", logo: "", description: "", page: "", pageLabel: "", details: [], links: [] });
const strip = (items: Draft[]) => items.map(({ uid: _uid, ...item }) => item);

function LogoPreview({ logo, file, name }: { logo: string; file?: File; name: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setBlobUrl(null); return; }
    const url = URL.createObjectURL(file);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Uploaded media is served by the panel; site artwork (/assets/img) lives on the site only.
  const src = blobUrl || (/^\/api\/site\/media\/[a-f0-9]{64}$/.test(logo) ? logo : null);
  return <span className={styles.logo} aria-hidden="true">{src ? <img src={src} alt="" /> : <span>{(name || "?").charAt(0)}</span>}</span>;
}

/** Editor of the public site's Communities block (home page, section 01). */
export default function CommunitiesEditor({ initialItems, initialRevision, customized, siteUrl }: { initialItems: SiteCommunity[]; initialRevision: number; customized: boolean; siteUrl: string }) {
  const [items, setItems] = useState<Draft[]>(() => toDraft(initialItems));
  const [saved, setSaved] = useState(() => JSON.stringify(initialItems));
  const [revision, setRevision] = useState(initialRevision);
  const [files, setFiles] = useState<Record<string, File>>({});
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(customized ? null : { tone: "success", text: "Зараз на сайті вміст за замовчуванням. Після першого збереження блок керується звідси." });
  const dirty = useMemo(() => JSON.stringify(strip(items)) !== saved || Object.keys(files).length > 0, [items, saved, files]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (key: string, patch: Partial<Draft>) => setItems((list) => list.map((item) => (item.uid === key ? { ...item, ...patch } : item)));
  const move = (index: number, to: number) => setItems((list) => {
    if (to < 0 || to >= list.length) return list;
    const next = [...list]; const [item] = next.splice(index, 1); next.splice(to, 0, item); return next;
  });
  const remove = (key: string) => {
    setItems((list) => list.filter((item) => item.uid !== key));
    setFiles(({ [key]: _removed, ...rest }) => rest);
  };

  async function save() {
    setPending(true); setStatus(null);
    const form = new FormData();
    form.set("payload", JSON.stringify({ items: strip(items), revision }));
    items.forEach((item, index) => { if (files[item.uid]) form.set(`logo-${index}`, files[item.uid]); });
    try {
      const response = await fetch("/api/content/communities", { method: "POST", body: form, headers: { Accept: "application/json" } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) { setStatus({ tone: "error", text: result.error || "Не вдалося зберегти. Повтори пізніше." }); return; }
      setItems(toDraft(result.state.items)); setSaved(JSON.stringify(result.state.items)); setRevision(result.state.revision); setFiles({});
      setStatus({ tone: "success", text: "Збережено. Сайт покаже зміни протягом кількох секунд." });
    } catch {
      setStatus({ tone: "error", text: "Немає звʼязку з панеллю. Перевір мережу й повтори." });
    } finally { setPending(false); }
  }

  return <div className={styles.editor}>
    <div className={styles.toolbar}>
      <p className={styles.hint}>Картки «01 / Спільноти» на головній сайту, у цьому порядку. До {COMMUNITY_LIMITS.items} спільнот.</p>
      <div className={styles.toolbarActions}>
        <a className="btn subtle" href={siteUrl} target="_blank" rel="noreferrer">Відкрити сайт ↗</a>
        <button type="button" className="btn subtle" disabled={items.length >= COMMUNITY_LIMITS.items} onClick={() => setItems((list) => [...list, blank()])}>Додати спільноту</button>
        <button type="button" className="btn primary" disabled={!dirty || pending} onClick={save}>{pending ? "Зберігаємо…" : "Зберегти"}</button>
      </div>
    </div>
    {status ? <p className={styles.status} data-tone={status.tone} role={status.tone === "error" ? "alert" : "status"}>{status.text}</p> : null}
    {items.length === 0 ? <p className={styles.hint}>Спільнот немає — блок на сайті буде порожнім. Додай хоча б одну.</p> : null}
    <ol className={styles.list}>
      {items.map((item, index) => {
        const field = (key: keyof Draft) => `${item.uid}-${String(key)}`;
        const logoProblem = !files[item.uid] && item.logo && !isCommunityLogo(item.logo);
        return <li key={item.uid} className={styles.card}>
          <div className={styles.cardHead}>
            <LogoPreview logo={item.logo} file={files[item.uid]} name={item.name} />
            <span className={styles.cardTitle}><strong>{item.name || "Нова спільнота"}</strong><small>{item.game || "Гра не вказана"}</small></span>
            <span className={styles.cardActions}>
              <button type="button" className="btn subtle" onClick={() => move(index, index - 1)} disabled={index === 0} aria-label={`Перемістити ${item.name || "спільноту"} вище`}>↑</button>
              <button type="button" className="btn subtle" onClick={() => move(index, index + 1)} disabled={index === items.length - 1} aria-label={`Перемістити ${item.name || "спільноту"} нижче`}>↓</button>
              <button type="button" className="btn subtle danger" onClick={() => remove(item.uid)}>Видалити</button>
            </span>
          </div>
          <div className={styles.grid}>
            <label>Назва<input id={field("name")} value={item.name} maxLength={COMMUNITY_LIMITS.name} onChange={(e) => update(item.uid, { name: e.target.value })} required /></label>
            <label>Гра<input value={item.game} maxLength={COMMUNITY_LIMITS.game} placeholder="World of Warcraft" onChange={(e) => update(item.uid, { game: e.target.value })} /></label>
            <label className={styles.wide}>Опис<textarea rows={2} value={item.description} maxLength={COMMUNITY_LIMITS.description} onChange={(e) => update(item.uid, { description: e.target.value })} /></label>
            <label>Сторінка на сайті<input value={item.page} maxLength={82} placeholder="/guild — або порожньо" onChange={(e) => update(item.uid, { page: e.target.value })} /></label>
            <label>Текст кнопки<input value={item.pageLabel} maxLength={COMMUNITY_LIMITS.pageLabel} placeholder="Про гільдію" disabled={!item.page} onChange={(e) => update(item.uid, { pageLabel: e.target.value })} /></label>
            <label>Логотип (файл)<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { const file = e.target.files?.[0]; setFiles((all) => { const { [item.uid]: _old, ...rest } = all; return file ? { ...rest, [item.uid]: file } : rest; }); }} /></label>
            <label>або шлях на сайті<input value={item.logo} maxLength={COMMUNITY_LIMITS.url} placeholder="/assets/img/guild-logo.webp" aria-invalid={logoProblem || undefined} onChange={(e) => update(item.uid, { logo: e.target.value })} />{logoProblem ? <small className={styles.error}>Шлях /assets/img/… або завантажений файл.</small> : null}</label>
          </div>
          <fieldset className={styles.rows}>
            <legend>Позначки</legend>
            <p className={styles.hint}>На картці видно лише значення; підпис — для тебе й для читачів екрана.</p>
            {item.details.map((detail, row) => <div className={styles.row} key={row}>
              <input aria-label="Підпис (для доступності)" value={detail.label} maxLength={COMMUNITY_LIMITS.label} placeholder="Реалм" onChange={(e) => update(item.uid, { details: item.details.map((d, i) => (i === row ? { ...d, label: e.target.value } : d)) })} />
              <input aria-label="Значення на картці" value={detail.value} maxLength={COMMUNITY_LIMITS.value} placeholder="EU · Terokkar" onChange={(e) => update(item.uid, { details: item.details.map((d, i) => (i === row ? { ...d, value: e.target.value } : d)) })} />
              <button type="button" className="btn subtle" aria-label="Прибрати позначку" onClick={() => update(item.uid, { details: item.details.filter((_, i) => i !== row) })}>×</button>
            </div>)}
            <button type="button" className="btn subtle" disabled={item.details.length >= COMMUNITY_LIMITS.details} onClick={() => update(item.uid, { details: [...item.details, { label: "", value: "" }] })}>Додати позначку</button>
          </fieldset>
          <fieldset className={styles.rows}>
            <legend>Посилання</legend>
            {item.links.map((link, row) => <div className={styles.row} key={row}>
              <input aria-label="Підпис посилання" value={link.label} maxLength={COMMUNITY_LIMITS.label} placeholder="Discord" onChange={(e) => update(item.uid, { links: item.links.map((l, i) => (i === row ? { ...l, label: e.target.value } : l)) })} />
              <input aria-label="Адреса https" value={link.url} maxLength={COMMUNITY_LIMITS.url} placeholder="https://discord.gg/…" aria-invalid={(link.url && !isCommunityLink(link.url)) || undefined} onChange={(e) => update(item.uid, { links: item.links.map((l, i) => (i === row ? { ...l, url: e.target.value } : l)) })} />
              <button type="button" className="btn subtle" aria-label="Прибрати посилання" onClick={() => update(item.uid, { links: item.links.filter((_, i) => i !== row) })}>×</button>
            </div>)}
            <button type="button" className="btn subtle" disabled={item.links.length >= COMMUNITY_LIMITS.links} onClick={() => update(item.uid, { links: [...item.links, { label: "", url: "" }] })}>Додати посилання</button>
          </fieldset>
        </li>;
      })}
    </ol>
  </div>;
}
