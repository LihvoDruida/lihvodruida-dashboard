export type ManagementCategory = "access" | "discord" | "system";
export type ManagementDirectoryItem = {
  key: string;
  href: string;
  label: string;
  description: string;
  section: ManagementCategory;
};
export type ManagementDirectoryFilters = {
  query: string;
  section: ManagementCategory | "all";
  sort: "recommended" | "title";
};
export const MANAGEMENT_CATEGORY_LABELS: Record<ManagementCategory, string> = {
  access: "Доступ і права", discord: "Discord та учасники", system: "Система",
};
export const DEFAULT_DIRECTORY_FILTERS: ManagementDirectoryFilters = { query: "", section: "all", sort: "recommended" };

export function normalizeDirectoryFilters(input: { query?: unknown; section?: unknown; sort?: unknown }): ManagementDirectoryFilters {
  return {
    query: typeof input.query === "string" ? input.query.slice(0, 160) : "",
    section: input.section === "access" || input.section === "discord" || input.section === "system" ? input.section : "all",
    sort: input.sort === "title" ? "title" : "recommended",
  };
}
export function filterManagementDirectory(items: readonly ManagementDirectoryItem[], filters: ManagementDirectoryFilters): ManagementDirectoryItem[] {
  const words = filters.query.normalize("NFKC").trim().toLocaleLowerCase("uk-UA").split(/\s+/).filter(Boolean);
  const result = items.filter(item => {
    if (filters.section !== "all" && item.section !== filters.section) return false;
    const content = `${item.label} ${item.description} ${MANAGEMENT_CATEGORY_LABELS[item.section]}`.normalize("NFKC").toLocaleLowerCase("uk-UA");
    return words.every(word => content.includes(word));
  });
  return filters.sort === "title" ? result.sort((a, b) => a.label.localeCompare(b.label, "uk-UA")) : result;
}
