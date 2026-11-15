"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { requestRaidPollMutation, raidPollMutationFailure } from "@/lib/raidPollMutation";
import { useDashboardRequests } from "@/hooks/useDashboardRequests";
import { useActionFocus } from "@/hooks/useActionFocus";
import PollDirectoryCard from "@/components/polls/PollDirectoryCard";
import FilterToolbar from "@/components/page/FilterToolbar";
import EmptyState from "@/components/page/EmptyState";
import DataGrid from "@/components/page/DataGrid";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";
import styles from "@/components/polls/poll-workspace.module.css";

import ListViewMemory from "@/components/ListViewMemory";
import { listViewUrl } from "@/lib/listViewState";
import { replaceClientListLocation } from "@/lib/clientListLocation";

export type RaidPollCardModel = {
  id: string;
  shortId: string;
  title: string;
  description: string;
  difficulty: string;
  difficultyLabel: string;
  state: "scheduled" | "open" | "paused" | "closed";
  statusLabel: string;
  dayLabels: string[];
  votes: number;
  tanks: number;
  healers: number;
  dps: number;
  deadlineCaption: string;
  deadlineLabel: string;
  remainingLabel: string;
  recommendation: string;
  repeatLabel: string;
  autoRepeat: boolean;
  pausedNote: string | null;
  messageUrl: string | null;
};

type TabKey = "all" | "scheduled" | "open" | "paused" | "closed";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "Усі" },
  { key: "scheduled", label: "Заплановані" },
  { key: "open", label: "Активні" },
  { key: "paused", label: "На паузі" },
  { key: "closed", label: "Архів" },
];

