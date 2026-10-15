"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ApplicationStatus } from "@/lib/github";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { useActionFocus } from "@/lib/useActionFocus";
import {
  readApplicationDecision, submitApplicationDecisions, summarizeApplicationDecisions, uncertainApplicationResult,
  type ApplicationDecision, type ApplicationDecisionResult,
} from "@/lib/applicationModerationClient";

export type ApplicationQueueItem = { issueNumber: number; status: ApplicationStatus; state: string };
type Row = ApplicationQueueItem & { busy: boolean; message: string; outcome?: ApplicationDecisionResult["outcome"] };
type Queue = {
  rows: Record<number, Row>; order: number[]; selected: number[]; canModerate: boolean;
  toggle: (number: number) => void; select: (numbers: number[]) => void;
  moderate: (numbers: number[], decision: ApplicationDecision, bulk?: boolean) => Promise<void>;
  reconcile: (number: number) => Promise<void>;
  lock: (number: number) => boolean; release: (number: number) => void;
};
const Context = createContext<Queue | null>(null);
export function useApplicationModerationQueue() {
  const context = useContext(Context);
  if (!context) throw new Error("ApplicationModerationProvider is required");
  return context;
}
function initialRows(items: ApplicationQueueItem[]) {
  return Object.fromEntries(items.map((item) => [item.issueNumber, { ...item, busy: false, message: "" }])) as Record<number, Row>;
}
function available(row: Row | undefined) { return Boolean(row && row.status === "review" && row.state !== "closed" && !row.busy && row.outcome !== "uncertain"); }

