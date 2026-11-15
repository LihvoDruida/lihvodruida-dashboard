import type { profileDirectoryFilters } from "@/lib/profileDirectory";
export type ProfileDirectoryFilters = ReturnType<typeof profileDirectoryFilters>;
export function buildProfilesHref({ query, link, role, sort, cursor }: ProfileDirectoryFilters & { cursor?: string | null }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (link !== "all") params.set("link", link);
  if (role !== "all") params.set("role", role);
  if (sort !== "activity") params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
  const suffix = params.toString();
  return suffix ? `/profiles?${suffix}` : "/profiles";
}
