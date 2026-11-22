/**
 * Pure model of the public site's "Communities" block (home page, section 01).
 * Shared by the editor (client), the store and the site bridge; no server imports.
 */
export const SITE_COMMUNITIES_SCHEMA = "mistblossom.public-communities.v1";
export const COMMUNITY_LIMITS = { items: 6, details: 6, links: 6, id: 40, name: 60, game: 40, description: 300, label: 40, value: 60, url: 300, pageLabel: 40 } as const;

export type CommunityDetail = { label: string; value: string };
export type CommunityLink = { label: string; url: string };
export type SiteCommunity = {
  id: string;
  name: string;
  game: string;
  logo: string;
  description: string;
  /** Internal page of the public site ("/guild") or empty: no primary button. */
  page: string;
  pageLabel: string;
  details: CommunityDetail[];
  links: CommunityLink[];
};

export class CommunityValidationError extends Error {}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Site-local artwork or an image uploaded through the panel. */
export function isCommunityLogo(value: string) {
  return /^\/assets\/img\/[A-Za-z0-9_./-]+\.(?:webp|png|jpe?g|svg)$/.test(value) && !value.includes("..")
    || /^\/api\/site\/media\/[a-f0-9]{64}$/.test(value);
}

export function isCommunityLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && value.length <= COMMUNITY_LIMITS.url;
  } catch { return false; }
}

const isSitePage = (value: string) => value === "" || (/^\/[a-z0-9/-]{0,80}$/.test(value) && !value.includes("//"));

export function communitySlug(value: unknown) {
  return text(value, COMMUNITY_LIMITS.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Validates the whole block. Throws CommunityValidationError with a message for the
 * editor; the result is exactly what the site receives.
 */
export function normalizeCommunities(input: unknown): SiteCommunity[] {
  if (!Array.isArray(input)) throw new CommunityValidationError("Некоректний список спільнот.");
  if (input.length > COMMUNITY_LIMITS.items) throw new CommunityValidationError(`Не більше ${COMMUNITY_LIMITS.items} спільнот.`);
  const ids = new Set<string>();
  return input.map((raw, index) => {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const n = index + 1;
    const name = text(item.name, COMMUNITY_LIMITS.name);
    if (!name) throw new CommunityValidationError(`Спільнота ${n}: вкажи назву.`);
    const id = communitySlug(item.id) || communitySlug(name) || `community-${n}`;
    if (ids.has(id)) throw new CommunityValidationError(`Спільнота «${name}»: ідентифікатор «${id}» уже використано.`);
    ids.add(id);
    const logo = text(item.logo, COMMUNITY_LIMITS.url);
    if (!isCommunityLogo(logo)) throw new CommunityValidationError(`«${name}»: завантаж логотип або вкажи шлях /assets/img/….`);
    const page = text(item.page, 82);
    if (!isSitePage(page)) throw new CommunityValidationError(`«${name}»: сторінка має бути внутрішнім шляхом сайту, наприклад /guild.`);
    const rows = (value: unknown, max: number) => (Array.isArray(value) ? value : []).slice(0, max + 20);
    const details = rows(item.details, COMMUNITY_LIMITS.details)
      .map((row) => ({ label: text((row as CommunityDetail)?.label, COMMUNITY_LIMITS.label), value: text((row as CommunityDetail)?.value, COMMUNITY_LIMITS.value) }))
      .filter((row) => row.value);
    if (details.length > COMMUNITY_LIMITS.details) throw new CommunityValidationError(`«${name}»: не більше ${COMMUNITY_LIMITS.details} позначок.`);
    const links = rows(item.links, COMMUNITY_LIMITS.links)
      .map((row) => ({ label: text((row as CommunityLink)?.label, COMMUNITY_LIMITS.label), url: text((row as CommunityLink)?.url, COMMUNITY_LIMITS.url) }))
      .filter((row) => row.label || row.url);
    if (links.length > COMMUNITY_LIMITS.links) throw new CommunityValidationError(`«${name}»: не більше ${COMMUNITY_LIMITS.links} посилань.`);
    for (const link of links) {
      if (!link.label) throw new CommunityValidationError(`«${name}»: у посилання ${link.url} немає підпису.`);
      if (!isCommunityLink(link.url)) throw new CommunityValidationError(`«${name}»: посилання «${link.label}» має бути https-адресою.`);
    }
    return {
      id, name,
      game: text(item.game, COMMUNITY_LIMITS.game),
      logo,
      description: text(item.description, COMMUNITY_LIMITS.description),
      page,
      pageLabel: page ? text(item.pageLabel, COMMUNITY_LIMITS.pageLabel) || "Детальніше" : "",
      details,
      links,
    };
  });
}

/** What the site showed before the block became editable (its _data/guilds.yml). */
export const DEFAULT_SITE_COMMUNITIES: SiteCommunity[] = [
  {
    id: "mistblossom", name: "Mistblossom Vanguard", game: "World of Warcraft", logo: "/assets/img/guild-logo.webp",
    description: "Українська гільдія в World of Warcraft — рейди, Mythic+ і спільна гра без токсичності.",
    page: "/guild", pageLabel: "Про гільдію",
    details: [{ label: "Реалм", value: "EU · Terokkar" }],
    links: [{ label: "Discord", url: "https://discord.gg/stNeSaVkhM" }],
  },
  {
    id: "varta", name: "VARTA", game: "Aion", logo: "/assets/img/varta-logo.webp",
    description: "Українська легіон-спільнота в Aion на приватному сервері RiftShade.",
    page: "", pageLabel: "",
    details: [{ label: "Сервер", value: "RiftShade" }, { label: "Фракція", value: "Asmodian" }],
    links: [
      { label: "Сайт сервера", url: "https://aionriftshade.com/" },
      { label: "Discord легіону", url: "https://discord.gg/B7JxeZEyaE" },
      { label: "Discord сервера", url: "https://discord.gg/dEd3t7edCw" },
    ],
  },
];
