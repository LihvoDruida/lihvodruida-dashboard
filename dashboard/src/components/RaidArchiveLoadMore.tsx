"use client";

import { Children, type ReactNode, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { replaceClientListLocation } from "@/lib/clientListLocation";

type RaidArchiveLoadMoreProps = { children: ReactNode; step?: number; total?: number };
function normalizeStep(value: number | undefined) {
  if (!Number.isFinite(value)) return 6;
  return Math.max(1, Math.min(24, Math.floor(value || 6)));
}
export default function RaidArchiveLoadMore({ children, step = 6, total }: RaidArchiveLoadMoreProps) {
  const items = useMemo(() => Children.toArray(children), [children]);
  const query = useSearchParams();
  const pageSize = normalizeStep(step);
  const requested = Number(query.get("archive"));
  const visibleCount = Number.isFinite(requested) && requested > pageSize ? Math.min(120, Math.floor(requested)) : pageSize;
  const safeVisibleCount = Math.min(visibleCount, items.length);
  const remaining = Math.max(0, items.length - safeVisibleCount);
  const nextCount = Math.min(pageSize, remaining);
  const totalCount = typeof total === "number" && Number.isFinite(total) ? total : items.length;
  return <div className="raid-archive-dynamic" aria-live="polite">
    <div className="raid-manager-list raid-manager-list--archive">{items.slice(0, safeVisibleCount)}</div>
    <div className="raid-archive-footer">
      <span className="raid-archive-status">Показано {safeVisibleCount} з {totalCount}</span>
      {remaining > 0 ? <button className="btn subtle raid-archive-more-button" type="button" onClick={() => replaceClientListLocation("raids", { archive: String(Math.min(items.length, safeVisibleCount + pageSize)) })}>Ще {nextCount}</button> : null}
    </div>
  </div>;
}