export function ApplicationModerationProvider({ items, canModerate, children }: { items: ApplicationQueueItem[]; canModerate: boolean; children: ReactNode }) {
  const [rows, setRows] = useState(() => initialRows(items));
  const rowsRef = useRef(rows);
  const [selected, setSelected] = useState<number[]>([]);
  const [results, setResults] = useState<ApplicationDecisionResult[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLElement>(bulkBusy);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const locks = useRef(new Set<number>());
  function update(change: (current: Record<number, Row>) => Record<number, Row>) {
    rowsRef.current = change(rowsRef.current);
    if (mounted.current) setRows(rowsRef.current);
  }
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    update((current) => Object.fromEntries(items.map((item) => {
      const old = current[item.issueNumber];
      if (old?.busy || old?.outcome === "uncertain" || old && old.status !== "review" && item.status === "review") return [item.issueNumber, old];
      return [item.issueNumber, { ...old, ...item, busy: false, message: old?.status === item.status ? old.message : "" }];
    })));
    setSelected((current) => current.filter((number) => items.some((item) => item.issueNumber === number && item.status === "review" && item.state !== "closed")));
  }, [items]);
  function lock(number: number) {
    if (locks.current.has(number) || !rowsRef.current[number]) return false;
    locks.current.add(number);
    update((current) => ({ ...current, [number]: { ...current[number], busy: true } }));
    return true;
  }
  function release(number: number) {
    locks.current.delete(number);
    update((current) => current[number] ? { ...current, [number]: { ...current[number], busy: false } } : current);
  }
  function apply(result: ApplicationDecisionResult) {
    update((current) => current[result.issueNumber] ? { ...current, [result.issueNumber]: {
      ...current[result.issueNumber], ...(result.status ? { status: result.status, state: result.state || "closed" } : {}),
      outcome: result.outcome, message: result.message,
    } } : current);
  }
  async function moderate(numbers: number[], decision: ApplicationDecision, bulk = false) {
    if (!canModerate) return;
    const targets = Array.from(new Set(numbers)).filter((number) => available(rowsRef.current[number]) && !locks.current.has(number)).slice(0, 50);
    if (!targets.length) return;
    targets.forEach(lock);
    if (bulk) { setBulkBusy(true); setResults([]); }
    let outcome: ApplicationDecisionResult[];
    try {
      outcome = await submitApplicationDecisions(dashboardApiJson, targets, decision, controller.current?.signal);
    } catch {
      outcome = targets.map(uncertainApplicationResult);
    }
    if (mounted.current) {
      outcome.forEach(apply);
      setSelected((current) => current.filter((number) => !targets.includes(number)));
      if (bulk) setResults(outcome);
      const summary = summarizeApplicationDecisions(outcome);
      dispatchDashboardToast({ tone: summary.uncertain || summary.discordPending ? "warning" : "success", title: summary.uncertain ? "Потрібна перевірка стану" : "Обробку заявок завершено",
        message: `Змінено: ${summary.changed}. Вже розглянуто: ${summary.already}. Discord не підтверджено: ${summary.discordPending}. Непевний результат: ${summary.uncertain}.` });
      if (outcome.some((item) => item.status)) notifyDashboardDataChanged({ scope: "applications", source: "application-status", action: decision });
    }
    targets.forEach(release);
    if (mounted.current && bulk) setBulkBusy(false);
  }
  async function reconcile(number: number) {
    if (!canModerate || !lock(number)) return;
    try {
      const result = await readApplicationDecision(dashboardApiJson, number, controller.current?.signal);
      if (mounted.current) {
        apply(result);
        setResults((current) => current.map((item) => item.issueNumber === number ? result : item));
      }
    } catch {
      if (mounted.current) apply(uncertainApplicationResult(number));
    } finally { release(number); }
  }
  function select(numbers: number[]) {
    if (canModerate) setSelected(Array.from(new Set(numbers)).filter((number) => available(rowsRef.current[number])).slice(0, 50));
  }
  function toggle(number: number) {
    if (!canModerate || !available(rowsRef.current[number])) return;
    setSelected((current) => current.includes(number) ? current.filter((item) => item !== number) : current.length < 50 ? [...current, number] : current);
  }
  const eligible = items.map((item) => item.issueNumber).filter((number) => available(rows[number]));
  const selectedEligible = selected.filter((number) => available(rows[number]));
  const summary = summarizeApplicationDecisions(results);
  function confirmBulk(decision: ApplicationDecision, trigger: HTMLButtonElement) {
    if (!selectedEligible.length || bulkBusy) return;
    const action = decision === "accepted" ? "Прийняти" : "Відхилити";
    if (window.confirm(`${action} ${selectedEligible.length} вибраних заявок? Остаточне рішення закриє кожну з них.`)) {
      beginActionFocus(trigger);
      void moderate(selectedEligible, decision, true);
    }
  }
  return <Context.Provider value={{ rows, order: items.map((item) => item.issueNumber), selected, canModerate, select, toggle, moderate, reconcile, lock, release }}>
    {canModerate && items.length ? <section ref={scopeRef} className="application-bulk panel" aria-label="Масова обробка видимих заявок" aria-busy={bulkBusy}>
      <div className="application-bulk__heading"><div><strong>Дії з вибраними заявками</strong><p>Тільки заявки на розгляді з поточного списку. До 50 за одну дію.</p></div><span>Вибрано: {selectedEligible.length}</span></div>
      <div className="application-bulk__actions">
        <button className="btn subtle" type="button" onClick={() => select(eligible.slice(0, 50))} disabled={bulkBusy || !eligible.length}>Вибрати {Math.min(eligible.length, 50)}</button>
        <button className="btn subtle" type="button" onClick={() => select([])} disabled={bulkBusy || !selected.length}>Скинути вибір</button>
        <button className="btn primary" type="button" onClick={(event) => confirmBulk("accepted", event.currentTarget)} disabled={bulkBusy || !selectedEligible.length}>Прийняти вибрані</button>
        <button className="btn danger" type="button" onClick={(event) => confirmBulk("declined", event.currentTarget)} disabled={bulkBusy || !selectedEligible.length}>Відхилити вибрані</button>
      </div>
      <p data-action-result tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{bulkBusy ? "Обробляємо заявки. Після втрати відповіді перевіримо збережений стан за твоєю дією." : results.length ? `Змінено: ${summary.changed} · Вже розглянуто: ${summary.already} · Discord не підтверджено: ${summary.discordPending} · Непевний результат: ${summary.uncertain}` : ""}</p>
      {results.length ? <div className="application-bulk__results">
        <ul>{results.map((item) => <li key={item.issueNumber} data-outcome={item.outcome}><a href={`#application-result-${item.issueNumber}`}>#{item.issueNumber}</a> — {item.message}</li>)}</ul>
      </div> : null}
    </section> : null}
    {children}
  </Context.Provider>;
}

export function ApplicationSelection({ issueNumber }: { issueNumber: number }) {
  const queue = useApplicationModerationQueue();
  if (!queue.canModerate) return null;
  return <label className="application-selection"><input type="checkbox" checked={queue.selected.includes(issueNumber)} disabled={!available(queue.rows[issueNumber])} onChange={() => queue.toggle(issueNumber)} aria-label={`Вибрати заявку #${issueNumber}`} />Вибрати заявку</label>;
}

export function ApplicationNextReview({ issueNumber }: { issueNumber: number }) {
  const { rows, order } = useApplicationModerationQueue();
  const index = order.indexOf(issueNumber);
  const next = [...order.slice(index + 1), ...order.slice(0, Math.max(0, index))].find((number) => number !== issueNumber && available(rows[number]));
  if (!next) return null;
  return <button className="btn subtle" type="button" onClick={() => {
    const target = document.getElementById(`application-decision-${next}`);
    target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    target?.querySelector<HTMLButtonElement>("[data-decision-primary]")?.focus({ preventScroll: true });
  }}>Наступна заявка на розгляді</button>;
}
