import { Suspense, type ReactNode } from "react";
import Script from "next/script";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./profile.css";
import "./theme.css";
import DashboardFormEnhancer from "@/components/DashboardFormEnhancer";
import GlobalToasts from "@/components/GlobalToasts";
import AppFooter from "@/components/AppFooter";
import ClientErrorReporter from "@/components/ClientErrorReporter";
import ClientAuthGuard from "@/components/ClientAuthGuard";
import {
  DASHBOARD_TITLE,
  DEFAULT_SEO_DESCRIPTION,
  dashboardBaseUrl,
  privateRobots,
} from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07101a",
};

export const metadata: Metadata = {
  metadataBase: new URL(dashboardBaseUrl()),
  title: {
    default: DASHBOARD_TITLE,
    template: "%s • Mistblossom Vanguard",
  },
  description: DEFAULT_SEO_DESCRIPTION,
  applicationName: DASHBOARD_TITLE,
  authors: [{ name: "Mistblossom Vanguard" }],
  creator: "Mistblossom Vanguard",
  publisher: "Mistblossom Vanguard",
  category: "gaming",
  keywords: [
    "Mistblossom Vanguard",
    "Лігво Друїда",
    "World of Warcraft",
    "WoW",
    "гільдія",
    "рейди",
    "Discord",
  ],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      {
        url: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: DASHBOARD_TITLE,
    description: DEFAULT_SEO_DESCRIPTION,
    url: "/",
    siteName: DASHBOARD_TITLE,
    locale: "uk_UA",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Mistblossom Vanguard — гільдійна панель",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: DASHBOARD_TITLE,
    description: DEFAULT_SEO_DESCRIPTION,
    images: ["/og-image.png"],
  },
  appleWebApp: {
    title: "Mistblossom",
    capable: true,
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  robots: privateRobots,
  other: {
    "msapplication-TileColor": "#020817",
    "msapplication-config": "/browserconfig.xml",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uk">
      <body>
        <Script id="dashboard-extension-noise-guard" strategy="beforeInteractive">
          {`
            (() => {
              const isIgnorable = (value) => {
                const text = String(value && (value.message || value.reason || value) || "");
                return /Could not establish connection\. Receiving end does not exist/i.test(text) ||
                  /A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received/i.test(text) ||
                  /The message port closed before a response was received/i.test(text) ||
                  /Unchecked runtime\.lastError/i.test(text) ||
                  /Extension context invalidated/i.test(text) ||
                  /(?:chrome|moz|safari-web)-extension:\/\//i.test(text);
              };

              window.addEventListener(
                "unhandledrejection",
                (event) => {
                  if (isIgnorable(event.reason)) event.preventDefault();
                },
                true,
              );

              window.addEventListener(
                "error",
                (event) => {
                  if (isIgnorable(event.error || event.message || event.filename)) event.preventDefault();
                },
                true,
              );
            })();
          `}
        </Script>
        <ClientErrorReporter />
        <ClientAuthGuard />
        <DashboardFormEnhancer />
        <Suspense fallback={null}>
          <GlobalToasts />
        </Suspense>
        {children}
        <AppFooter />
      </body>
    </html>
  );
}
