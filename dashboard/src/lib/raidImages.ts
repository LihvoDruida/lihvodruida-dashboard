import { githubFetch } from "@/lib/github";

export type RaidImageAsset = {
  name: string;
  path: string;
  url: string;
  downloadUrl?: string | null;
  htmlUrl?: string | null;
  size?: number | null;
};

const DEFAULT_RAID_IMAGES_DIRECTORY = "assets/img/raids-img";
const DEFAULT_RAID_IMAGES_BRANCH = "live";
const IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpg", "jpeg", "png", "webp"]);

type GitHubContentItem = {
  type?: string;
  name?: string;
  path?: string;
  size?: number;
  download_url?: string | null;
  html_url?: string | null;
};

function cleanPathSegment(value: unknown, fallback: string) {
  const text = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  if (!text || text.includes("..")) return fallback;
  return text.replace(/\/+/g, "/");
}

function encodeGitHubPath(path: string) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function publicSiteBaseUrl() {
  return String(
    process.env.RAID_IMAGES_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_BASE_URL ||
    process.env.SITE_BASE_URL ||
    "https://lihvodruida.pp.ua"
  ).replace(/\/+$/, "");
}

function publicAssetUrl(path: string) {
  const safePath = path.replace(/^\/+/, "");
  return `${publicSiteBaseUrl()}/${safePath.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function raidImagesDirectory() {
  return cleanPathSegment(process.env.RAID_IMAGES_DIRECTORY, DEFAULT_RAID_IMAGES_DIRECTORY);
}

function raidImagesBranch() {
  const value = String(process.env.RAID_IMAGES_BRANCH || process.env.GITHUB_RAID_IMAGES_BRANCH || DEFAULT_RAID_IMAGES_BRANCH).trim();
  return value || DEFAULT_RAID_IMAGES_BRANCH;
}

function isImageFile(item: GitHubContentItem) {
  if (item.type !== "file") return false;
  const name = String(item.name || "").trim();
  const extension = name.split(".").pop()?.toLowerCase() || "";
  return Boolean(name) && IMAGE_EXTENSIONS.has(extension);
}

export async function listRaidImageAssets(): Promise<RaidImageAsset[]> {
  const directory = raidImagesDirectory();
  const branch = raidImagesBranch();
  const data = await githubFetch(`/contents/${encodeGitHubPath(directory)}?ref=${encodeURIComponent(branch)}`);
  const items = Array.isArray(data) ? data as GitHubContentItem[] : [];

  return items
    .filter(isImageFile)
    .map((item) => {
      const path = cleanPathSegment(item.path || `${directory}/${item.name}`, `${directory}/${item.name}`);
      return {
        name: String(item.name || "").trim(),
        path,
        url: publicAssetUrl(path),
        downloadUrl: item.download_url || null,
        htmlUrl: item.html_url || null,
        size: typeof item.size === "number" ? item.size : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk", { numeric: true, sensitivity: "base" }));
}
