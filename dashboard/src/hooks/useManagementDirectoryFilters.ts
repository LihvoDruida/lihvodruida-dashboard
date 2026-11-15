"use client";

import { useEffect, useState } from "react";
import { normalizeDirectoryFilters, type ManagementDirectoryFilters } from "@/lib/managementDirectory";

export default function useManagementDirectoryFilters(initial: ManagementDirectoryFilters) {
  const [filters, setFilters] = useState(() => normalizeDirectoryFilters(initial));
  useEffect(() => {
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search);
      setFilters(normalizeDirectoryFilters({ query: params.get("q"), section: params.get("section"), sort: params.get("sort") }));
    };
    window.addEventListener("popstate", readLocation);
    return () => window.removeEventListener("popstate", readLocation);
  }, []);
  function update(next: ManagementDirectoryFilters) {
    const normalized = normalizeDirectoryFilters(next);
    setFilters(normalized);
    const url = new URL(window.location.href);
    for (const [key, value] of [["q", normalized.query], ["section", normalized.section === "all" ? "" : normalized.section], ["sort", normalized.sort === "recommended" ? "" : normalized.sort]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  return { filters, update };
}
