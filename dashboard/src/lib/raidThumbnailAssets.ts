export type RaidThumbnailDifficulty = "normal" | "heroic" | "mythic";

export const RAID_THUMBNAIL_BASE_PATH = "/assets/raid-thumbnails";

export const RAID_THUMBNAIL_ASSET_PATHS: Record<RaidThumbnailDifficulty, string> = {
  normal: `${RAID_THUMBNAIL_BASE_PATH}/normal.png`,
  heroic: `${RAID_THUMBNAIL_BASE_PATH}/heroic.png`,
  mythic: `${RAID_THUMBNAIL_BASE_PATH}/mythic.png`,
};

const RAID_THUMBNAIL_ALIASES: Record<string, RaidThumbnailDifficulty> = {
  normal: "normal",
  "нормал": "normal",
  "normal.png": "normal",
  "raid-normal.png": "normal",
  heroic: "heroic",
  "героїк": "heroic",
  "героик": "heroic",
  "heroic.png": "heroic",
  "raid-heroic.png": "heroic",
  mythic: "mythic",
  "міфік": "mythic",
  "мифик": "mythic",
  "mythic.png": "mythic",
  "raid-mythic.png": "mythic",
};

export function normalizeRaidThumbnailDifficulty(
  value: RaidThumbnailDifficulty | string | null | undefined,
): RaidThumbnailDifficulty {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  return RAID_THUMBNAIL_ALIASES[key] || "heroic";
}

export function defaultRaidThumbnailPath(
  difficulty: RaidThumbnailDifficulty | string | null | undefined,
) {
  return RAID_THUMBNAIL_ASSET_PATHS[normalizeRaidThumbnailDifficulty(difficulty)];
}

export function normalizeRaidThumbnailAssetPath(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw;
  }

  pathname = pathname.replace(/\\/g, "/");
  const fileName = pathname.split("/").filter(Boolean).pop()?.toLowerCase() || "";
  const difficulty = RAID_THUMBNAIL_ALIASES[fileName];
  if (!difficulty) return null;

  const normalizedBase = pathname.replace(/\/+$/, "").toLowerCase();
  if (!normalizedBase.includes(RAID_THUMBNAIL_BASE_PATH)) return null;
  return RAID_THUMBNAIL_ASSET_PATHS[difficulty];
}

export function cleanRaidImageUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;

  const assetPath = normalizeRaidThumbnailAssetPath(text);
  if (assetPath) return assetPath;

  if (text.startsWith("/")) return text;

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isInternalRaidThumbnail(value: string | null | undefined) {
  return Boolean(normalizeRaidThumbnailAssetPath(value));
}
