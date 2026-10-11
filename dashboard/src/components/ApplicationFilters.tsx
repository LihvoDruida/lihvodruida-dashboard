"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { listViewUrl } from "@/lib/listViewState";

type ApplicationFiltersProps = {
  initialQuery?: string;
  initialStatus?: string;
  initialClass?: string;
  initialSort?: string;
  classOptions: string[];
};

const DEFAULTS = {
  q: "",
  status: "all",
  class: "all",
  sort: "created",
};

function normalizedValue(value: string | null | undefined, fallback: string) {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function buildNextUrl(pathname: string, updates: Record<string, string>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(updates)) {
    const clean = String(value || "").trim();
    const fallback = DEFAULTS[key as keyof typeof DEFAULTS];
    if (!clean || clean === fallback) {
      params.delete(key);
    } else {
      params.set(key, clean);
    }
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function ApplicationFilters({
  initialQuery = "",
  initialStatus = "all",
  initialClass = "all",
  initialSort = "created",
  classOptions,
}: ApplicationFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(normalizedValue(initialStatus, DEFAULTS.status));
  const [className, setClassName] = useState(normalizedValue(initialClass, DEFAULTS.class));
  const [sort, setSort] = useState(normalizedValue(initialSort, DEFAULTS.sort));
  const latestFiltersRef = useRef({ status, className, sort });
  const lastRequestedRef = useRef("");
  const resettingRef = useRef(false);
  const paramsString = searchParams.toString();

  const options = useMemo(() => Array.from(new Set(classOptions.filter(Boolean))).sort(), [classOptions]);

  useEffect(() => {
    setQuery(initialQuery);
    setStatus(normalizedValue(initialStatus, DEFAULTS.status));
    setClassName(normalizedValue(initialClass, DEFAULTS.class));
    setSort(normalizedValue(initialSort, DEFAULTS.sort));
  }, [initialQuery, initialStatus, initialClass, initialSort]);

  useEffect(() => {
    latestFiltersRef.current = { status, className, sort };
  }, [status, className, sort]);

  useEffect(() => { lastRequestedRef.current = ""; resettingRef.current = false; }, [paramsString]);

  const applyFilters = useCallback((updates: Record<string, string>) => {
    const safePathname = pathname || "/";
    const nextUrl = listViewUrl("applications", buildNextUrl(safePathname, updates)) || "/applications";
    const currentUrl = listViewUrl("applications", `${safePathname}?${paramsString}`);
    if (nextUrl === currentUrl || nextUrl === lastRequestedRef.current) return;
    lastRequestedRef.current = nextUrl;
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [pathname, router, paramsString, startTransition]);

  useEffect(() => {
    if (resettingRef.current || query.trim() === initialQuery.trim()) return;
    const timer = window.setTimeout(() => {
      const latest = latestFiltersRef.current;
      applyFilters({ q: query, status: latest.status, class: latest.className, sort: latest.sort });
    }, 360);

    return () => window.clearTimeout(timer);
  }, [applyFilters, query, initialQuery]);

  function applyImmediate(next: Partial<Record<keyof typeof DEFAULTS, string>>) {
    resettingRef.current = false;
    const merged = {
      q: next.q ?? query,
      status: next.status ?? status,
      class: next.class ?? className,
      sort: next.sort ?? sort,
    };
    latestFiltersRef.current = { status: merged.status, className: merged.class, sort: merged.sort };
    applyFilters(merged);
  }

  function resetFilters() {
    resettingRef.current = true;
    setQuery("");
    setStatus(DEFAULTS.status);
    setClassName(DEFAULTS.class);
    setSort(DEFAULTS.sort);
    latestFiltersRef.current = { status: DEFAULTS.status, className: DEFAULTS.class, sort: DEFAULTS.sort };
    lastRequestedRef.current = "/applications?view=all";
    startTransition(() => { router.replace("/applications?view=all", { scroll: false }); });
  }

  const hasActiveFilters = Boolean(query.trim()) || status !== DEFAULTS.status || className !== DEFAULTS.class || sort !== DEFAULTS.sort;

  return (
    <section className="toolbar panel applications-live-filters" aria-label="Фільтри заявок" data-updating={isPending ? "true" : "false"}>
      <label className="application-filter-field application-filter-field--search">
        <span>Пошук</span>
        <input
          className="input"
          name="q"
          type="search"
          maxLength={160}
          placeholder="Номер заявки, номер відстеження, нік, realm, клас..."
          value={query}
          autoComplete="off"
          onChange={(event) => { resettingRef.current = false; setQuery(event.currentTarget.value); }}
        />
      </label>

      <label className="application-filter-field">
        <span>Статус</span>
        <select
          className="select"
          name="status"
          value={status}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setStatus(next);
            applyImmediate({ status: next });
          }}
        >
          <option value="all">Усі статуси</option>
          <option value="review">На розгляді</option>
          <option value="accepted">Прийнято</option>
          <option value="declined">Відхилено</option>
        </select>
      </label>

      <label className="application-filter-field">
        <span>Клас</span>
        <select
          className="select"
          name="class"
          value={className}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setClassName(next);
            applyImmediate({ class: next });
          }}
        >
          <option value="all">Усі класи</option>
          {className !== "all" && !options.includes(className) ? <option value={className}>{className} (немає у поточному списку)</option> : null}
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>

      <label className="application-filter-field">
        <span>Сортування</span>
        <select
          className="select"
          name="sort"
          value={sort}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setSort(next);
            applyImmediate({ sort: next });
          }}
        >
          <option value="created">За датою</option>
          <option value="updated">За оновленням</option>
        </select>
      </label>

      <div className="application-filter-actions">
        <button className="btn subtle btn-sm" type="button" disabled={!hasActiveFilters || isPending} onClick={resetFilters}>Скинути</button>
        <span className="application-filter-state" aria-live="polite">{isPending ? "Оновлюємо..." : "Автофільтр"}</span>
      </div>
    </section>
  );
}
