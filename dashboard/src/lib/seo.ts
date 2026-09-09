import type { Metadata } from "next";

export const GUILD_NAME = "Mistblossom Vanguard";
export const DASHBOARD_TITLE = "Панель Mistblossom Vanguard";
export const DEFAULT_SEO_DESCRIPTION =
  "Особиста панель гільдії Mistblossom Vanguard: заявки, профілі, рейди, склад гільдії та Discord-повідомлення в одному чистому просторі.";

const DEFAULT_DASHBOARD_URL = "https://guild.lihvodruida.pp.ua";
const DEFAULT_IMAGE = "/og-image.png";

export function dashboardBaseUrl() {
  const raw = String(
    process.env.NEXT_PUBLIC_DASHBOARD_URL ||
      process.env.DASHBOARD_URL ||
      process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_URL ||
      process.env.ADMIN_DASHBOARD_URL ||
      process.env.NEXTAUTH_URL ||
      DEFAULT_DASHBOARD_URL,
  ).trim();

  try {
    const url = new URL(raw || DEFAULT_DASHBOARD_URL);
    return url.origin;
  } catch {
    return DEFAULT_DASHBOARD_URL;
  }
}

export function absoluteDashboardUrl(path = "/") {
  try {
    return new URL(path.startsWith("/") ? path : `/${path}`, `${dashboardBaseUrl()}/`).toString();
  } catch {
    return `${DEFAULT_DASHBOARD_URL}${path.startsWith("/") ? path : `/${path}`}`;
  }
}

export const privateRobots: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: {
    index: false,
    follow: false,
    noimageindex: true,
    "max-snippet": -1,
    "max-image-preview": "large",
    "max-video-preview": -1,
  },
};

const baseKeywords = [
  "Mistblossom Vanguard",
  "Лігво Друїда",
  "World of Warcraft",
  "WoW guild",
  "гільдія WoW",
  "рейди WoW",
  "Discord гільдія",
];

type PageMetadataOptions = {
  title: string;
  description: string;
  path?: string;
  image?: string;
  keywords?: string[];
  robots?: Metadata["robots"];
  type?: "website" | "article";
};

export function buildPageMetadata({
  title,
  description,
  path = "/",
  image = DEFAULT_IMAGE,
  keywords = [],
  robots = privateRobots,
  type = "website",
}: PageMetadataOptions): Metadata {
  const canonicalPath = path.startsWith("/") ? path : `/${path}`;
  const imageUrl = absoluteDashboardUrl(image);

  return {
    title,
    description,
    keywords: [...baseKeywords, ...keywords],
    robots,
    alternates: {
      canonical: canonicalPath,
      languages: {
        "uk-UA": canonicalPath,
      },
    },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      siteName: DASHBOARD_TITLE,
      locale: "uk_UA",
      type,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${GUILD_NAME} — гільдійна панель`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export function compactText(value: string, max = 155) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
