"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { emptyListMemory, listMemoryKey, listViewUrl, parseListMemory, rememberListPosition, type ListKind, type ListMemory, type ListPosition } from "@/lib/listViewState";
import styles from "./ListViewMemory.module.css";

export default function ListViewMemory({ kind, scope, currentUrl, restorePosition = true, clientLocation = false }: { kind: ListKind; scope: string; currentUrl: string; restorePosition?: boolean; clientLocation?: boolean }) {
  const router = useRouter();
  const navigationQuery = useSearchParams().toString();
  const key = listMemoryKey(kind, scope);
  const allHref = `/${kind}?view=all`;
  const effectiveUrl = clientLocation ? listViewUrl(kind, `/${kind}?${navigationQuery}`) || currentUrl : currentUrl;
  const memory = useRef<ListMemory>(emptyListMemory(kind));
  const blocked = useRef(false);
  const first = useRef(true);
  const historyArrival = useRef("");
  const [views, setViews] = useState(memory.current.views);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  function persist(next: ListMemory) {
    memory.current = next;
    setViews(next.views);
    if (blocked.current) return;
    try { sessionStorage.setItem(key, JSON.stringify(next)); }
    catch { setMessage("Браузер не зберіг перегляд. Фільтри працюють, але після виходу позиція може загубитися."); }
  }

  useEffect(() => {
    const url = listViewUrl(kind, effectiveUrl) || `/${kind}`;
    let cancelled = false, leaving = false, timer = 0, frame = 0, highlightTimer = 0;
    let highlighted: HTMLElement | null = null;
    const isArrival = first.current || historyArrival.current === url;
    historyArrival.current = "";
    if (first.current) {
      first.current = false;
      let raw: string | null = null;
      try { raw = sessionStorage.getItem(key); }
      catch { blocked.current = true; setMessage("Браузер не дозволив прочитати пам’ять переглядів. Фільтри працюють без відновлення."); }
      if (!blocked.current) {
        try { memory.current = parseListMemory(kind, raw); }
        catch { blocked.current = true; setMessage("Збережений перегляд пошкоджено. Копію залишено в браузері; можна очистити пам’ять переглядів."); }
      }
      setViews(memory.current.views);
      const actual = new URL(window.location.href);
      if (!actual.search && !actual.hash && memory.current.last !== `/${kind}` && !blocked.current) {
        setMessage("Відновлено попередній перегляд.");
        historyArrival.current = memory.current.last;
        if (clientLocation) window.history.replaceState(null, "", memory.current.last);
        else router.replace(memory.current.last, { scroll: false });
        return;
      }
    }
    const saved = restorePosition ? memory.current.positions.find(item => item.url === url) : undefined;
    const explicitHash = window.location.hash.slice(1);
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>(`[data-list-entry="${kind}"]`));
    const capture = (target?: HTMLElement, opened = false) => {
      const entries = rows();
      const row = target || entries.find(item => item.getBoundingClientRect().bottom > 100);
      const index = row ? entries.indexOf(row) : -1;
      const position: ListPosition = { url, row: row?.id || "", next: entries[index + 1]?.id || "", previous: entries[index - 1]?.id || "", offset: row?.getBoundingClientRect().top || 0, scroll: window.scrollY, at: Date.now(), opened };
      persist(rememberListPosition(memory.current, position));
    };
    const cancel = () => { cancelled = true; };
    const restore = () => {
      if (cancelled || !saved || !isArrival || (explicitHash && explicitHash !== saved.row)) return;
      highlighted = [saved.row, saved.next, saved.previous].map(id => id ? document.getElementById(id) : null).find((row): row is HTMLElement => Boolean(row && row.dataset.listEntry === kind)) || null;
      if (highlighted) {
        window.scrollBy({ top: highlighted.getBoundingClientRect().top - saved.offset, behavior: "instant" });
        if (saved.opened) {
          if (!highlighted.hasAttribute("tabindex")) highlighted.setAttribute("tabindex", "-1");
          highlighted.focus({ preventScroll: true });
          highlighted.classList.add(styles.returned);
          highlightTimer = window.setTimeout(() => highlighted?.classList.remove(styles.returned), 4000);
        }
      } else window.scrollTo({ top: saved.scroll, behavior: "instant" });
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!leaving) capture(); }, 250);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>(`[data-list-entry="${kind}"]`);
      if (row) {
        capture(row, true);
        const anchor = target?.closest<HTMLAnchorElement>("a[href]");
        const rowNavigation = row.dataset.listHref && !target?.closest("a,button,input,select,textarea,label");
        leaving = Boolean((anchor && anchor.target !== "_blank" || rowNavigation) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey);
      }
      const link = target?.closest<HTMLAnchorElement>("a[data-list-reset-position]");
      if (link) {
        const destination = listViewUrl(kind, link.getAttribute("href") || "");
        if (destination) persist(rememberListPosition(memory.current, { url: destination, row: "", next: "", previous: "", offset: 0, scroll: 0, at: Date.now(), opened: false }));
        leaving = true;
      }
    };
    const onKeyOpen = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target instanceof HTMLElement ? event.target : null;
      if (row?.dataset.listEntry === kind && row.dataset.listHref) {
        capture(row, true);
        leaving = true;
      }
    };
    const onSubmit = (event: SubmitEvent) => {
      if (!(event.target instanceof HTMLFormElement) || event.target.dataset.listFilter !== kind) return;
      const params = new URLSearchParams();
      new FormData(event.target).forEach((value, name) => { if (typeof value === "string") params.set(name, value); });
      const destination = listViewUrl(kind, `/${kind}?${params}`);
      if (destination) persist(rememberListPosition(memory.current, { url: destination, row: "", next: "", previous: "", offset: 0, scroll: 0, at: Date.now(), opened: false }));
      leaving = true;
    };
    const onHide = () => { if (!leaving && document.visibilityState === "hidden") capture(); };
    const onPageHide = () => { if (!leaving) capture(); };
    const onHistory = () => { historyArrival.current = listViewUrl(kind, window.location.pathname + window.location.search) || ""; };
    persist({ ...memory.current, last: url, at: Date.now() });
    frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(restore); });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("popstate", onHistory);
    window.addEventListener("pointerdown", cancel, { once: true });
    window.addEventListener("wheel", cancel, { once: true, passive: true });
    window.addEventListener("keydown", cancel, { once: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyOpen, true);
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearTimeout(timer); window.clearTimeout(highlightTimer); window.cancelAnimationFrame(frame);
      highlighted?.classList.remove(styles.returned);
      window.removeEventListener("scroll", onScroll); window.removeEventListener("pagehide", onPageHide); window.removeEventListener("popstate", onHistory);
      window.removeEventListener("pointerdown", cancel); window.removeEventListener("wheel", cancel); window.removeEventListener("keydown", cancel);
      document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit, true); document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("keydown", onKeyOpen, true);
    };
    // The URL changes after filters/navigation; capture always uses its current canonical value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key, effectiveUrl, navigationQuery, restorePosition, router, clientLocation]);

  function openClientView(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!clientLocation || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = event.currentTarget.getAttribute("href") || "";
    if (!listViewUrl(kind, href)) return;
    event.preventDefault();
    historyArrival.current = listViewUrl(kind, href) || "";
    window.history.pushState(null, "", href);
  }

  function saveView(event: React.FormEvent) {
    event.preventDefault();
    const title = name.normalize("NFC").trim().slice(0, 40);
    if (!title) return;
    const existing = memory.current.views.filter(view => view.name !== title);
    if (existing.length >= 5) { setMessage("Можна зберегти до 5 подань. Видаліть одне або використайте його назву для заміни."); return; }
    persist({ ...memory.current, at: Date.now(), views: [...existing, { name: title, url: listViewUrl(kind, effectiveUrl, false) || `/${kind}` }] });
    setEditing(false); setName("");
  }
  function clearMemory() {
    try { sessionStorage.removeItem(key); blocked.current = false; persist(emptyListMemory(kind)); setMessage("Пам’ять переглядів очищено."); }
    catch { setMessage("Браузер не дозволив очистити пам’ять переглядів."); }
  }

  return <div className={styles.bar} aria-label="Збережені перегляди">
    <div className={styles.views}>
      <span className={styles.label}>Мої подання</span>
      {views.map(view => <span key={view.name} className={styles.view}>
        <a data-list-reset-position href={view.url === `/${kind}` ? allHref : view.url} onClick={openClientView}>{view.name}</a>
        <button className="btn subtle btn-sm" type="button" aria-label={`Видалити подання ${view.name}`} onClick={() => persist({ ...memory.current, at: Date.now(), views: memory.current.views.filter(item => item.name !== view.name) })}>×</button>
      </span>)}
    </div>
    <button type="button" className="btn subtle btn-sm" onClick={() => setEditing(!editing)} aria-expanded={editing}>Зберегти подання</button>
    <a className="btn subtle btn-sm" data-list-reset-position href={allHref} onClick={openClientView}>Показати всі</a>
    {blocked.current ? <button className="btn subtle btn-sm" type="button" onClick={clearMemory}>Очистити пам’ять переглядів</button> : null}
    {editing ? <form className={styles.editor} onSubmit={saveView}>
      <label><span className={styles.label}>Назва подання</span><input className="input" aria-label="Назва подання" maxLength={40} value={name} onChange={event => setName(event.target.value)} /></label>
      <button className="btn primary btn-sm" type="submit" disabled={!name.trim() || blocked.current}>Зберегти</button>
      <button className="btn subtle btn-sm" type="button" onClick={() => setEditing(false)}>Скасувати</button>
    </form> : null}
    <p className={styles.message} role="status">{message || "Перегляд запам’ятовується в цій вкладці на 24 години."}</p>
  </div>;
}
