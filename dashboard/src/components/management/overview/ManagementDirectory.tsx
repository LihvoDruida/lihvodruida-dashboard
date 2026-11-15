"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import FilterToolbar from "@/components/page/FilterToolbar";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import EmptyState from "@/components/page/EmptyState";
import StatusBadge from "@/components/page/StatusBadge";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";
import useManagementDirectoryFilters from "@/hooks/useManagementDirectoryFilters";
import {
  DEFAULT_DIRECTORY_FILTERS, MANAGEMENT_CATEGORY_LABELS, filterManagementDirectory,
  type ManagementDirectoryItem, type ManagementDirectoryFilters,
} from "@/lib/managementDirectory";

export default function ManagementDirectory({ items, initialFilters }: {
  items: readonly ManagementDirectoryItem[];
  initialFilters: ManagementDirectoryFilters;
}) {
  const { filters, update } = useManagementDirectoryFilters(initialFilters);
  const prefix = useId();
  const results = useMemo(() => filterManagementDirectory(items, filters), [items, filters]);
  const categories = Object.entries(MANAGEMENT_CATEGORY_LABELS).filter(([key]) => items.some(item => item.section === key));
  const hasFilters = Boolean(filters.query || filters.section !== "all" || filters.sort !== "recommended");
  const reset = () => update(DEFAULT_DIRECTORY_FILTERS);
  return <>
    <FilterToolbar label="Пошук і фільтри розділів"
      search={<FormField type="search" label="Пошук розділу" id={`${prefix}-search`} name="q" value={filters.query} maxLength={160}
        placeholder="Назва або призначення" onChange={event => update({ ...filters, query: event.target.value })} />}
      filters={<>
        <label htmlFor={`${prefix}-section`}>Категорія<select id={`${prefix}-section`} name="section" value={filters.section}
          onChange={event => update({ ...filters, section: event.target.value as ManagementDirectoryFilters["section"] })}>
          <option value="all">Усі категорії</option>
          {categories.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
        </select></label>
        <label htmlFor={`${prefix}-sort`}>Сортування<select id={`${prefix}-sort`} name="sort" value={filters.sort}
          onChange={event => update({ ...filters, sort: event.target.value === "title" ? "title" : "recommended" })}>
          <option value="recommended">За призначенням</option><option value="title">За назвою</option>
        </select></label>
      </>}
      actions={hasFilters ? <Button onClick={reset}>Скинути</Button> : null}
      result={`Знайдено: ${results.length} із ${items.length}`} />
    {!items.length ? <EmptyState title="Немає доступних розділів" description="Для цієї групи не призначено інструментів керування. Перевір права групи з власником сервера." />
      : !results.length ? <EmptyState title="Нічого не знайдено" description="Спробуй іншу назву або скинь фільтри."
          actions={<Button onClick={reset}>Показати всі розділи</Button>} />
      : <DataGrid label="Доступні розділи керування">
        {results.map(item => <DataCard key={item.key} title={item.label} description={item.description}
          badge={<StatusBadge>{MANAGEMENT_CATEGORY_LABELS[item.section]}</StatusBadge>}
          actions={<Link href={item.href} className="btn subtle" prefetch={false}>Відкрити<span className="sr-only"> {item.label}</span></Link>} />)}
      </DataGrid>}
  </>;
}
