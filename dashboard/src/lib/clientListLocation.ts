"use client";

import { listViewUrl, type ListKind } from "@/lib/listViewState";

export function patchListUrl(kind: ListKind, current: string, patch: Record<string, string | null>): string {
  const safe = listViewUrl(kind, current) || `/${kind}`;
  const url = new URL(safe, "https://list.invalid");
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return listViewUrl(kind, url.pathname + url.search) || `/${kind}`;
}

/** Next's native History API integration updates useSearchParams without an RSC request. */
export function replaceClientListLocation(kind: ListKind, patch: Record<string, string | null>): string {
  const href = patchListUrl(kind, window.location.pathname + window.location.search, patch);
  if (window.location.pathname + window.location.search !== href) window.history.replaceState(null, "", href);
  return href;
}