export default function RaidPollBrowser({
  cards,
  canManage = false,
  navigationScope,
}: {
  cards: RaidPollCardModel[];
  canManage?: boolean;
  createHref?: string;
  navigationScope: string;
}) {
  const counts = useMemo(
    () => ({
      all: cards.length,
      scheduled: cards.filter((card) => card.state === "scheduled").length,
      open: cards.filter((card) => card.state === "open").length,
      paused: cards.filter((card) => card.state === "paused").length,
      closed: cards.filter((card) => card.state === "closed").length,
    }),
    [cards],
  );

  const search = useSearchParams();
  const [initialTab] = useState<TabKey>(() => counts.scheduled ? "scheduled" : counts.open ? "open" : counts.paused ? "paused" : counts.closed ? "closed" : "all");
  const filters = new URL(listViewUrl("polls", `/polls?${search}`) || "/polls", "https://list.invalid").searchParams;
  if (!filters.has("tab")) filters.set("tab", search.get("view") === "all" ? "all" : initialTab);
  const currentUrl = listViewUrl("polls", `/polls?${filters}`) || "/polls";
  const tab = (filters.get("tab") || "all") as TabKey;
  const urlQuery = filters.get("q") || "";
  const [query, setQuery] = useState(urlQuery);
  const ownQuery = useRef<string | null>(null);
  useEffect(() => {
    if (ownQuery.current !== urlQuery) setQuery(urlQuery);
    ownQuery.current = null;
  }, [urlQuery]);
  function changeQuery(value: string) {
    setQuery(value); setSelected([]);
    const href = replaceClientListLocation("polls", { q: value });
    ownQuery.current = new URL(href, "https://list.invalid").searchParams.get("q") || "";
  }
  function changeTab(value: TabKey) {
    setSelected([]);
    replaceClientListLocation("polls", { tab: value });
  }
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkPending, setBulkPending] = useState(false);
  type ItemResult = { id: string; title: string; outcome: "confirmed" | "partial" | "rejected" | "unconfirmed"; message: string };
  const [results, setResults] = useState<ItemResult[]>([]);
  const [resultKind, setResultKind] = useState<"close" | "delete" | null>(null);
  const [summary, setSummary] = useState("");
  const requests = useDashboardRequests();
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLElement>(bulkPending);
  const router = useRouter();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (tab !== "all" && card.state !== tab) return false;
      if (!needle) return true;
      return `${card.title} ${card.description} ${card.difficultyLabel} ${card.id}`.toLowerCase().includes(needle);
    });
  }, [cards, tab, query]);

  const visibleIds = new Set(visible.map(card => card.id));
  const visibleSelection = selected.filter(id => visibleIds.has(id));


  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  /**
   * Масові дії йдуть послідовно, а не Promise.all: паралельні виклики
   * вперлися б у rate limit Discord і частина пулів лишилась би
   * неоновленою без жодного сигналу користувачу.
   */
  async function runBulk(kind: "close" | "delete", trigger: HTMLElement) {
    if (!canManage || requests.pending("bulk") || bulkPending || !visibleSelection.length) return;
    const scheduledSelected = visible.filter(card => card.state === "scheduled" && visibleSelection.includes(card.id)).length;
    const question = kind === "close"
      ? `Закрити вибрані рейд-пули (${visibleSelection.length})?${scheduledSelected ? `\n\nЗапланованих: ${scheduledSelected}. Їхню публікацію буде скасовано, а автоповтор вимкнено.` : ""}`
      : `Видалити вибрані рейд-пули (${visibleSelection.length})? Дію не можна скасувати.`;
    if (!window.confirm(question)) return;

    const request = requests.begin("bulk", Math.max(45_000, visibleSelection.length * 45_000));
    beginActionFocus(trigger, { preferResult: true });
    setBulkPending(true); setResultKind(kind); setResults([]); setSummary(`Обробляємо: 0 з ${visibleSelection.length}.`);
    const items: ItemResult[] = [];
    try {
      for (const id of visibleSelection) {
        if (!request.current()) return;
        const title = cards.find(card => card.id === id)?.title || id;
        try {
          const data = await requestRaidPollMutation(kind === "delete" ? `/api/polls/${encodeURIComponent(id)}` : `/api/polls/${encodeURIComponent(id)}/close`, {
            method: kind === "delete" ? "DELETE" : "POST", action: `bulk-${kind}-raid-poll`, signal: request.signal, json: kind === "close" ? { action: "close" } : undefined,
          });
          if (!request.current()) return;
          const partial = Boolean(data.warning || data.discordDeleteFailed);
          items.push({ id, title, outcome: partial ? "partial" : "confirmed", message: data.warning || (partial ? "Запис змінено, оновлення Discord потребує перевірки." : "Сервер підтвердив виконання.") });
        } catch (error) {
          if (!request.current()) return;
          items.push({ id, title, ...raidPollMutationFailure(error) });
        }
        setResults([...items]); setSummary(`Оброблено: ${items.length} з ${visibleSelection.length}.`);
      }
      const count = (outcome: ItemResult["outcome"]) => items.filter(item => item.outcome === outcome).length;
      const confirmed = count("confirmed"), partial = count("partial"), rejected = count("rejected"), unconfirmed = count("unconfirmed");
      const message = `Підтверджено: ${confirmed}. Частково: ${partial}. Відхилено: ${rejected}. Не підтверджено: ${unconfirmed}.`;
      setSummary(message);
      // Unknown outcomes must not remain selected for an accidental bulk replay.
      setSelected(items.filter(item => item.outcome === "rejected").map(item => item.id));
      dispatchDashboardToast({ tone: partial || rejected || unconfirmed ? "warning" : "success", title: partial || rejected || unconfirmed ? "Обробку завершено з зауваженнями" : kind === "close" ? "Рейд-пули закрито" : "Рейд-пули видалено", message, ttl: 7200 });
      if (confirmed || partial) router.refresh();
    } finally {
      if (request.current()) setBulkPending(false);
      request.finish();
    }
  }

  return (
    <section ref={scopeRef} className={styles.stack} aria-label="Список рейд-пулів" aria-busy={bulkPending}>
      <ListViewMemory key={navigationScope} kind="polls" scope={navigationScope} currentUrl={currentUrl} />
      <FilterToolbar label="Пошук і фільтри рейд-пулів" search={<FormField label="Пошук рейд-пулу" type="search" maxLength={160} value={query} disabled={bulkPending} onChange={event => changeQuery(event.target.value)} placeholder="Назва, складність або ID" autoComplete="off" />}
        filters={<label>Стан<select value={tab} disabled={bulkPending} onChange={event => changeTab(event.target.value as TabKey)}>{TABS.map(item => <option key={item.key} value={item.key}>{item.label} ({counts[item.key]})</option>)}</select></label>}
        actions={<Button disabled={bulkPending || !query && tab === "all"} onClick={() => {setSelected([]);setQuery("");replaceClientListLocation("polls", {q: null,tab: "all",view: "all"});}}>Скинути</Button>}
        result={`Показано ${visible.length} із ${cards.length}`} />
      <p className={styles.result} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="" data-bulk-result="">{summary}</p>
      {results.length ? <ul className={styles.results} aria-label="Результати масової дії">{results.map(item => <li key={item.id} data-poll-outcome={item.outcome}><strong>{item.title}</strong><span>{item.message}</span><a href={resultKind === "delete" && (item.outcome === "confirmed" || item.outcome === "partial") ? "/polls" : `/polls/${encodeURIComponent(item.id)}`}>{resultKind === "delete" && (item.outcome === "confirmed" || item.outcome === "partial") ? "До списку рейд-пулів" : "Перевірити стан"}</a></li>)}</ul> : null}
      {canManage && visibleSelection.length ? (
        <div className={styles.bulk} role="region" aria-label="Масові дії">
          <strong>Вибрано: {visibleSelection.length}</strong>
          <button type="button" className="btn subtle" onClick={() => setSelected([])} disabled={bulkPending}>Зняти вибір</button>
          <button type="button" className="btn subtle" onClick={() => setSelected(visible.map((card) => card.id))} disabled={bulkPending}>
            Вибрати всі у вкладці
          </button>
          <button type="button" className="btn danger" onClick={event => void runBulk("close", event.currentTarget)} disabled={bulkPending}>
            {bulkPending ? "Обробляємо…" : tab === "scheduled" ? "Скасувати заплановані" : "Закрити вибрані"}
          </button>
          <button type="button" className="btn danger" onClick={event => void runBulk("delete", event.currentTarget)} disabled={bulkPending}>
            {bulkPending ? "Обробляємо…" : "Видалити вибрані"}
          </button>
        </div>
      ) : null}

      <DataGrid label="Рейд-пули" columns="two">
        {visible.length ? (
          visible.map((card) => (
            <PollDirectoryCard
              key={card.id}
              card={card}
              canManage={canManage}
              selected={visibleSelection.includes(card.id)}
              selectionDisabled={bulkPending}
              onToggle={toggle}
            />
          ))
        ) : (
          <EmptyState title={query.trim() ? "Нічого не знайдено" : "У цьому списку поки немає пулів"} description="Зміни пошук або стан, щоб переглянути інші голосування." actions={<Button onClick={() => {changeQuery("");changeTab("all");}}>Показати всі</Button>} />
        )}
      </DataGrid>
    </section>
  );
}
