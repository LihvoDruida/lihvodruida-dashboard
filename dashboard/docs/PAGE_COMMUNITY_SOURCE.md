# Повний runtime-код етапу 3 — Dashboard 3.25.0

Нові й змінені файли src/ без скорочень; тести та решта файлів — у вихідному дереві архіву.

## src/app/applications/error.tsx

```tsx
"use client";
export {default} from "@/components/page/PageRouteError";
```

## src/app/applications/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";
export default function Loading() { return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>; }
```

## src/app/applications/page.tsx

```tsx
import { buildPageMetadata } from "@/lib/seo";
import { loadApplicationWorkspace } from "@/services/applicationWorkspace";
import ApplicationWorkspaceView from "@/components/applications/ApplicationWorkspaceView";
export const metadata = buildPageMetadata({
  title: "Заявки до гільдії",
  description: "Перегляд заявок до Mistblossom Vanguard, статусів кандидатів, персонажів і коротких підказок для офіцерів.",
  path: "/applications",
  keywords: ["заявки до гільдії", "кандидати WoW", "офіцерська панель"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ApplicationsPage(props: {searchParams: Promise<Record<string, string | undefined>>}) {
  return <ApplicationWorkspaceView {...await loadApplicationWorkspace(props)} />;
}
```

## src/app/guild/error.tsx

```tsx
"use client";
export {default} from "@/components/page/PageRouteError";
```

## src/app/guild/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";
export default function Loading() { return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>; }
```

## src/app/guild/page.tsx

```tsx
import DashboardIdentity from "@/components/DashboardIdentity";
import GuildRosterExplorer from "@/components/GuildRosterExplorer";
import GuildRosterLiveHeroStats from "@/components/GuildRosterLiveHeroStats";
import PageContainer from "@/components/page/PageContainer";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import GuildDiscordGuide from "@/components/guild/GuildDiscordGuide";
import { loadGuildWorkspace } from "@/services/guildWorkspace";
import { listNavigationScope } from "@/lib/listNavigationScope";
import { buildPageMetadata } from "@/lib/seo";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Склад гільдії",
  description:
    "Огляд складу Mistblossom Vanguard: ролі, класи, типи броні, item level, Mythic+ рейтинг і зручні фільтри для учасників.",
  path: "/guild",
  keywords: ["склад гільдії", "рейдери WoW", "Raider.IO", "item level"],
});

export default async function GuildRosterPage() {
  const {user, roster, apiSettings} = await loadGuildWorkspace();
  return <PageContainer label="Склад гільдії" navigation={<DashboardIdentity user={user} activeSection="guild" />}>
    <GuildRosterLiveHeroStats members={roster.members} stats={roster.stats} source={roster.source} error={roster.error} allowManualRefresh={Boolean(user?.isServerOwner)}
      refreshSettings={{clientDrivenSyncEnabled: apiSettings.guildRosterClientDrivenSyncEnabled,clientStepDelayMs: apiSettings.guildRosterClientStepDelayMs,clientRequestTimeoutMs: apiSettings.guildRosterClientRequestTimeoutMs,clientMaxSteps: apiSettings.guildRosterClientMaxSteps}} />
    <PageErrorBoundary><GuildRosterExplorer navigationScope={listNavigationScope(user)} members={roster.members} stats={roster.stats} source={roster.source} error={roster.error} /></PageErrorBoundary>
    <GuildDiscordGuide />
  </PageContainer>;
}
```

## src/app/layout.tsx

```tsx
import { Suspense, type ReactNode } from "react";
import Script from "next/script";
import localFont from "next/font/local";

const guildDisplayFont = localFont({
  src: "../../assets/fonts/welcome/SpectralSC-Bold.ttf",
  weight: "700",
  style: "normal",
  display: "swap",
  variable: "--font-guild-display",
});
const guildHeadingFont = localFont({
  src: "../../assets/fonts/welcome/Philosopher-Bold.ttf",
  weight: "700",
  style: "normal",
  display: "swap",
  variable: "--font-guild-heading",
});
const guildMastheadFont = localFont({
  src: "../../assets/fonts/welcome/Cinzel-Variable.ttf",
  weight: "400 900",
  style: "normal",
  display: "swap",
  variable: "--font-guild-masthead",
});
import type { Metadata, Viewport } from "next";
// Порядок: токени → база → компоненти → доменні сторінки → desktop →
// інтеграційні винятки (guild banner / cleanup / management).
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
// patterns — структурні заглушки за суфіксом класу. Свідомо йдуть
// ПЕРЕД іменними шарами, щоб будь-яке конкретне правило їх перекривало.
import "./styles/patterns.css";
import "./styles/components.css";
import "./styles/ui.css";
import "./styles/lists.css";
import "./styles/nav.css";
import "./styles/pages.css";
import "./styles/directory.css";
import "./styles/onboarding.css";
import "./styles/profile.css";
import "./styles/raids.css";
import "./styles/admin.css";
import "./styles/polls.css";
import "./styles/roster.css";
import "./styles/desktop.css";
// Інтеграційні винятки мають іти після desktop, зокрема для шапки гільдії.
import "./styles/guild-banner.css";
import "./styles/discord-cleanup.css";
import "./styles/management.css";
import DashboardFormEnhancer from "@/components/DashboardFormEnhancer";
import GlobalToasts from "@/components/GlobalToasts";
import AppFooter from "@/components/AppFooter";
import ClientErrorReporter from "@/components/ClientErrorReporter";
import ClientAuthGuard from "@/components/ClientAuthGuard";
import LiveDataRefresh from "@/components/LiveDataRefresh";
import DashboardLivePageSync from "@/components/DashboardLivePageSync";
import {
  DASHBOARD_TITLE,
  DEFAULT_SEO_DESCRIPTION,
  dashboardBaseUrl,
  privateRobots,
} from "@/lib/seo";


export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07090f",
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
    "msapplication-TileColor": "#07090f",
    "msapplication-config": "/browserconfig.xml",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="uk" className={`${guildDisplayFont.variable} ${guildHeadingFont.variable} ${guildMastheadFont.variable}`}>
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
        <Script src="/js/dashboard-starfield.js" strategy="lazyOnload" />
        <ClientErrorReporter />
        <ClientAuthGuard />
        <DashboardFormEnhancer />
        <LiveDataRefresh />
        <DashboardLivePageSync />
        <Suspense fallback={null}>
          <GlobalToasts />
        </Suspense>
        {children}
        <AppFooter />
      </body>
    </html>
  );
}
```

## src/app/polls/[pollId]/error.tsx

```tsx
"use client";
export {default} from "@/components/page/PageRouteError";
```

## src/app/polls/[pollId]/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";
export default function Loading() { return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>; }
```

## src/app/polls/[pollId]/page.tsx

```tsx
import {buildPageMetadata} from "@/lib/seo";
import {loadPollDetailsWorkspace} from "@/services/pollWorkspace";
import PollDetailsView from "@/components/polls/PollDetailsView";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ pollId: string }> }) {
  const { pollId } = await params;
  return buildPageMetadata({
    title: "Рейд-пул",
    description: "Детальні результати рейд-пулу Mistblossom Vanguard.",
    path: `/polls/${encodeURIComponent(pollId)}`,
    keywords: ["рейд-пул", "результати голосування", "Discord poll"],
  });
}

export default async function PollDetailsPage(props: {params: Promise<{pollId: string}>}) {
  return <PollDetailsView {...await loadPollDetailsWorkspace(props)} />;
}
```

## src/app/polls/error.tsx

```tsx
"use client";
export {default} from "@/components/page/PageRouteError";
```

## src/app/polls/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";
export default function Loading() { return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>; }
```

## src/app/polls/page.tsx

```tsx
import {buildPageMetadata} from "@/lib/seo";
import {loadPollDirectoryWorkspace} from "@/services/pollWorkspace";
import PollDirectoryView from "@/components/polls/PollDirectoryView";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = buildPageMetadata({
  title: "Рейд-пули",
  description: "Голосування за доступність гравців для рейдів Mistblossom Vanguard із Discord та сайтом.",
  path: "/polls",
  keywords: ["рейд-пул", "голосування рейдів", "Discord голосування"],
});

export default async function PollsPage() {
  return <PollDirectoryView {...await loadPollDirectoryWorkspace()} />;
}
```

## src/app/raids/[raidId]/error.tsx

```tsx
"use client";
export {default} from "@/components/page/PageRouteError";
```

## src/app/raids/[raidId]/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";
export default function Loading() { return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>; }
```

## src/app/raids/[raidId]/page.tsx

```tsx
import {buildPageMetadata} from "@/lib/seo";
import {loadRaidDetailsWorkspace} from "@/services/raidDetailsWorkspace";
import RaidDetailsView from "@/components/raids/RaidDetailsView";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ raidId: string }> }) {
  const { raidId } = await params;
  const path = `/raids/${encodeURIComponent(raidId)}`;

  return buildPageMetadata({
    title: "Сторінка рейду",
    description: "Публічний перегляд рейду та складу. Запис на участь відбувається в Discord.",
    path,
    keywords: ["сторінка рейду", "запис на рейд", "рейд WoW"],
  });
}

export default async function RaidDetailsPage(props: {params: Promise<{raidId: string}>; searchParams: Promise<Record<string,string | undefined>>}) {
  return <RaidDetailsView {...await loadRaidDetailsWorkspace(props)} />;
}
```

## src/app/raids/error.tsx

```tsx
"use client";
export {default} from "@/components/page/PageRouteError";
```

## src/app/raids/loading.tsx

```tsx
import PageContainer from "@/components/page/PageContainer";
import PageSkeleton from "@/components/page/PageSkeleton";
export default function Loading() { return <PageContainer label="Завантаження розділу"><PageSkeleton variant="page" count={3} /></PageContainer>; }
```

## src/app/raids/page.tsx

```tsx
import {buildPageMetadata} from "@/lib/seo";
import {loadRaidDirectoryWorkspace} from "@/services/raidDirectoryWorkspace";
import RaidDirectoryView from "@/components/raids/RaidDirectoryView";
export const runtime = "nodejs";
export const metadata = buildPageMetadata({
  title: "Рейди",
  description:
    "Публічний список рейдів, склад, правила та архів. Запис відбувається тільки в Discord.",
  path: "/raids",
  keywords: ["рейди WoW", "запис на рейд", "архів рейдів"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RaidsListPage(props: {searchParams: Promise<Record<string, string | undefined>>}) {
  return <RaidDirectoryView {...await loadRaidDirectoryWorkspace(props)} />;
}
```

## src/app/styles/components.css

```css

/* =========================================================
   COMPONENTS — панелі, кнопки, форми, повідомлення,
списки

   Усе взято з мови сайту: .card / .panel з assets/css/style.css,
поля форм з apply.css,
пігулки з guild.css. Тут вони зведені
   до кількох патернів,
щоб не описувати кожен клас окремо.

   Правило проєкту: жодного !important.
   ========================================================= */

/* =========================================================
   1. ПОВЕРХНІ: панель і картка
   ========================================================= */
.panel,
[class$="-card"]:not(:where([class*="nav"])),
[class*="-card "]:not(:where([class*="nav"])),
[class$="__card"],
[class*="__card "],
[class$="-panel"]:not(:where(.dashboard-list-panel)),
[class*="-panel "]:not(:where(.dashboard-list-panel)),
[class$="__panel"],
[class*="__panel "],
[class$="-box"],
[class*="-box "] {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}

.panel:not(:where([class*="hero"])) {
  padding: var(--pad-card);
}

[class$="-card"]:not(:where([class*="nav"])),
[class*="-card "]:not(:where([class*="nav"])),
[class$="__card"],
[class*="__card "],
[class$="-panel"]:not(:where(.dashboard-list-panel)),
[class*="-panel "]:not(:where(.dashboard-list-panel)),
[class$="__panel"],
[class*="__panel "],
[class$="-box"],
[class*="-box "] {
  padding: var(--pad-card-compact);
}

/* Панель — вертикальний стек: кожна панель дихає однаково.
   Hero-блоки виключені: вони теж носять .panel, але мають власну
   двоколонкову сітку в layout.css, і стек її перекривав. */
.panel:not(:where([class*="hero"])) {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
}

/* Панель усередині панелі не подвоює рамку */
.panel .panel,
.panel [class$="-card"],
.panel [class*="-card "],
.panel [class$="__card"],
.panel [class*="__card "] {
  background: var(--surface-raised);
  box-shadow: none;
}

/* Клікабельна картка */
a.card,
a[class$="-card"],
a[class*="-card "],
a[class$="__card"],
a[class*="__card "],
[class$="-card"][role="button"],
[class*="-card "][role="button"] {
  color: inherit;
  transition: transform var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

a.card:hover,
a[class$="-card"]:hover,
a[class*="-card "]:hover,
a[class$="__card"]:hover,
a[class*="__card "]:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-lg);
  color: inherit;
}

/* Виділена картка — смуга акценту зліва */
.is-active[class$="-card"],
.is-active[class*="-card "],
.is-selected[class$="-card"],
.is-selected[class*="-card "] {
  border-color: var(--border-strong);
}

.is-active[class$="-card"]::after,
.is-active[class*="-card "]::after,
.is-selected[class$="-card"]::after,
.is-selected[class*="-card "]::after {
  content: "";
  position: absolute;
  inset: var(--space-sm) auto var(--space-sm) 0;
  width: 3px;
  border-radius: var(--radius-pill);
  background: var(--accent-gradient);
  pointer-events: none;
}

/* Шапка картки: заголовок ліворуч,
дії праворуч */
.profile-card-head,
.content-section-head,
.content-form-section-head,
[class$="__head"],
[class*="__head "],
[class$="-head"],
[class*="-head "] {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
  min-width: 0;
}

.profile-card-head--inline,
[class$="__head"] > div,
[class*="__head "] > div,
[class$="-head"] > div,
[class*="-head "] > div {
  min-width: 0;
}

[class$="__head"] strong,
[class*="__head "] strong,
[class$="-head"] strong,
[class*="-head "] strong {
  color: var(--text-strong);
}

[class$="__head"] small,
[class*="__head "] small,
[class$="-head"] small,
[class*="-head "] small {
  display: block;
  color: var(--text-muted);
}

.profile-card-lead,
[class$="__lead"],
[class*="__lead "] {
  color: var(--text-soft);
  font-size: var(--font-size-body);
  line-height: 1.58;
}

/* Іконка-плитка в шапці */
[class$="__icon"],
/* Іконка-плитка в шапці */
[class*="__icon "],
[class$="-icon"],
[class*="-icon "] {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
}

.global-toast__icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-raised);
  color: var(--c-accent-300);
  font-size: var(--font-size-base);
}

/* =========================================================
   2. КНОПКИ — єдиний силует інтерактивних дій
   ========================================================= */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  min-height: var(--control-height);
  padding: 0 var(--control-pad-x);
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-raised);
  color: var(--text-body);
  font-size: 0.84rem;
  font-weight: var(--font-weight-bold);
  line-height: 1.2;
  letter-spacing: 0.005em;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.btn:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  color: var(--text-strong);
}

.btn:disabled,
.btn[aria-disabled="true"],
.btn.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* Головна дія — бурштиновий градієнт, як кнопка донату на сайті */
.btn.primary,
.btn-primary {
  border-color: transparent;
  background: var(--accent-gradient);
  color: var(--text-on-accent);
}

.btn.primary:hover,
.btn-primary:hover {
  color: var(--text-on-accent);
  box-shadow: 0 12px 26px -14px var(--accent-ring);
}

/* Другорядна дія */
.btn.subtle,
.btn.secondary {
  background: var(--surface);
  color: var(--text-soft);
}

.btn.subtle:hover,
.btn.secondary:hover {
  background: var(--surface-hover);
  color: var(--text-strong);
}

/* Прозора */
.btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-soft);
}

.btn.ghost:hover {
  background: var(--surface-hover);
  border-color: var(--border-subtle);
}

/* Статусні */
.btn.danger {
  border-color: rgba(224, 112, 95, 0.35);
  background: rgba(224, 112, 95, 0.12);
  color: var(--c-danger);
}

.btn.danger:hover {
  background: rgba(224, 112, 95, 0.2);
  color: #ffb3a6;
}

.btn.warning {
  border-color: rgba(232, 179, 74, 0.35);
  background: rgba(232, 179, 74, 0.12);
  color: var(--c-warning);
}

.btn.warning:hover {
  background: rgba(232, 179, 74, 0.2);
  color: #ffd88a;
}

.btn.success {
  border-color: rgba(124, 196, 143, 0.35);
  background: rgba(124, 196, 143, 0.12);
  color: var(--c-success);
}

.btn.success:hover {
  background: rgba(124, 196, 143, 0.2);
  color: #a9e0ba;
}

/* Розміри */
.btn-sm {
  min-height: var(--control-height-sm);
  padding: 0 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-meta);
}

.btn-icon {
  width: var(--control-height);
  min-width: var(--control-height);
  padding: 0;
}

.btn__icon {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
}

.btn svg,
.btn__icon > svg {
  width: 1.1em;
  height: 1.1em;
  flex: 0 0 auto;
}

/* =========================================================
   3. ФОРМИ — геометрія з apply.css сайту
   ========================================================= */
.content-field,
.raid-poll-field,
[class$="-field"]:not(:where([class*="filter-shell"])),
[class*="-field "]:not(:where([class*="filter-shell"])),
[class$="__field"],
[class*="__field "] {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.content-field > span,
.raid-poll-field > span,
[class$="-field"] > span:first-child,
[class*="-field "] > span:first-child,
.field-label,
label > span:first-child {
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.02em;
  color: var(--text-soft);
}

.field-label {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

/* Підказка під полем */
.content-field small,
[class$="-field"] small,
[class*="-field "] small {
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Самі контролі */
.input,
.select,
.textarea,
.modern-select,
.markdown-area,
input[type="text"],
input[type="search"],
input[type="email"],
input[type="url"],
input[type="password"],
input[type="number"],
input[type="date"],
input[type="time"],
input[type="datetime-local"],
input:not(:where([type])),
select,
textarea {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0 var(--space-md);
  border: 1px solid rgba(255, 155, 85, 0.16);
  border-radius: var(--control-radius);
  background: var(--surface-sunken);
  color: var(--text-body);
  font-size: 16px;
  outline: 0;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.textarea,
.markdown-area,
textarea {
  min-height: 120px;
  padding: var(--space-sm) var(--space-md);
  line-height: var(--line-height-relaxed);
  resize: vertical;
}

.textarea.compact,
textarea.compact {
  min-height: 80px;
}

.markdown-area {
  font-family: var(--font-mono);
  font-size: 0.86rem;
}

.input::placeholder,
.textarea::placeholder,
input::placeholder,
textarea::placeholder {
  color: var(--text-faint);
}

.input:focus,
.select:focus,
.textarea:focus,
input:not(:where([type="checkbox"])):not(:where([type="radio"])):focus,
select:focus,
textarea:focus {
  border-color: var(--border-strong);
  background: rgba(12, 10, 7, 0.7);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.input:disabled,
select:disabled,
textarea:disabled,
.is-disabled .input {
  opacity: 0.55;
  cursor: not-allowed;
}

.input.is-invalid,
.is-invalid .input {
  border-color: rgba(224, 112, 95, 0.5);
}

/* Селект — стрілка домальована фоном, як на сайті */
.select,
.modern-select,
select {
  appearance: none;
  cursor: pointer;
  padding-right: var(--space-xl);
  background-image:
    linear-gradient(45deg, transparent 50%, var(--c-accent-300) 50%),
    linear-gradient(135deg, var(--c-accent-300) 50%, transparent 50%);
  background-position:
    right var(--space-md) center,
    right calc(var(--space-md) - 6px) center;
  background-size: 6px 6px, 6px 6px;
  background-repeat: no-repeat;
  font-weight: var(--font-weight-medium);
}

select option {
  background: #fff6ea;
  color: #1b120c;
}

/* Чекбокси та радіо */
input[type="checkbox"],
input[type="radio"] {
  width: 18px;
  height: 18px;
  min-height: 0;
  flex: 0 0 auto;
  padding: 0;
  accent-color: var(--c-accent-500);
  cursor: pointer;
}

.inline-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 36px;
  cursor: pointer;
  color: var(--text-soft);
  font-size: 0.85rem;
}

.inline-check > span {
  font-weight: var(--font-weight-ui);
}

.inline-check--card {
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

/* Секція форми */
.content-form-section,
.raid-form-section,
[class$="-form-section"],
[class*="-form-section "] {
  display: grid;
  gap: var(--space-md);
  padding: var(--pad-card-compact);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

fieldset {
  border: 0;
  min-width: 0;
}

legend {
  padding: 0;
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--c-accent-300);
}

form {
  min-width: 0;
}

/* =========================================================
   4. ПОВІДОМЛЕННЯ — нейтральне, помилка,
попередження
   ========================================================= */
.notice,
.error-note,
.warning-note,
.login-alert,
.raid-notice,
.discord-notice,
.raid-ilvl-notice,
[class$="-alert"],
[class*="-alert "],
[class$="-notice"],
[class*="-notice "] {
  display: block;
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border);
  border-left: 3px solid var(--c-ink-500);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-soft);
  font-size: 0.86rem;
  line-height: var(--line-height-relaxed);
}

.notice.panel {
  border-left-width: 3px;
  box-shadow: none;
}

.error-note,
.login-alert,
.notice.danger {
  border-color: var(--tint-danger-border);
  border-left-color: var(--c-danger);
  background: var(--tint-danger-bg);
  color: var(--text-on-danger);
}

.warning-note,
.notice.warning,
.notice.is-warning {
  border-color: var(--tint-warning-border);
  border-left-color: var(--c-warning);
  background: var(--tint-warning-bg);
  color: var(--text-on-warning);
}

.notice.success,
.notice.is-ok {
  border-color: var(--tint-success-border);
  border-left-color: var(--c-success);
  background: var(--tint-success-bg);
  color: var(--text-on-success);
}

.notice.info,
.discord-notice {
  border-left-color: var(--c-accent-400);
  background: var(--accent-soft);
  color: var(--c-accent-100);
}

/* =========================================================
   5. ПІГУЛКИ ТА ЧІПИ
   ========================================================= */
.status-pill,
.status-chip,
.raid-state,
.profile-count-pill,
.content-mode-pill,
[class$="-pill"],
[class*="-pill "],
[class$="-chip"],
[class*="-chip "],
[class$="-badge"],
[class*="-badge "],
[class$="-tag"],
[class*="-tag "] {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.04em;
  line-height: var(--line-height-copy);
  white-space: nowrap;
}

/* Тони пігулок — один набір станів на весь дашборд */
.is-ok,
.is-ready,
.is-active,
.is-synced,
.is-complete,
.is-connected,
.is-on,
.good,
.success,
[class$="--ok"],
[class*="--ok "],
[class$="--success"],
[class*="--success "] {
  --tone: var(--c-success);
}

.is-warning,
.is-pending,
.is-paused,
.warning,
[class$="--warning"],
[class*="--warning "] {
  --tone: var(--c-warning);
}

.is-problem,
.is-missing,
.is-blocked,
.is-expired,
.is-disconnected,
.is-invalid,
.danger,
[class$="--danger"],
[class*="--danger "],
[class$="--error"],
[class*="--error "] {
  --tone: var(--c-danger);
}

.is-selected,
.is-open,
.is-next,
.is-main,
.primary,
[class$="--accent"],
[class*="--accent "] {
  --tone: var(--c-accent-400);
}

.is-closed,
.is-empty,
.is-absent,
.is-off,
.subtle,
[class$="--muted"],
[class*="--muted "],
[class$="--ghost"],
[class*="--ghost "] {
  --tone: var(--c-ink-400);
}

.status-pill,
.status-chip,
.raid-state,
.profile-count-pill,
.content-mode-pill,
[class$="-pill"],
[class*="-pill "],
[class$="-chip"],
[class*="-chip "],
[class$="-badge"],
[class*="-badge "] {
  border-color: color-mix(in srgb, var(--tone, var(--c-ink-400)) 32%, transparent);
  background: color-mix(in srgb, var(--tone, var(--c-ink-400)) 12%, transparent);
  color: var(--tone, var(--text-soft));
}

/* Кнопка-фільтр у шапці таблиці */
[class$="-filter"]:not(:where([class*="field"])),
[class*="-filter "]:not(:where([class*="field"])) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: 38px;
  padding: 0 var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}


[class$="--tank"],
[class*="--tank "] {
  --tone: var(--c-role-tank);
}

[class$="--healer"],
[class*="--healer "] {
  --tone: var(--c-role-healer);
}

[class$="--dps"],
[class*="--dps "] {
  --tone: var(--c-role-dps);
}

[class$="--mythic"],
[class*="--mythic "] {
  --tone: var(--c-diff-mythic);
}

[class$="--heroic"],
[class*="--heroic "] {
  --tone: var(--c-diff-heroic);
}

[class$="--normal"],
[class*="--normal "] {
  --tone: var(--c-diff-normal);
}

/* =========================================================
   6. СПИСКИ ТА ТАБЛИЦІ
   ========================================================= */
.dashboard-list-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
}

.dashboard-list,
[class$="-list"]:not(:where(.dashboard-nav-more__menu-list)):not(:where(.discord-preview-list)),
[class*="-list "]:not(:where(.dashboard-nav-more__menu-list)):not(:where(.discord-preview-list)) {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}


/* Складений рядок: зміст ліворуч, дії праворуч */
.dashboard-list-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.dashboard-list-row > *:first-child {
  flex: 1 1 min(320px, 100%);
  min-width: 0;
}

/* Табличний рядок: рівні колонки, шапка вирівнюється з ними.
   Оголошено після .dashboard-list-row, тож на рядках із обома
   класами виграє саме сітка. */


.dashboard-list-row {
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: inherit;
  min-width: 0;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

a.dashboard-list-row:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  transform: translateY(-2px);
  color: inherit;
}

.dashboard-list-row > [role="cell"] {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.dashboard-list-row strong {
  font-size: 0.88rem;
  color: var(--text-strong);
  overflow-wrap: break-word;
}

.dashboard-list-row small {
  font-size: 0.74rem;
  color: var(--text-muted);
  overflow-wrap: break-word;
}

.dashboard-list-row > [role="cell"] > [class$="-pill"],
.dashboard-list-row > [role="cell"] > [class*="-pill "],
.dashboard-list-row > [role="cell"] > [class$="-chip"],
.dashboard-list-row > [role="cell"] > [class*="-chip "] {
  justify-self: start;
}


.raid-empty,
.content-empty,
[class$="-empty"]:not(:where([class*="characters"])):not(:where([class*="--empty"])),
[class*="-empty "]:not(:where([class*="characters"])):not(:where([class*="--empty"])) {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-xl) var(--space-md);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  text-align: center;
  color: var(--text-muted);
}

[class$="-empty"]:not(:where([class*="--empty"])) strong,
[class*="-empty "]:not(:where([class*="--empty"])) strong {
  color: var(--text-soft);
  font-size: 0.95rem;
}

/* Смуга показників над таблицею */
.guild-hero-stats,
.raid-list-summary,
[class$="-stats"]:not(:where([class*="grid"])),
[class*="-stats "]:not(:where([class*="grid"])) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(130px, 100%), 1fr));
  gap: var(--space-sm);
}

.guild-hero-stat-card {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

/* Керування у шапці таблиці */
.content-toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}


/* Мобільний вигляд рядків: картка з підписами колонок */
/* ---------- Мобільний вигляд списків ----------
   Табличний рядок перетворюється на картку: підпис колонки стає
   надрядком, значення — під ним. Двоколонковий варіант із підписом
   збоку тут не працює — довгі значення (ніки, спеки, дати) стискали
   праву колонку до 2-3 символів на 390px. */
@media (max-width: 860px) {
  

  

  .dashboard-list {
    gap: var(--space-sm);
  }

  .dashboard-list-row {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
    gap: var(--space-xs);
    padding: var(--space-md);
    border-radius: var(--radius-md);
  }

  .dashboard-list-row > [role="cell"] {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-3xs);
  }

  .dashboard-list-row > [role="cell"][data-label]::before {
    content: attr(data-label);
    font-size: 0.64rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  /* Перша комірка — заголовок картки, підпис їй не потрібен */
  

  

  

  /* Решта комірок лягає у дві колонки — інакше картка стає вежею */
  

  

  

  .dashboard-list-row > *:first-child {
    flex: 1 1 100%;
  }

  /* Дії у складених рядках розтягуються на всю ширину картки */
  .dashboard-list-actions,
.dashboard-list-row [class$="-actions"] {
    width: 100%;
  }

  

  

  
}

/* =========================================================
   7. ДЕТАЛІ, ТАБИ, ТУЛБАРИ
   ========================================================= */
details {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

summary {
  padding: var(--space-sm) var(--space-md);
  color: var(--text-soft);
  font-size: 0.85rem;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  list-style: none;
}

summary::-webkit-details-marker {
  display: none;
}

summary::before {
  content: "▸";
  display: inline-block;
  margin-right: var(--space-xs);
  color: var(--c-accent-300);
  transition: transform var(--dur-fast) var(--ease-out);
}

details[open] > summary::before {
  transform: rotate(90deg);
}

details > *:not(:where(summary)) {
  padding: 0 var(--space-md) var(--space-md);
}

/* Смуга вкладок */
[class$="-tabs"],
[class*="-tabs "] {
  display: flex;
  gap: var(--space-2xs);
  overflow-x: auto;
  scroll-snap-type: x proximity;
  padding-bottom: var(--space-2xs);
  scrollbar-width: none;
}

[class$="-tabs"]::-webkit-scrollbar,
[class*="-tabs "]::-webkit-scrollbar {
  display: none;
}

[class$="-tabs"] > a,
[class*="-tabs "] > a,
[class$="-tabs"] > button,
[class*="-tabs "] > button {
  flex: 0 0 auto;
  scroll-snap-align: start;
  min-height: 40px;
  padding: 0 var(--space-md);
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-size: var(--font-size-body-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

[class$="-tabs"] > a.is-active,
[class*="-tabs "] > a.is-active,
[class$="-tabs"] > button.is-active,
[class*="-tabs "] > button.is-active {
  border-color: transparent;
  background: var(--accent-gradient);
  color: var(--text-on-accent);
}

/* =========================================================
   8. АВАТАРИ ТА МЕДІА
   ========================================================= */
[class$="-avatar"],
/* =========================================================
   8. АВАТАРИ ТА МЕДІА
   ========================================================= */
[class*="-avatar "],
[class$="__avatar"],
[class*="__avatar "] {
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border);
  background: var(--surface-raised);
}

.raid-signup-avatar--empty,
[class$="-avatar--empty"],
[class*="-avatar--empty "] {
  display: grid;
  place-items: center;
  border-style: dashed;
  color: var(--text-faint);
}

/* =========================================================
   9. ТОСТИ
   ========================================================= */
.global-toast-stack {
  position: fixed;
  right: var(--space-md);
  bottom: calc(var(--space-md) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: min(360px, calc(100vw - var(--space-xl)));
  pointer-events: none;
}

.global-toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border);
  border-left: 3px solid var(--tone, var(--c-accent-400));
  border-radius: var(--radius-md);
  background: var(--nav-panel);
  box-shadow: var(--shadow-lg);
  color: var(--text-body);
  font-size: 0.85rem;
  pointer-events: auto;
  animation: toast-in var(--dur-base) var(--ease-spring);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.global-toast__body {
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: var(--space-3xs);
}

.global-toast__close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.global-toast__close:hover {
  background: var(--surface-hover);
  color: var(--text-strong);
}

@media (max-width: 640px) {
  .global-toast-stack {
    left: var(--space-sm);
    right: var(--space-sm);
    width: auto;
  }
}

/* =========================================================
   10. КАСТОМНІ ЧЕКБОКСИ Й РАДІО

   Системні контроли на темному тлі виглядають чужорідно:
   у Chrome вони світлі, у Firefox — інші за розміром.
   Малюємо власні, зберігаючи справжній input для доступності.
   ========================================================= */
input[type="checkbox"],
input[type="radio"] {
  appearance: none;
  -webkit-appearance: none;
  position: relative;
  width: 20px;
  height: 20px;
  min-height: 0;
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-strong);
  background: var(--surface-sunken);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

input[type="checkbox"] {
  border-radius: var(--radius-sm);
}

input[type="radio"] {
  border-radius: 50%;
}

input[type="checkbox"]:hover,
input[type="radio"]:hover {
  border-color: var(--c-accent-400);
}

input[type="checkbox"]:checked,
input[type="radio"]:checked {
  border-color: transparent;
  background: var(--accent-gradient);
}

/* Галочка домальована рамкою — жодних зображень і шрифтів */
input[type="checkbox"]:checked::after {
  content: "";
  position: absolute;
  left: 6px;
  top: 2px;
  width: 5px;
  height: 10px;
  border: solid var(--text-on-accent);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

input[type="radio"]:checked::after {
  content: "";
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--text-on-accent);
}

input[type="checkbox"]:focus-visible,
input[type="radio"]:focus-visible {
  outline: 0;
  box-shadow: 0 0 0 4px var(--accent-soft);
}

input[type="checkbox"]:disabled,
input[type="radio"]:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Мітка поруч із контролом клікабельна цілком */
label:has(> input[type="checkbox"]),
label:has(> input[type="radio"]) {
  cursor: pointer;
}

/* Вибраний варіант підсвічує всю картку, а не лише кружечок */
label:has(> input[type="radio"]:checked),
label:has(> input[type="checkbox"]:checked) {
  border-color: var(--border-strong);
}

/* =========================================================
   11. РОЗМІР ЦІЛІ ДЛЯ ДОТИКУ

   На десктопі компактні кнопки (34–38px) доречні: миша точна.
   На сенсорі це замало — палець промахується. Тому мінімум
   піднімається саме за шириною екрана, а не глобально:
   інакше десктопні тулбари роздулися б без причини.
   ========================================================= */
@media (max-width: 860px) {
  .btn-sm,
.nav-sheet__link {
    min-height: 44px;
  }

  /* Іконкові кнопки лишаються квадратними, просто більшими */
  .profile-icon-action {
    width: 44px;
    min-width: 44px;
    height: 44px;
  }

  /* Чекбокс і радіо: сам контрол більший, мітка клікабельна вся */
  input[type="checkbox"],
input[type="radio"] {
    width: 24px;
    height: 24px;
  }

  input[type="checkbox"]:checked::after {
    left: 8px;
    top: 3px;
    width: 6px;
    height: 12px;
  }

  input[type="radio"]:checked::after {
    inset: 6px;
  }

  .inline-check {
    min-height: 44px;
  }
}

/* Товщий бігунок діапазону там, де вказівник грубий.
   pointer: coarse точніший за ширину екрана: планшет із мишею
   лишається з тонким бігунком, телефон отримує великий. */

/* =========================================================
   12. ДОПОМІЖНІ ВИБОРИ — компактні чипи, не окремі кнопки дії
   ========================================================= */
.author-suggestion-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.author-suggestion-chips > small {
  flex: 0 0 auto;
}

.author-suggestion-chips > span {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  min-width: 0;
}

.author-suggestion-chip {
  display: inline-grid;
  gap: 1px;
  min-height: var(--control-height-sm);
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface-raised);
  color: var(--text-soft);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.author-suggestion-chip:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  color: var(--text-strong);
}

.author-suggestion-chip strong {
  font-size: var(--font-size-ui);
  line-height: 1.15;
}

.author-suggestion-chip em {
  color: var(--text-faint);
  font-size: var(--font-size-2xs);
  font-style: normal;
  line-height: 1.15;
}

/* R6.7 publication recovery, scoped to its own panel. */
/* Async actions may replace their button with a focusable result. */
[data-action-result]:focus,
[data-workflow-title]:focus {
  outline: 2px solid var(--orange-main);
  outline-offset: 3px;
  border-radius: 3px;
}
/* Keep empty live regions registered for assistive technology. */
[data-action-result]:empty {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Durable feedback for individual and bulk raid-poll actions. */
```

## src/app/styles/directory.css

```css
/* =========================================================
   DIRECTORY — єдиний шаблон сторінок-довідників

   Одна розкладка на всі сторінки, де є «hero + фільтри + таблиця»:
   /guild (склад гільдії), /profiles (профілі) і будь-яка майбутня.

   Замість трьох паралельних наборів (`guild-*`, `profile-directory-*`,
   `directory-*`) правила описані один раз і згруповані селекторами,
   бо в розмітці ці класи вже стоять поруч на тих самих вузлах.

   Порядок блоків: оболонка → hero → підсумок → тулбар → фільтри →
   таблиця → віджети → адаптив. Жодного !important.
   ========================================================= */

/* =========================================================
   1. ОБОЛОНКА
   ========================================================= */

/* =========================================================
   2. HERO
   ========================================================= */

.guild-hero-side {
  display: grid;
  gap: var(--space-md);
  align-content: start;
  min-width: 0;
}

/* Бічна панель hero: підсумок + лічильники */
.guild-hero-summary {
  display: grid;
  gap: var(--space-sm);
}

.guild-hero-summary__block {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.guild-hero-summary__label {
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.guild-hero-summary__block strong {
  font-size: 0.98rem;
  color: var(--text-strong);
}

.guild-hero-summary__block p {
  margin: 0;
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

.guild-hero-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(96px, 100%), 1fr));
  gap: var(--space-xs);
}

.guild-hero-stat-card {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  text-align: left;
}

.guild-hero-stat-card > span {
  font-size: 0.62rem;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.guild-hero-stat-card > strong {
  font-size: 1.05rem;
  color: var(--c-accent-200);
}

.guild-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

/* Підсумкова картка: емблема + лічильник + смуга показників */


/* Кнопка ручного оновлення складу */
.guild-refresh-action {
  display: grid;
  gap: var(--space-2xs);
  justify-items: start;
}

.guild-refresh-action__status {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

.guild-refresh-action__status--loading {
  color: var(--c-info);
}

.guild-refresh-action__status--error {
  color: var(--c-danger);
}

/* =========================================================
   3. ТУЛБАР І ФІЛЬТРИ
   ========================================================= */


#guild-roster-search {
  display: block;
  min-width: 0;
}

/* Розгорнута панель розширених фільтрів */


/* Група діапазону займає дві колонки: усередині вже є дві */


/* ---------- Діапазон від/до з двома повзунками ---------- */


/* Поля «від» і «до» стоять поруч, повзунок — під ними на всю ширину.

   Позиції задані явно, бо в розмітці порядок інший:
   заголовок → «від» → повзунок → «до». З автоматичним
   розміщенням «до» падало у третій рядок, і група
   розтягувалась у вежу з трьох поверхів. */


/* Суфіксний патерн [class$="-filter"] у components.css робить із
   .directory-range-filter кнопку-пігулку: капсульна рамка, padding
   і min-height. Тут це контейнер групи полів, тож скидаємо. */


/* Два range-инпути накладаються один на одного над спільною лінією.
   Клікабельні лише «бігунки», тож нижній повзунок не перехоплює
   натискання по всій ширині доріжки. */


/* =========================================================
   4. ТАБЛИЦЯ ДОВІДНИКА
   ========================================================= */


/* Головна комірка рядка: імʼя крупніше за решту */


/* Підвал таблиці: пагінація + підпис */

/* Роль фарбує ліву грань рядка — так само, як статус у списку рейдів */


/* Клас + спек однією коміркою з кольоровою міткою класу */


/* Сегменти Raider.IO без окремого legacy-блоку: активний стан оформлює поточна таблиця. */

/* =========================================================
   6. АДАПТИВ

   Мобільні правила рядків таблиці живуть у components.css
   (рядок → картка з підписами колонок). Тут лише те, що
   стосується довідника: hero, фільтри й віджети.
   ========================================================= */

/* =========================================================
   PROFILE DIRECTORY — щільний, читабельний roster без дублювання статистики
   ========================================================= */

/* Staff-only Discord raid preferences; horizontally scrollable on mobile. */
```

## src/app/styles/layout.css

```css
/* =========================================================
   LAYOUT — оболонки сторінок, секції, сітки, футер
   Ритм і максимальні ширини — ті самі, що на сайті:
   єдина ширина через --page-max, --pad-section по вертикалі,
   --pad-page-inline по горизонталі.
   ========================================================= */

/* ---------- Головна колонка ---------- */
main,
.container,
.app-page,
.dashboard-shell,
.content-shell,
.admin-container {
  width: 100%;
  max-width: var(--page-max);
  margin-inline: auto;
}

main,
.container,
.app-page {
  flex: 1 0 auto;
  padding: 24px var(--page-gutter);
  padding-bottom: calc(var(--space-3xl) + env(safe-area-inset-bottom, 0px));
}

/* Вкладені оболонки не подвоюють відступи */
.container .container,
.app-page .dashboard-shell,
.container .dashboard-shell,
main .dashboard-shell {
  padding-inline: 0;
  padding-block: 0;
  max-width: none;
}

/* ---------- Вертикальний стек секцій ---------- */
.dashboard-shell,
.content-shell,
.app-page-stack,
[class$="-shell"],
[class*="-shell "] {
  display: flex;
  flex-direction: column;
  gap: var(--page-gap);
}

/* ---------- Секція / панель сторінки ---------- */

/* ---------- Шапка секції ---------- */
.dashboard-list-head,
[class$="__head"],
[class*="__head "],
[class$="-head"]:not(:where(.profile-card-head--inline)),
[class*="-head "]:not(:where(.profile-card-head--inline)) {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
}

.dashboard-list-head > div {
  min-width: 0;
}

.dashboard-list-head p {
  max-width: 72ch;
  color: var(--text-soft);
  font-size: var(--font-size-body);
  line-height: 1.58;
}

/* ---------- Надзаголовок (section-tag сайту) ---------- */
.eyebrow,
.app-state-eyebrow,
[class$="__eyebrow"],
[class*="__eyebrow "],
[class$="-eyebrow"],
[class*="-eyebrow "] {
  display: inline-block;
  /* У grid/flex-батьках inline-block блокифікується й розтягується
     на всю ширину. fit-content + start тримають пігулку за змістом. */
  width: fit-content;
  justify-self: start;
  align-self: start;
  padding: var(--space-2xs) var(--space-sm);
  margin-bottom: var(--space-xs);
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--orange-main);
  font-size: 11px;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: var(--line-height-copy);
}

/* ---------- Лід-абзац і приглушений текст ---------- */
.lead,
[class$="__lead"],
[class*="__lead "],
[class$="-lead"],
[class*="-lead "] {
  max-width: 72ch;
  color: var(--text-soft);
  font-size: 0.95rem;
  line-height: var(--line-height-copy);
}

.subtle:not(:where(.btn)),
[class$="__hint"],
[class*="__hint "],
[class$="__meta"],
[class*="__meta "],
[class$="__desc"],
[class*="__desc "],
[class$="-note"]:not(:where(.error-note)):not(:where(.warning-note)),
[class*="-note "]:not(:where(.error-note)):not(:where(.warning-note)) {
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: var(--line-height-relaxed);
}

.hero-accent {
  color: var(--c-accent-300);
}

/* =========================================================
   HERO — велика картка-заголовок сторінки
   Контекстна панель із м’яким верхнім блиском.
   ========================================================= */
.hero,
.dashboard-hero,
[class$="-hero"]:not(:where([class*="landing"])),
[class*="-hero "]:not(:where([class*="landing"])) {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  align-items: center;
  gap: var(--space-lg);
  padding: clamp(var(--space-md), 2.4vw, var(--space-xl));
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.hero::before,
.dashboard-hero::before,
[class$="-hero"]:not(:where([class*="landing"]))::before,
[class*="-hero "]:not(:where([class*="landing"]))::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.045),
    transparent 30%,
    transparent 70%,
    rgba(255, 255, 255, 0.02)
  );
}

.hero > *,
.dashboard-hero > * {
  position: relative;
  z-index: 1;
  min-width: 0;
}

.hero-copy,
.dashboard-hero__copy,
.guild-hero__copy,
[class$="-hero__copy"],
[class*="-hero__copy "] {
  min-width: 0;
}

.hero-copy h1,
.dashboard-hero__copy h1,
[class$="-hero__copy"] h1,
[class*="-hero__copy "] h1 {
  margin-bottom: var(--space-xs);
}

.hero-copy p,
.dashboard-hero__copy p,
[class$="-hero__copy"] p,
[class*="-hero__copy "] p {
  max-width: 62ch;
  color: var(--text-soft);
  line-height: 1.58;
}

[class$="-hero__actions"],
[class*="-hero__actions "],
[class$="__actions"],
[class*="__actions "],
.form-actions,
.dashboard-list-actions,
[class$="-actions"],
[class*="-actions "] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}

[class$="-hero__actions"],
[class*="-hero__actions "] {
  margin-top: var(--space-md);
}

.form-actions--split {
  justify-content: space-between;
}

@media (max-width: 860px) {
.hero,
.dashboard-hero,
[class$="-hero"]:not(:where([class*="landing"])),
[class*="-hero "]:not(:where([class*="landing"])) {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* =========================================================
   СІТКИ
   Один патерн auto-fit: не треба описувати кожну сітку окремо.
   ========================================================= */
[class$="-grid"],
[class*="-grid "],
[class$="__grid"],
[class*="__grid "],
.access-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: var(--gap-grid);
}

/* Дрібніші плитки: статистика,
лічильники */
[class*="-stats-grid"],
[class*="-metrics"],
[class$="-stat-grid"],
[class*="-stat-grid "] {
  grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr));
  gap: var(--space-sm);
}

/* Форма у дві колонки */
.access-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: var(--space-md);
}

/* Поле на всю ширину сітки */
.content-field--wide,
.raid-poll-field--wide,
[class$="--wide"],
[class*="--wide "],
[class$="--full"],
[class*="--full "] {
  grid-column: 1 / -1;
}

/* ---------- Головна: контент + бічний стек ---------- */

[class$="-layout"]:not(:where(.access-groups-layout)),
[class*="-layout "]:not(:where(.access-groups-layout)) {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: var(--gap-grid);
  align-items: start;
}

@media (max-width: 1000px) {

[class$="-layout"]:not(:where(.access-groups-layout)),
[class*="-layout "]:not(:where(.access-groups-layout)) {
    grid-template-columns: minmax(0, 1fr);
  }

  
}

/* =========================================================
   ФУТЕР — спільна мова застосунку
   ========================================================= */
.app-footer {
  flex: 0 0 auto;
  margin-top: auto;
  padding: var(--space-xl) var(--pad-page-inline) calc(var(--space-lg) + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-sunken);
  font-size: var(--font-size-body);
  color: var(--text-muted);
}

.app-footer__inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  max-width: var(--page-max);
  margin: 0 auto;
}

.app-footer__brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.app-footer__brand-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.app-footer__crest {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
}

.app-footer__crest svg {
  width: 100%;
  height: 100%;
}

.app-footer__crest-shadow {
  fill: rgba(0, 0, 0, 0.45);
}

.app-footer__crest-border {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 2;
}

.app-footer__crest-inner {
  fill: var(--surface-raised);
}

.app-footer__crest-letter {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--font-brand);
  font-size: 15px;
  font-weight: var(--font-weight-bold);
  color: var(--c-accent-300);
}

.app-footer__title {
  font-family: var(--font-brand);
  font-size: 0.95rem;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-strong);
}

.app-footer__link-separator {
  width: 1px;
  height: 16px;
  background: var(--border);
}

.app-footer__tagline {
  max-width: 44ch;
  color: var(--text-faint);
  line-height: var(--line-height-body);
}

.app-footer__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-md);
}

.app-footer__versions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.app-footer__version {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-soft);
  line-height: 1;
  white-space: nowrap;
}

.app-footer__version-label {
  color: var(--text-faint);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-footer__version strong {
  color: var(--text-strong);
  font-size: var(--font-size-ui);
  font-variant-numeric: tabular-nums;
}

.app-footer__links {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.app-footer__links a {
  color: var(--text-soft);
}

.app-footer__links a:hover {
  color: var(--c-accent-200);
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (max-width: 640px) {
  .app-footer__inner {
    flex-direction: column;
    align-items: stretch;
  }

  .app-footer__brand {
    align-items: flex-start;
  }

  .app-footer__meta {
    width: 100%;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-sm) var(--space-md);
  }

  .app-footer__versions {
    flex: 1 1 auto;
  }

  .app-footer__version {
    min-height: 32px;
  }
}

@media (max-width: 420px) {
  .app-footer__meta,
.app-footer__versions {
    width: 100%;
  }

  .app-footer__version {
    flex: 1 1 0;
    justify-content: center;
  }

  .app-footer__links {
    width: 100%;
  }
}

/* =========================================================
   СТАНИ ПОМИЛОК / ДОСТУПУ
   Global route loader intentionally removed: navigation keeps the current
   screen until the next server payload is ready instead of painting a fake
   intermediate page.
   ========================================================= */
.app-state-shell,
.access-denied-shell {
  display: grid;
  place-items: center;
  min-height: 60vh;
  padding: var(--pad-section) var(--pad-page-inline);
}

.app-state-page {
  width: 100%;
  max-width: 560px;
}

@media (max-width: 560px) {
  .app-state-shell,
.access-denied-shell {
    padding-inline: 14px;
  }
}
```

## src/app/styles/lists.css

```css
/* =========================================================
   LISTS — shared list details still used by current pages.
   Legacy generic application classes were removed after the
   dedicated applications workbench replaced them.
   ========================================================= */

/* =========================================================
   4. РЯДКИ, ЩО МАЛИ ВЛАСНУ РОЗМІТКУ

   Діагностика знайшла три різні способи робити одне й те саме:
     1. .dashboard-table-row + data-label       (профілі, гільдія)
     2. .discord-raid-signups-row + .…-mobile-label (правила)
     3. .content-row без підписів узагалі       (новини/гайди)

   Третій варіант на телефоні давав набір значень без пояснень:
   «15.08.2026 / Дмитро / Чернетка» — і незрозуміло, де дата,
   а де автор. Тут усі три зводяться до однієї поведінки:
   ПК — рядок-сітка з шапкою, мобайл — картка з підписами.
   ========================================================= */

.discord-raid-signups-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
  min-width: 0;
}

.discord-raid-signups-table {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-raid-signups-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-size-ui-lg);
  line-height: var(--line-height-relaxed);
}

/* ---------- Рядок контенту ---------- */

/* ---------- Рядок підписантів правил ---------- */
.discord-raid-signups-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.discord-raid-signups-row > [role="cell"] {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.discord-raid-signups-row strong {
  font-size: 0.88rem;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.discord-raid-signups-row small,
.discord-raid-signups-row time {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

.discord-raid-signups-row--head {
  padding: var(--space-2xs) var(--space-md);
  border: 0;
  background: none;
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

/* Підпис усередині комірки потрібен лише на телефоні */
.discord-raid-mobile-label {
  display: none;
}

/* =========================================================
   5. МОБІЛЬНИЙ ВИГЛЯД: РЯДОК → КАРТКА
   ========================================================= */
@media (max-width: 860px) {

  /* Метадані з правого краю переїжджають під картку: праворуч
     вони втрачали звʼязок із рядком, до якого належать. */

  .discord-raid-signups-row--head {
    display: none;
  }

  .discord-raid-signups-row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-xs);
  }

  /* Підпис колонки стає надрядком значення */
  .discord-raid-mobile-label {
    display: block;
    font-size: 0.64rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .discord-raid-signups-row > [role="cell"]:first-child {
    padding-bottom: var(--space-xs);
    border-bottom: 1px solid var(--border-subtle);
  }

  .discord-raid-signups-row > [role="cell"]:first-child strong {
    font-size: var(--font-size-base);
  }
}
```

## src/app/styles/pages.css

```css
/* =========================================================
   PAGES — родини сторінок дашборду

   Базові поверхні, кнопки й поля вже описані в components.css.
   Тут лишається тільки те, що специфічне для конкретної
   сторінки: розкладка рядка рейду, перегляд Discord-повідомлення,
   бічна колонка профілю тощо.

   Жодного !important.
   ========================================================= */

/* =========================================================
   ГОЛОВНА
   ========================================================= */

.hero-secure-note {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  color: var(--text-faint);
  font-size: var(--font-size-ui);
}

.hero-lock {
  color: var(--c-accent-300);
}

/* =========================================================
   ПУЛИ
   ========================================================= */

/* =========================================================
   ПРОФІЛЬ
   ========================================================= */
/* Сторінка профілю: бічна колонка + основний стовпчик */

.profile-character-candidate__kind {
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.profile-discord-standard {
  display: grid;
  gap: var(--space-sm);
}

.profile-card-head--inline {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--space-sm);
}

.profile-empty-characters {
  display: grid;
  gap: var(--space-xs);
  padding: var(--space-lg);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  text-align: center;
  color: var(--text-muted);
}

.profile-empty-characters--compact {
  padding: var(--space-md);
}

.profile-nickname-preview {
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--c-accent-200);
  overflow-wrap: anywhere;
}

.profile-nickname-hint {
  font-size: var(--font-size-meta);
  color: var(--text-muted);
}

/* =========================================================
   DISCORD — редактор і перегляд повідомлення
   ========================================================= */
.discord-builder-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr);
  gap: var(--gap-grid);
  align-items: start;
}

.discord-builder-panel,
.discord-preview-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: 0;
}

.discord-builder-titlebar,
.discord-preview-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--font-size-ui);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.discord-builder-body,
.discord-builder-form {
  display: grid;
  gap: var(--space-md);
  min-width: 0;
}

.discord-preview-mode-toggle {
  display: inline-flex;
  gap: var(--space-3xs);
  padding: var(--space-3xs);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
}

.discord-preview-mode-toggle button {
  min-height: 28px;
  padding: 0 var(--space-sm);
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.04em;
  cursor: pointer;
}

.discord-preview-mode-toggle button.is-active {
  background: var(--accent-soft);
  color: var(--c-accent-200);
}

/* Полотно перегляду — темніше за панель, як канал у Discord */
.discord-preview-canvas {
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: #1a1611;
  overflow-x: auto;
}

.discord-preview-panel--mobile .discord-preview-canvas {
  max-width: 420px;
}

.discord-chat-preview {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-sm);
}

.discord-chat-preview__avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--c-discord);
  color: #fff;
  font-size: 0.75rem;
  font-weight: var(--font-weight-bold);
}

.discord-chat-preview__body {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-chat-preview__meta {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
}

.discord-chat-preview__meta strong {
  color: #fff;
  font-size: 0.92rem;
}

.discord-chat-preview__meta span {
  font-size: var(--font-size-caption);
  color: var(--text-faint);
}

.discord-preview-content {
  display: grid;
  gap: var(--space-2xs);
  color: #dcddde;
  font-size: var(--font-size-body);
  line-height: var(--line-height-body);
}

.discord-preview-mentions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.discord-preview-mentions span,
.discord-preview-mention {
  padding: 0 var(--space-2xs);
  border-radius: var(--radius-sm);
  background: rgba(88, 101, 242, 0.24);
  color: #c9cdfb;
  font-weight: var(--font-weight-medium);
}

/* Сам ембед */
.discord-message-preview {
  border-left: 4px solid var(--c-accent-400);
  border-radius: var(--radius-sm);
  background: #211c16;
  padding: var(--space-sm) var(--space-md);
  max-width: 520px;
}

.discord-message-preview__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-sm);
}

.discord-message-preview__main {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-preview-author-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.discord-preview-author-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.discord-preview-author {
  font-size: var(--font-size-body-sm);
  font-weight: var(--font-weight-medium);
  color: #fff;
}

.discord-preview-title {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  color: var(--c-accent-200);
  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0;
  text-transform: none;
}

.discord-preview-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
  gap: var(--space-xs);
}

.discord-preview-fields--with-thumb {
  padding-right: var(--space-sm);
}

/* Discord кладе inline-поля поруч, а звичайні — на всю ширину ембеда */
.discord-preview-field--full {
  grid-column: 1 / -1;
}

.discord-preview-field {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.discord-preview-field-name {
  font-size: var(--font-size-body-sm);
  color: #fff;
}

.discord-preview-field-value {
  font-size: 0.84rem;
  color: #dcddde;
}

.discord-preview-thumb {
  width: 80px;
  height: 80px;
  border-radius: var(--radius-sm);
  object-fit: cover;
}

.discord-preview-image {
  width: 100%;
  margin-top: var(--space-sm);
  border-radius: var(--radius-sm);
}

.discord-message-preview footer {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: var(--font-size-sm);
  color: var(--text-faint);
}

.discord-message-preview footer img {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}

.discord-preview-error {
  font-size: var(--font-size-ui-lg);
  color: var(--c-danger);
}

/* Markdown усередині перегляду */
.discord-preview-markdown {
  display: grid;
  gap: var(--space-xs);
  color: #dcddde;
  font-size: 0.88rem;
  line-height: var(--line-height-relaxed);
}

.discord-preview-markdown--compact {
  gap: var(--space-2xs);
}

.discord-preview-link {
  color: #00a8fc;
}

.discord-preview-heading {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  color: #fff;
  font-size: 0.95rem;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0;
  text-transform: none;
}

.discord-preview-subtext {
  font-size: var(--font-size-ui);
  color: var(--text-faint);
}

.discord-preview-quote {
  padding-left: var(--space-sm);
  border-left: 3px solid var(--c-base-400);
}

.discord-preview-list {
  display: grid;
  gap: var(--space-3xs);
  padding-left: var(--space-md);
}

.discord-preview-list-bullet {
  color: var(--c-accent-300);
}

.discord-preview-codeblock {
  padding: var(--space-sm);
  border: 1px solid #111;
  border-radius: var(--radius-sm);
  background: #131313;
  font-family: var(--font-mono);
  font-size: var(--font-size-ui-lg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.discord-preview-spoiler {
  border-radius: var(--radius-sm);
  background: #202225;
  color: transparent;
  cursor: pointer;
}

.discord-preview-spoiler:hover {
  color: #dcddde;
}

.discord-preview-timestamp {
  padding: 0 var(--space-2xs);
  border-radius: var(--radius-sm);
  background: rgba(88, 101, 242, 0.18);
}

.discord-preview-emoji {
  display: inline-block;
  width: 1.25em;
  height: 1.25em;
  vertical-align: -0.2em;
}

.discord-preview-gap {
  height: var(--space-xs);
}

/* Керування Discord */
.discord-management-card {
  display: grid;
  gap: var(--space-sm);
}

.discord-management-card__body {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-management-card--action {
  border-color: var(--border-strong);
}

.discord-management-section {
  display: grid;
  gap: var(--gap-stack);
}

.discord-role-picker {
  --role-picker-gap: 6px;
  --role-picker-card-height: 40px;
  display: grid;
  gap: var(--role-picker-gap);
  min-width: 0;
}

.discord-role-selected-shell {
  display: grid;
  gap: var(--space-2xs);
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 88%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-raised) 78%, var(--surface-sunken));
}

.discord-role-selected-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  min-height: 18px;
}

.discord-role-selected-head strong {
  color: var(--text-strong);
  font-size: var(--font-size-ui);
}

.discord-role-selected-head span {
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-semibold);
}

.discord-role-selected {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 24px;
}

.discord-role-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 72%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--c-accent-500) 10%, var(--surface-raised));
  color: var(--text-strong);
  font-size: 0.75rem;
  font-weight: var(--font-weight-bold);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.discord-role-chip:hover {
  border-color: color-mix(in srgb, var(--c-accent-400) 58%, var(--border-strong));
  background: color-mix(in srgb, var(--c-accent-500) 16%, var(--surface-raised));
  transform: translateY(-1px);
}

.discord-role-chip__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.discord-role-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-sunken) 72%, transparent);
  color: var(--text-muted);
  font-size: var(--font-size-body-sm);
  line-height: 1;
}

.discord-role-placeholder {
  color: var(--text-faint);
  font-size: var(--font-size-ui);
  line-height: 1.25;
}

.discord-role-search-shell {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  min-height: 36px;
  padding-inline: 9px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 88%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-sunken) 72%, transparent);
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.discord-role-search-shell:focus-within {
  border-color: color-mix(in srgb, var(--c-accent-400) 54%, var(--border-strong));
  background: color-mix(in srgb, var(--surface-raised) 82%, var(--surface-sunken));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c-accent-500) 14%, transparent);
}

.discord-role-search-icon {
  color: var(--text-muted);
  font-size: var(--font-size-base);
  line-height: 1;
}

.discord-role-search {
  width: 100%;
  max-width: none;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.discord-role-search:focus {
  box-shadow: none;
}

.discord-role-picker-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  align-items: start;
}

.discord-role-picker-option {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  grid-template-areas: "control body badge";
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: var(--role-picker-card-height);
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 88%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-raised) 76%, var(--surface-sunken));
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.discord-role-picker-option:hover {
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--surface-raised) 88%, var(--surface-sunken));
  transform: translateY(-1px);
}

.discord-role-picker-option[data-selected="true"] {
  border-color: color-mix(in srgb, var(--c-accent-400) 62%, var(--border-strong));
  background: color-mix(in srgb, var(--c-accent-500) 12%, var(--surface-raised));
}

.discord-role-picker-option__control {
  grid-area: control;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid color-mix(in srgb, var(--border-strong) 72%, transparent);
  border-radius: var(--radius-pill);
  background: transparent;
  color: transparent;
  font-size: 0.75rem;
  font-weight: var(--font-weight-heavy);
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.discord-role-picker-option[data-selected="true"] .discord-role-picker-option__control {
  border-color: color-mix(in srgb, var(--c-accent-300) 72%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--c-accent-400) 72%, white 8%), color-mix(in srgb, var(--c-accent-500) 84%, black 8%));
  color: #201106;
}

.discord-role-picker-option__body {
  grid-area: body;
  display: grid;
  gap: 0;
  min-width: 0;
}

.discord-role-picker-option__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.discord-role-picker-option__name {
  min-width: 0;
  color: var(--text-strong);
  font-size: var(--font-size-body-sm);
  font-weight: var(--font-weight-bold);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.discord-role-picker-option__hint {
  display: none;
}

.discord-role-picker-option__badge {
  grid-area: badge;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-sunken) 72%, transparent);
  color: var(--text-muted);
  font-size: 0.65rem;
  font-weight: var(--font-weight-bold);
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}

.discord-role-picker-option[data-selected="true"] .discord-role-picker-option__badge {
  border-color: color-mix(in srgb, var(--c-accent-400) 52%, var(--border-strong));
  background: color-mix(in srgb, var(--c-accent-500) 18%, var(--surface-raised));
  color: var(--c-accent-200);
}

.discord-role-empty {
  grid-column: 1 / -1;
  padding: 10px 12px;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--surface-sunken) 82%, transparent);
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

.discord-role-picker__help {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-tight);
}

.discord-role-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.discord-visual-section {
  display: grid;
  gap: var(--space-sm);
}

.discord-shell,
.discord-hub-card {
  min-width: 0;
}

@media (max-width: 1000px) {
  .discord-builder-shell {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* Дві колонки зберігаємо на планшетах. На телефоні переходимо в одну,
   але самі картки залишаються низькими й не перетворюються на вертикальні блоки. */
@media (max-width: 640px) {
  .discord-role-picker {
    --role-picker-gap: 6px;
    --role-picker-card-height: 44px;
  }

  .discord-role-selected-shell {
    padding: 7px 9px;
  }

  .discord-role-selected {
    min-height: 22px;
  }

  .discord-role-search-shell {
    min-height: 36px;
    padding-inline: 9px;
  }

  .discord-role-search {
    min-height: 32px;
  }

  .discord-role-picker-list {
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .discord-role-picker-option {
    grid-template-columns: 20px minmax(0, 1fr) auto;
    grid-template-areas: "control body badge";
    align-items: center;
    gap: 7px;
    padding: 5px 8px;
    border-radius: var(--radius-md);
  }

  .discord-role-picker-option__control {
    width: 18px;
    height: 18px;
  }

  .discord-role-picker-option__hint {
    display: none;
  }

  .discord-role-picker-option__badge {
    min-width: 56px;
    min-height: 24px;
    padding-inline: 7px;
    font-size: 0.65rem;
  }

  .discord-role-picker__help {
    font-size: var(--font-size-xs);
  }
}

@media (max-width: 420px) {
  .discord-role-picker-option {
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: 7px;
  }

  .discord-role-picker-option__badge {
    min-width: 54px;
    padding-inline: 7px;
  }
}

@media (max-width: 640px) {
  .discord-message-preview__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-preview-thumb {
    width: 100%;
    height: auto;
  }
}

/* =========================================================
   КОНТЕНТ (новини / гайди)
   ========================================================= */
.content-hero-status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.content-hero-path {
  font-family: var(--font-mono);
  font-size: var(--font-size-meta);
  color: var(--text-faint);
  overflow-wrap: anywhere;
}

.content-mode-pill--library {
  --tone: var(--c-info);
}

.content-section-head--toolbar {
  align-items: center;
}

/* =========================================================
   АДМІН
   ========================================================= */
.admin-page {
  min-width: 0;
}

.admin-container {
  display: flex;
  flex-direction: column;
  gap: var(--gap-grid);
  min-width: 0;
}

/* На вузьких екранах адмінка ніколи не тягне горизонтальний скрол */
.admin-page * {
  overflow-wrap: break-word;
}

/* =========================================================
   ПРАВИЛА / ОНБОРДИНГ
   ========================================================= */

/* =========================================================
   АВТОРИЗАЦІЯ — пейзаж, золото й ембер із наданого шаблону.
   Ізольовано від геометрії навігації та решти сторінок.
   ========================================================= */
body:has(.login-screen) {
  padding: 0;
  background: #0c1734;
}

body:has(.login-screen) #site-starfield,
body:has(.login-screen) .app-footer--site-wide {
  display: none;
}

.login-screen {
  position: relative;
  isolation: isolate;
  flex: 1 0 auto;
  display: grid;
  place-items: center;
  max-width: none;
  margin: 0;
  min-height: 100vh;
  min-height: 100svh;
  width: 100%;
  padding: max(36px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(36px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
  overflow: hidden;
  background: #0c1734;
}
.login-background { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.login-background-poster { position: absolute; inset: 0; background: url("/assets/img/auth/forever-landscape.avif") center / cover no-repeat; transform: scale(1.06); }
.login-background-video { position: absolute; inset: 0; opacity: 0; transition: opacity 1.6s; }
.login-background.is-on .login-background-video { opacity: 1; }
.login-background-video video { position: absolute; top: 50%; left: 50%; width: 100%; height: 100%; max-width: none; object-fit: cover; transform: translate(-50%, -50%) scale(1.12); opacity: 0; transition: opacity 1s; }
.login-background-video video.is-retiring { opacity: 1; z-index: 1; transition: none; }
.login-background-video video.is-shown { opacity: 1; z-index: 2; }
.login-background::after { content: ""; position: absolute; inset: 0; background: radial-gradient(60% 45% at 50% 68%, rgba(6, 12, 30, .55) 0%, transparent 100%), radial-gradient(120% 80% at 50% 40%, transparent 35%, rgba(6, 12, 30, .75) 100%), linear-gradient(to bottom, rgba(6, 12, 30, .55) 0%, transparent 22%, transparent 45%, rgba(12, 23, 52, .92) 88%, #0c1734 100%); }

.login-shell {
  position: relative;
  z-index: 1;
  width: min(460px, 100%);
  padding: clamp(28px, 4vw, 42px) clamp(22px, 4vw, 36px);
  border: 1px solid rgba(216, 178, 94, .65);
  border-radius: 3px;
  background: linear-gradient(155deg, rgba(46, 33, 12, .95), rgba(9, 18, 44, .97));
  box-shadow: 0 30px 80px rgba(0, 0, 0, .55), 0 0 60px rgba(245, 197, 52, .08), inset 0 0 0 5px rgba(6, 12, 30, .16);
}

.login-shell__corner {
  position: absolute;
  width: 9px;
  height: 9px;
  background: #d8b25e;
  rotate: 45deg;
  box-shadow: 0 0 0 2px #2b1705;
  pointer-events: none;
}
.login-shell__corner--tl { top: -5px; left: -5px; }
.login-shell__corner--tr { top: -5px; right: -5px; }
.login-shell__corner--bl { bottom: -5px; left: -5px; }
.login-shell__corner--br { bottom: -5px; right: -5px; }

.login-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  min-width: 0;
  text-align: center;
}
.login-brandmark {
  position: relative;
  display: grid;
  width: 88px;
  height: 88px;
  place-items: center;
}
.login-brandmark__halo {
  position: absolute;
  inset: -20px;
  background: radial-gradient(circle, rgba(216, 178, 94, .17), transparent 68%);
  pointer-events: none;
}
.login-brandmark img {
  width: 72px;
  height: 72px;
  border: 1px solid #d8b25e;
  border-radius: 50%;
  background: #0c1734;
  box-shadow: 0 4px 18px rgba(0, 0, 0, .5);
}
.login-brandmark__frame {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(216, 178, 94, .45);
  border-radius: 50%;
  pointer-events: none;
}
.login-title-block { display: grid; justify-items: center; gap: 12px; width: 100%; }
.login-guild-name {
  max-width: 100%;
  margin: 0;
  color: #d8b25e;
  font-family: var(--font-guild-heading), Georgia, serif;
  font-size: 1rem;
  line-height: 1.35;
  letter-spacing: .13em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.login-content h1 {
  margin: 0;
  color: #fff3d6;
  font-family: var(--font-guild-heading), Georgia, serif;
  font-size: clamp(1.9rem, 4vw, 2.3rem);
  font-weight: 700;
  line-height: 1.15;
  text-wrap: balance;
  text-shadow: 0 2px 12px rgba(0, 0, 0, .65);
}
.login-title-divider { display: grid; grid-template-columns: 1fr 7px 1fr; align-items: center; gap: 9px; width: 152px; }
.login-title-divider > span { height: 1px; background: linear-gradient(90deg, transparent, #d8b25e); }
.login-title-divider > span:last-child { transform: scaleX(-1); }
.login-title-divider > i { width: 7px; height: 7px; rotate: 45deg; border: 1px solid #d8b25e; }
.login-lead { max-width: 34ch; margin: 0; color: #e0d5bb; font-size: .94rem; line-height: 1.65; }
.login-alert {
  width: 100%;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid #b66051;
  border-left: 3px solid #d48b76;
  border-radius: 3px;
  background: rgba(85, 17, 17, .55);
  color: #ffede1;
  font-size: .92rem;
  line-height: 1.55;
  text-align: left;
  overflow-wrap: anywhere;
}
.login-alert.notice.success { border-color: #7eae8c; background: rgba(26, 56, 40, .65); color: #e3f3e5; }
.login-alert strong { color: inherit; }
.login-action-row { display: grid; gap: 12px; width: 100%; }
.login-discord-button {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 12px 16px;
  border: 2px solid #d8b25e;
  border-radius: 3px;
  background: linear-gradient(180deg, #b82e25, #8e1b16 55%, #5a0d0a);
  color: #fff3d6;
  text-align: left;
  box-shadow: inset 0 1px 0 rgba(255, 220, 160, .45), 0 0 0 1px #2b1705, 0 8px 24px rgba(0, 0, 0, .35);
  transition: filter .2s, transform .2s;
}
.login-discord-button:hover { color: #fff3d6; filter: brightness(1.12); }
.login-discord-button:active { transform: translateY(1px); }
.login-discord-button:focus-visible,
.login-token summary:focus-visible,
.login-token input:focus-visible,
.login-token button:focus-visible { outline: 2px solid #ffe9b5; outline-offset: 5px; }
.login-discord-button__icon { display: grid; width: 28px; height: 28px; place-items: center; }
.login-discord-button__icon svg { width: 26px; height: 26px; }
.login-discord-button strong { display: block; color: inherit; font-size: 1rem; line-height: 1.3; }
.login-discord-button small { display: block; margin-top: 3px; color: #f3d7c3; font-size: .72rem; line-height: 1.4; }
.login-discord-button__arrow { color: #f3d58d; font-size: 1.3rem; }
.login-token { width: 100%; padding-top: 18px; border-top: 1px solid rgba(216, 178, 94, .25); text-align: left; }
.login-token summary { padding-block: 6px; color: #d8c69d; font-size: .85rem; cursor: pointer; }
.login-token form { display: grid; gap: 9px; margin-top: 12px; }
.login-token label { color: #efe2c0; font-size: .85rem; }
.login-token__row { display: flex; gap: 10px; }
.login-token__row input { min-width: 0; flex: 1; border-color: rgba(216, 178, 94, .55); background: #0c1734; color: #fff3d6; font-size: 16px; }
.login-token__row button { flex: 0 0 auto; min-height: 46px; padding-inline: 16px; }

@media (max-width: 640px) {
  .login-screen {
    padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));

  }
  .login-shell { padding: 28px 22px; }
  .login-content { gap: 18px; }
  .login-brandmark { width: 78px; height: 78px; }
  .login-brandmark img { width: 64px; height: 64px; }
  .login-content h1 { font-size: clamp(1.75rem, 7.5vw, 2rem); }
  .login-guild-name { font-size: .85rem; letter-spacing: .09em; }
  .login-lead { font-size: .9rem; }
  .login-discord-button { min-height: 64px; gap: 10px; padding-inline: 12px; }
  .login-discord-button strong { font-size: .95rem; }
  .login-discord-button__arrow { display: none; }
  .login-discord-button { grid-template-columns: auto minmax(0, 1fr); }
  .login-token__row { display: grid; }
  .login-token__row button { width: 100%; }
}

@media (max-height: 600px) and (min-width: 641px) {
  .login-screen { padding-block: 20px; }
  .login-shell { padding-block: 24px; }
  .login-content { gap: 14px; }
  .login-brandmark { width: 68px; height: 68px; }
  .login-brandmark img { width: 56px; height: 56px; }
}

@media (prefers-reduced-motion: reduce) {
  .login-discord-button { transition: none; }
  .login-background-video { display: none; transition: none; }
  .login-background-video video { transition: none; }
}

.app-state-page {
  display: grid;
  gap: var(--space-sm);
  justify-items: center;
  text-align: center;
}

/* =========================================================
   РОСТЕР
   ========================================================= */
.roster-inline-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

/* =========================================================
   ГОЛОВНА: КАЛЕНДАР І НАЙБЛИЖЧІ ПОДІЇ
   ========================================================= */

/* =========================================================
   DISCORD: РЕДАКТОР, ДІАГНОСТИКА, ТАБЛИЦІ
   ========================================================= */
.discord-builder-textarea,
.discord-description-area {
  min-height: 180px;
  font-family: var(--font-mono);
  font-size: 0.85rem;
}

.discord-send-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
}

.discord-load-message-btn {
  flex: 0 0 auto;
}

/* Вибір кольору: системний свотч + код поруч */
.discord-color-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.discord-color-picker input[type="color"] {
  width: 46px;
  height: 44px;
  min-height: 0;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-sunken);
  cursor: pointer;
}

.discord-color-code {
  font-family: var(--font-mono);
  font-size: var(--font-size-body-sm);
  color: var(--c-accent-200);
  text-transform: uppercase;
}

/* Чекбокси ролей і службові прапорці */
.discord-role-checkboxes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(200px, 100%), 1fr));
  gap: var(--space-xs);
  max-height: 260px;
  overflow-y: auto;
  padding: var(--space-2xs);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.discord-inline-check,
.discord-timestamp-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 38px;
  color: var(--text-soft);
  font-size: var(--font-size-body-sm);
  cursor: pointer;
}

/* Діагностика та JSON-помилки — моноширинні блоки */
.discord-diagnostics {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}


.discord-json-error {
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--tint-danger-border);
  border-left: 3px solid var(--c-danger);
  border-radius: var(--radius-md);
  background: var(--tint-danger-bg);
  color: var(--text-on-danger);
  font-family: var(--font-mono);
  font-size: var(--font-size-ui);
  overflow-wrap: anywhere;
}

.discord-management-blocked-roles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

/* Таблиці Discord-розділу успадковують шаблон довідника */
.discord-raid-signups-table,
.discord-rules-table {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.discord-rules-data-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--space-sm);
}


.discord-rules-metric {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.discord-rules-metric strong {
  font-size: 1.05rem;
  color: var(--text-strong);
}

.discord-rules-metric small {
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* Дві колонки «бібліотека + редактор» */
.discord-rules-library-split {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: var(--gap-grid);
  align-items: start;
  min-width: 0;
}

.discord-preview-quote--multi {
  display: grid;
  gap: var(--space-3xs);
}

/* =========================================================
   ДРІБНІ КЛАСИ БЕЗ ВЛАСНОГО ДОМЕНУ
   ========================================================= */
.status-select {
  min-width: 0;
}

.permission-check {
  color: var(--text-muted);
  font-size: var(--font-size-ui-lg);
  line-height: var(--line-height-relaxed);
}

.global-toast--persistent {
  border-left-color: var(--c-warning);
}

.access-denied-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

/* Завантаження зображення: підпис поверх поля */

/* Таблиці з модифікатором домену — ті самі правила довідника */


@media (max-width: 1000px) {
  .discord-rules-library-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 860px) {
  

  

  .discord-role-checkboxes {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-send-controls .btn {
    width: 100%;
  }
}


.discord-builder-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-md);
  align-items: start;
}

.discord-mode-pill {
  align-self: start;
  justify-self: end;
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0.35rem 0.8rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-raised) 85%, transparent);
  color: var(--text-soft);
  font-size: 0.75rem;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.discord-builder-form {
  gap: clamp(14px, 1.3vw, 18px);
}

.discord-builder-form .content-form-section {
  display: grid;
  gap: clamp(12px, 1.1vw, 16px);
  min-width: 0;
  padding: clamp(16px, 1.45vw, 22px);
  border-radius: 18px;
}

.discord-builder-form .content-form-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.discord-builder-form .content-form-section-head strong {
  font-size: var(--font-size-base);
}

.discord-builder-form .content-form-section-head small {
  color: var(--text-muted);
  font-size: var(--font-size-meta);
}

.discord-builder-form .content-field,
.discord-builder-form .inline-check,
.discord-builder-form .discord-field-row,
.discord-builder-form .discord-autorole-card,
.discord-builder-form .discord-role-picker {
  min-width: 0;
}

.discord-builder-form .content-field > span:first-child {
  margin-bottom: 6px;
}

.discord-builder-form .input:not(textarea),
.discord-builder-form .select,
.discord-builder-form .modern-select,
.discord-color-picker {
  min-height: 46px;
}

.discord-builder-form .input:not(textarea),
.discord-builder-form .select,
.discord-builder-form .modern-select {
  width: 100%;
}

.discord-edit-grid,
.discord-builder-grid,
.discord-author-footer-grid,
.discord-footer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: clamp(12px, 1vw, 16px);
  min-width: 0;
}

.discord-send-layout {
  display: grid;
  gap: clamp(12px, 1vw, 16px);
}

.discord-send-controls {
  display: grid;
  grid-template-columns: minmax(220px, 1.35fr) 96px 160px auto;
  gap: clamp(10px, 0.9vw, 14px);
  align-items: end;
  padding-top: 0;
  border-top: 0;
}

.discord-channel-field {
  grid-column: 1 / 2;
}

.discord-color-picker-field {
  grid-column: 2 / 3;
}

.discord-color-code-field {
  grid-column: 3 / 4;
}

.discord-timestamp-check {
  grid-column: 4 / 5;
  min-height: 46px;
  padding-inline: 2px;
  align-self: center;
}

.discord-content-field--full,
.discord-message-link-field,
.discord-author-name-field {
  grid-column: 1 / -1;
}

.discord-message-link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-sm);
  align-items: stretch;
}

.discord-load-message-btn {
  min-width: 122px;
  min-height: 46px;
}

.discord-color-picker-field .discord-color-picker {
  inline-size: 100%;
  block-size: 46px;
  padding: 4px;
  border-radius: var(--control-radius);
}

.discord-color-code-field .input,
.discord-color-picker-field .discord-color-picker {
  font-family: var(--font-mono);
}

.discord-builder-textarea,
.discord-description-area {
  min-height: 160px;
}

.discord-description-area {
  min-height: 170px;
}

.discord-author-footer-grid {
  align-items: start;
}

.discord-footer-grid,
.discord-builder-grid,
.discord-author-footer-grid {
  grid-auto-rows: minmax(min-content, max-content);
}

.discord-field-editor {
  display: grid;
  gap: var(--space-sm);
}

.discord-field-row {
  display: grid;
  gap: var(--space-sm);
  padding: clamp(12px, 1vw, 16px);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface-sunken) 86%, transparent);
}

.discord-field-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.discord-add-field {
  justify-self: start;
}

.discord-autorole-toolbar {
  align-items: end;
}

.discord-autorole-toolbar .btn {
  min-height: var(--control-height);
}

.discord-autorole-card {
  gap: clamp(12px, 1vw, 16px);
  padding: clamp(14px, 1.1vw, 18px);
  border-radius: 16px;
}

.discord-autorole-card__head {
  align-items: start;
}

.discord-autorole-card__actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.discord-autorole-card__actions .btn {
  min-height: 40px;
}

.discord-autorole-grid {
  gap: clamp(12px, 1vw, 16px);
}

.discord-autorole-grid .content-field small {
  margin-top: 6px;
  display: block;
}

.discord-builder-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
  align-items: center;
  justify-content: flex-start;
  padding-top: var(--space-sm);
}

.discord-builder-actions .btn {
  min-height: 46px;
}

.discord-preview-panel {
  position: sticky;
  top: calc(var(--nav-space) + var(--space-xs));
}

@media (max-width: 1200px) {
  .discord-send-controls {
    grid-template-columns: minmax(0, 1fr) 100px 170px;
  }

  .discord-channel-field,
.discord-content-field--full {
    grid-column: 1 / -1;
  }

  .discord-timestamp-check {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@media (max-width: 1000px) {
  .discord-preview-panel {
    position: static;
  }
}

@media (max-width: 860px) {
  .discord-builder-head,
.discord-edit-grid,
.discord-builder-grid,
.discord-author-footer-grid,
.discord-footer-grid,
.discord-autorole-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-mode-pill {
    justify-self: start;
  }

  .discord-send-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .discord-channel-field,
.discord-color-code-field,
.discord-content-field--full,
.discord-message-link-field,
.discord-author-name-field,
.discord-timestamp-check {
    grid-column: 1 / -1;
  }

  .discord-color-picker-field {
    grid-column: auto;
  }
}

@media (max-width: 640px) {
  .discord-builder-form .content-form-section {
    padding: 14px;
    border-radius: 16px;
  }

  .discord-send-controls,
.discord-message-link-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-load-message-btn,
.discord-builder-actions .btn,
.discord-autorole-toolbar .btn {
    width: 100%;
  }

  .discord-autorole-card__actions {
    width: 100%;
    justify-content: stretch;
  }

  .discord-autorole-card__actions .btn {
    flex: 1 1 110px;
  }

  .discord-builder-titlebar,
.discord-preview-titlebar {
    align-items: flex-start;
    flex-direction: column;
  }
}


/* Embed editor density normalization — shared by general embeds, rules and autoroles. */
.discord-builder-form .content-form-section {
  padding: clamp(14px, 1.15vw, 18px);
}

.discord-builder-form .input:not(textarea),
.discord-builder-form .select,
.discord-builder-form .modern-select,
.discord-builder-form .discord-color-picker,
.discord-builder-form .btn {
  min-height: var(--control-height);
}

.discord-builder-form .content-field > span:first-child {
  margin-bottom: 4px;
  font-size: var(--font-size-ui);
  line-height: 1.2;
}

.discord-builder-form .content-field small,
.discord-builder-form .discord-limit-counter {
  line-height: 1.25;
}

.discord-builder-form .discord-builder-textarea {
  min-height: 124px;
}

.discord-builder-form .discord-description-area {
  min-height: 146px;
}

.discord-builder-form .discord-author-footer-grid,
.discord-builder-form .discord-footer-grid,
.discord-builder-form .discord-builder-grid,
.discord-builder-form .discord-autorole-grid {
  gap: var(--space-sm);
}

.discord-builder-form .discord-autorole-card,
.discord-builder-form .discord-field-row {
  padding: 12px;
}

.discord-builder-form .discord-builder-actions .btn {
  min-height: 44px;
}

@media (max-width: 640px) {
  .discord-builder-form .input:not(textarea),
.discord-builder-form .select,
.discord-builder-form .modern-select,
.discord-builder-form .btn {
    min-height: 44px;
  }
}

/* =========================================================
   DISCORD AUTOROLES
   Shared embed foundation + Discord component editor
   ========================================================= */
.discord-hub-card--autoroles {
  border-color: color-mix(in srgb, var(--c-success) 32%, var(--border-subtle));
}

.discord-autorole-editor {
  display: grid;
  gap: var(--space-md);
  min-width: 0;
}

.discord-autorole-toolbar,
.discord-autorole-card__head,
.discord-autorole-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.discord-autorole-toolbar > div {
  display: grid;
  gap: var(--space-3xs);
}

.discord-autorole-toolbar small,
.discord-autorole-card small {
  color: var(--text-muted);
}

.discord-autorole-list {
  display: grid;
  gap: var(--space-sm);
}

.discord-autorole-card {
  display: grid;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.discord-autorole-card__actions .btn {
  min-width: 0;
  padding-inline: 0.7rem;
}

.discord-autorole-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-sm);
  min-width: 0;
}

.discord-preview-components {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin-top: 8px;
}

.discord-preview-component-button {
  appearance: none;
  border: 0;
  border-radius: 4px;
  min-height: 32px;
  padding: 2px 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: inherit;
  font-weight: var(--font-weight-semibold);
  line-height: 1;
  color: #fff;
  cursor: default;
}

.discord-preview-component-button--1 { background: #5865f2; }
.discord-preview-component-button--2 { background: #4e5058; }
.discord-preview-component-button--3 { background: #248046; }
.discord-preview-component-button--4 { background: #da373c; }
.discord-preview-component-button.is-disabled { opacity: 0.5; }

@media (max-width: 760px) {
  .discord-autorole-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-autorole-toolbar,
.discord-autorole-card__head {
    align-items: stretch;
    flex-direction: column;
  }

  .discord-autorole-card__actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

/* =========================================================
   DISCORD HUB — responsive action dashboard
   Primary actions stay prominent; tools keep a balanced 3-up desktop row.
   ========================================================= */
.discord-hub-page {
  --discord-hub-gap: clamp(12px, 1.25vw, 18px);
}

.discord-hub-shell {
  gap: var(--discord-hub-gap);
}

.discord-dashboard-hero {
  align-items: stretch;
  gap: clamp(16px, 2vw, 24px);
  padding: clamp(18px, 2vw, 24px);
}

.discord-dashboard-hero .lead {
  max-width: 56ch;
}

.discord-dashboard-hero .hero-secure-note {
  margin-top: 12px;
}

.discord-dashboard-hero__side {
  align-content: stretch;
  gap: 10px;
}

.discord-dashboard-hero__side .guild-hero-summary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-xs);
}

.discord-dashboard-hero__side .guild-hero-summary__block {
  min-height: 78px;
  align-content: center;
  padding: 11px 13px;
}

.discord-dashboard-hero__side .guild-hero-summary__block strong,
.discord-dashboard-hero__side .guild-hero-summary__block p {
  overflow-wrap: anywhere;
}

.discord-dashboard-hero__side .guild-hero-stats {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-xs);
}

.discord-dashboard-hero__side .guild-hero-stat-card {
  min-height: 58px;
  align-content: center;
  padding: 9px 11px;
}

.discord-hub-sections {
  display: grid;
  gap: var(--discord-hub-gap);
  min-width: 0;
}

.discord-hub-section-group {
  display: grid;
  gap: var(--discord-hub-gap);
  min-width: 0;
  align-items: stretch;
}

.discord-hub-section-group--primary {
  grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
}

.discord-hub-section-group--tools {
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
}

.discord-hub-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 11px;
  min-width: 0;
  min-height: 214px;
  padding: clamp(16px, 1.4vw, 20px);
  color: inherit;
  text-decoration: none;
  overflow: hidden;
  transition: transform 160ms var(--ease-out),
    border-color 160ms var(--ease-out),
    background-color 160ms var(--ease-out);
}

.discord-hub-card--featured {
  min-height: 198px;
}

.discord-hub-card > .eyebrow {
  align-self: flex-start;
  max-width: 100%;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.discord-hub-card > strong {
  display: block;
  color: var(--text-strong);
  font-size: clamp(1rem, 1.1vw, 1.12rem);
  line-height: 1.3;
}

.discord-hub-card > p {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--font-size-body);
  line-height: 1.58;
  overflow-wrap: anywhere;
}

.discord-hub-card > .btn {
  width: 100%;
  min-height: 44px;
  margin-top: auto;
  padding-inline: 14px;
}

.discord-hub-card:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--c-accent-300) 72%, white 28%);
  outline-offset: 3px;
}

@media (hover: hover) and (pointer: fine) {
  .discord-hub-card:hover {
    transform: translateY(-2px);
    border-color: color-mix(in srgb, var(--c-accent-400) 36%, var(--border));
    background: color-mix(in srgb, var(--surface-raised) 92%, var(--c-accent-500) 8%);
  }
}

@media (max-width: 1080px) {
  .discord-hub-section-group--tools {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .discord-hub-section-group--tools > :last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }
}

@media (max-width: 860px) {
  .discord-dashboard-hero {
    grid-template-columns: minmax(0, 1fr);
    padding: 18px;
  }

  .discord-dashboard-hero__side .guild-hero-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .discord-hub-card,
.discord-hub-card--featured {
    min-height: 0;
  }
}

@media (max-width: 680px) {
  .discord-hub-page {
    --discord-hub-gap: 10px;
  }

  .discord-hub-shell {
    gap: 10px;
  }

  .discord-dashboard-hero {
    gap: 14px;
    padding: 15px;
    border-radius: var(--radius-lg);
  }

  .discord-dashboard-hero .content-hero-status-row {
    gap: 6px;
  }

  .discord-dashboard-hero .content-hero-path {
    font-size: var(--font-size-sm);
    line-height: var(--line-height-tight);
  }

  .discord-dashboard-hero h1 {
    font-size: clamp(1.45rem, 7vw, 1.8rem);
  }

  .discord-dashboard-hero .lead {
    font-size: 0.88rem;
    line-height: var(--line-height-body);
  }

  .discord-dashboard-hero .hero-secure-note {
    margin-top: 9px;
    font-size: var(--font-size-ui);
  }

  .discord-dashboard-hero__side {
    gap: var(--space-xs);
  }

  .discord-dashboard-hero__side .guild-hero-summary,
.discord-dashboard-hero__side .guild-hero-stats {
    gap: 7px;
  }

  .discord-dashboard-hero__side .guild-hero-summary__block {
    min-height: 70px;
    padding: 9px 10px;
  }

  .discord-dashboard-hero__side .guild-hero-stat-card {
    min-height: 54px;
    padding: 8px;
  }

  .discord-dashboard-hero__side .guild-hero-stat-card > strong {
    font-size: 0.95rem;
  }

  .discord-hub-section-group--primary,
.discord-hub-section-group--tools {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-hub-section-group--tools > :last-child:nth-child(odd) {
    grid-column: auto;
  }

  .discord-hub-card {
    gap: 9px;
    padding: 15px;
    border-radius: var(--radius-lg);
  }

  .discord-hub-card > .eyebrow {
    white-space: normal;
    text-overflow: clip;
  }

  .discord-hub-card > strong {
    font-size: var(--font-size-base);
  }

  .discord-hub-card > p {
    font-size: 0.86rem;
    line-height: 1.52;
  }

  .discord-hub-card > .btn {
    min-height: 46px;
    font-size: var(--font-size-body);
  }
}

@media (max-width: 430px) {
  .discord-dashboard-hero__side .guild-hero-summary {
    grid-template-columns: minmax(0, 1fr);
  }

  .discord-dashboard-hero__side .guild-hero-summary__block {
    min-height: 0;
  }

  .discord-dashboard-hero__side .guild-hero-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .discord-dashboard-hero__side .guild-hero-stat-card {
    min-width: 0;
  }

  .discord-dashboard-hero__side .guild-hero-stat-card > span {
    font-size: 0.56rem;
    letter-spacing: 0.08em;
  }
}

@media (prefers-reduced-motion: reduce) {
  .discord-hub-card {
    transition: none;
  }
}

/* Standalone guild agreement shares the full-viewport login background. */
body:has(.guild-agreement-screen) { padding: 0; background: #0c1734; }
body:has(.guild-agreement-screen) #site-starfield { display: none; }
.guild-agreement-screen {
  position: relative; isolation: isolate; width: 100%; max-width: none; margin: 0;
  padding: max(48px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) 48px max(24px, env(safe-area-inset-left));
  flex: 1 0 auto; min-height: 80svh; color: #f4ead6;
}
.guild-agreement-card {
  position: relative; z-index: 1; width: min(860px, 100%); margin: 0 auto;
  border: 1px solid #94743e; border-radius: 18px; padding: clamp(24px, 4vw, 52px);
  background: linear-gradient(145deg, rgba(24, 30, 47, .96), rgba(15, 20, 35, .97));
  box-shadow: 0 24px 80px #0008, inset 0 0 0 4px #d8b25e0a;
}
.guild-agreement-heading { text-align: center; padding-bottom: 28px; border-bottom: 1px solid #d8b25e33; }
.guild-agreement-kicker { color: #d8b25e; font-size: 12px; letter-spacing: .15em; text-transform: uppercase; }
.guild-agreement-heading h1 { margin: 12px 0; color: #f4dfae; font-size: clamp(28px, 4vw, 42px); line-height: 1.2; overflow-wrap: anywhere; }
.guild-agreement-heading p,
.guild-agreement-note { color: #bfc4d1; }
.guild-agreement-account { display: inline-block; margin-top: 12px; padding: 8px 14px; border-radius: 20px; background: #ffffff08; color: #d5d9e3; font-size: 13px; overflow-wrap: anywhere; }
.guild-agreement-text { padding-block: 28px; font-size: 16px; line-height: 1.8; overflow-wrap: anywhere; }
.guild-agreement-text > :first-child { margin-top: 0; }
.guild-agreement-text h2,
.guild-agreement-text h3,
.guild-agreement-text h4 { color: #e9c77f; margin-block: 26px 12px; line-height: 1.4; }
.guild-agreement-text p { margin-block: 12px; }
.guild-agreement-text ul,
.guild-agreement-text ol { padding-left: 24px; }
.guild-agreement-text ul { list-style: disc; }
.guild-agreement-text ol { list-style: decimal; }
.guild-agreement-text li { margin-block: 8px; }
.guild-agreement-text a { color: #e9c77f; text-decoration: underline; }
.guild-agreement-text blockquote { border-left: 3px solid #d8b25e; margin-inline: 0; padding: 4px 18px; background: #ffffff05; }
.guild-agreement-text pre { overflow-x: auto; padding: 16px; background: #0004; }
.guild-agreement-text table { display: block; overflow-x: auto; max-width: 100%; border-collapse: collapse; }
.guild-agreement-text th,
.guild-agreement-text td { padding: 8px; border: 1px solid #d8b25e33; }
.guild-agreement-form { border-top: 1px solid #d8b25e33; padding-top: 24px; }
.guild-agreement-check { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; font-size: 15px; line-height: 1.6; min-height: 44px; }
.guild-agreement-check input { flex: 0 0 22px; width: 22px; height: 22px; margin: 2px 0; accent-color: #d8b25e; }
.guild-agreement-actions { display: grid; grid-template-columns: .75fr 1fr; gap: 12px; align-items: center; max-width: 432px; margin: 24px auto 0; }
.guild-agreement-login,
.guild-agreement-submit { display: inline-flex; align-items: center; justify-content: center; text-align: center; border-radius: 8px; padding: 8px 12px; font-family: inherit; text-decoration: none; line-height: 1.3; }
.guild-agreement-login { min-height: 45px; font-size: 12px; color: #b7bcc9; border: 1px solid #9dabc52e; background: #ffffff04; }
.guild-agreement-submit { min-height: 60px; font-size: 16px; font-weight: 700; color: #fff1d2; background: linear-gradient(#a53023, #761810); border: 1px solid #d8b25e99; cursor: pointer; transition: background-color .2s, box-shadow .2s; }
.guild-agreement-submit:disabled { opacity: .5; cursor: default; }
.guild-agreement-submit:not(:disabled):hover { box-shadow: 0 0 18px #d8b25e33; }
.guild-agreement-login:hover { color: #f4ead6; background: #ffffff0c; }
.guild-agreement-login:focus-visible,
.guild-agreement-submit:focus-visible,
.guild-agreement-check input:focus-visible { outline: 2px solid #f4dfae; outline-offset: 4px; }
.guild-agreement-note { text-align: center; font-size: 12px; line-height: 1.6; margin: 18px 0 0; }
.guild-agreement-notice { padding: 16px; margin-block: 24px; border: 1px solid #d8b25e66; border-radius: 10px; background: #d8b25e0d; line-height: 1.7; }
.guild-agreement-success { border-top: 1px solid #d8b25e33; padding-top: 28px; text-align: center; }
.guild-agreement-success > span { color: #a7dcaf; font-size: 36px; }
.guild-agreement-success .guild-agreement-login,
.guild-agreement-unavailable .guild-agreement-login { width: 180px; margin-top: 12px; }
.guild-agreement-unavailable { text-align: center; color: #bfc4d1; }
body:has(.guild-agreement-screen) .app-footer--site-wide { position: relative; z-index: 1; margin-top: 0; background: #0c1734e8; }
@media (max-width: 640px) {
  .guild-agreement-screen { padding: max(20px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 24px max(12px, env(safe-area-inset-left)); }
  .guild-agreement-card { padding: 24px 18px; border-radius: 12px; }
  .guild-agreement-text { font-size: 15px; line-height: 1.75; }
  .guild-agreement-submit { font-size: 14px; }
  .guild-agreement-login { padding-inline: 8px; }
}
@media (prefers-reduced-motion: reduce) { .guild-agreement-submit { transition: none; } }
.guild-rules-editor-note { color: var(--text-muted); line-height: 1.6; }
.guild-rules-editor-preview { padding: 16px; border: 1px solid var(--border-subtle); border-radius: 12px; box-shadow: var(--shadow-sm); background: #0c1734; color: #f4ead6; }
.guild-rules-editor-preview summary { cursor: pointer; min-height: 44px; align-content: center; }
```

## src/app/styles/patterns.css

```css

/* =========================================================
   PATTERNS — структурні заглушки за суфіксом класу

   У дашборді ~1250 класів. Описувати кожен окремо означало б
   повернути той самий борг,
з якого ми щойно вийшли. Тому тут
   зібрані загальні правила за суфіксом імені: будь-який
   *-row поводиться як рядок, *-stack — як вертикальний стек,
*-meta — як приглушений підпис.

   Цей шар підключається ПІСЛЯ components.css і pages.css,
але
   свідомо тримає низьку специфічність (один клас або атрибут),
тож будь-яке іменне правило вище лишається сильнішим.
   Виняток — тільки там,
де без цього ламається розкладка.
   ========================================================= */

/* ---------- Рядки: зміст ліворуч,
дії праворуч ---------- */
[class$="-row"]:not(:where([role="row"])),
[class*="-row "]:not(:where([role="row"])),
[class$="__row"],
[class*="__row "],
[class$="-bar"],
[class*="-bar "],
[class$="__bar"],
[class*="__bar "],
[class$="-toolbar"],
[class*="-toolbar "],
[class$="-links"],
[class*="-links "],
[class$="-badges"],
[class*="-badges "],
[class$="-pills"],
[class*="-pills "],
[class$="__pills"],
[class*="__pills "] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

/* ---------- Вертикальні стеки ---------- */
[class$="-stack"],
[class*="-stack "],
[class$="__stack"],
[class*="__stack "],
[class$="-column"],
[class*="-column "],
[class$="__column"],
[class*="__column "],
[class$="-body"],
[class*="-body "],
[class$="__body"],
[class*="__body "],
[class$="-copy"],
[class*="-copy "],
[class$="__copy"],
[class*="__copy "],
[class$="-content"]:not(:where(.discord-preview-content)),
[class*="-content "]:not(:where(.discord-preview-content)),
[class$="__content"],
[class*="__content "],
[class$="-main"],
[class*="-main "],
[class$="__main"],
[class*="__main "],
[class$="-identity"],
[class*="-identity "],
[class$="__identity"],
[class*="__identity "],
[class$="-summary"]:not(:where(summary)),
[class*="-summary "]:not(:where(summary)),
[class$="__summary"],
[class*="__summary "],
[class$="-details"]:not(:where(details)),
[class*="-details "]:not(:where(details)),
[class$="-steps"],
[class*="-steps "],
[class$="-group"],
[class*="-group "],
[class$="__group"],
[class*="__group "],
[class$="-groups"],
[class*="-groups "] {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

/* ---------- Сторінкові контейнери ---------- */
[class$="-page"],
[class*="-page "],
[class$="-container"]:not(:where(.container)),
[class*="-container "]:not(:where(.container)),
[class$="-shell"]:not(:where(.discord-builder-shell)),
[class*="-shell "]:not(:where(.discord-builder-shell)) {
  min-width: 0;
}

/* ---------- Форми ---------- */
[class$="-form"]:not(:where(.roster-inline-form)),
[class*="-form "]:not(:where(.roster-inline-form)),
[class$="__form"],
[class*="__form "] {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}

/* Форма-обгортка навколо однієї кнопки не має розтягуватись */
[class$="-action-form"],
[class*="-action-form "],
[class$="-button-form"],
[class*="-button-form "],
[class$="-bulk-form"],
[class*="-bulk-form "] {
  display: inline-grid;
  gap: var(--space-2xs);
}

/* ---------- Дрібний службовий текст ---------- */
[class$="-meta"],
[class*="-meta "],
[class$="__meta"],
[class*="__meta "],
[class$="-hint"],
[class*="-hint "],
[class$="__hint"],
[class*="__hint "],
[class$="-status"],
[class*="-status "],
[class$="__status"],
[class*="__status "],
[class$="-caption"],
[class*="-caption "],
[class$="-placeholder"],
[class*="-placeholder "],
[class$="-counter"],
[class*="-counter "],
[class$="__counter"],
[class*="__counter "],
[class$="-order"],
[class*="-order "] {
  color: var(--text-muted);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-body);
}

/* ---------- Заголовки блоків ---------- */
.section-title,
[class$="-title"]:not(:where(.discord-preview-title)),
[class*="-title "]:not(:where(.discord-preview-title)),
[class$="__title"]:not(:where(.app-footer__title)),
[class*="__title "]:not(:where(.app-footer__title)),
[class$="-label"]:not(:where(.field-label)),
[class*="-label "]:not(:where(.field-label)),
[class$="__label"],
[class*="__label "] {
  color: var(--text-strong);
  font-weight: var(--font-weight-bold);
  min-width: 0;
}

[class$="-label"]:not(:where(.field-label)),
[class*="-label "]:not(:where(.field-label)),
[class$="__label"],
[class*="__label "] {
  font-size: var(--font-size-ui-lg);
  letter-spacing: 0.02em;
}

[class$="-header"],
[class*="-header "],
[class$="__header"],
[class*="__header "] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  min-width: 0;
}

/* ---------- Виділені врізки ---------- */
[class$="-callout"],
[class*="-callout "],
[class$="-banner"],
[class*="-banner "],
[class$="-warning"]:not(:where(.warning-note)),
[class*="-warning "]:not(:where(.warning-note)) {
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--c-accent-400);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-soft);
  font-size: 0.85rem;
  line-height: var(--line-height-relaxed);
}

/* ---------- Варіанти вибору: радіо-картки ---------- */
[class$="-option"]:not(:where(option)),
[class*="-option "]:not(:where(option)),
[class$="__option"],
[class*="__option "] {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 40px;
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-size: 0.84rem;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

[class$="-option"]:hover,
[class*="-option "]:hover,
[class$="__option"]:hover,
[class*="__option "]:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

[class$="-option"].is-selected,
[class*="-option "].is-selected,
[class$="-option"].is-active,
[class*="-option "].is-active,
[class$="__option"].is-selected,
[class*="__option "].is-selected {
  border-color: var(--border-strong);
  background: var(--accent-soft);
  color: var(--c-accent-200);
}

/* ---------- Дії та кнопки без класу .btn ---------- */
[class$="-action"]:not(:where(.raid-action)):not(:where([class*="raid-action--"])),
[class*="-action "]:not(:where(.raid-action)):not(:where([class*="raid-action--"])),
[class$="__action"],
[class*="__action "],
[class$="-button"]:not(:where(.btn)),
[class*="-button "]:not(:where(.btn)),
[class$="__button"],
[class*="__button "] {
  min-width: 0;
}

/* ---------- Роздільники ---------- */
[class$="-divider"],
[class*="-divider "],
[class$="__divider"],
[class*="__divider "],
[class$="-separator"]:not(:where(.app-footer__link-separator)):not(:where(.discord-preview-footer-separator)),
[class*="-separator "]:not(:where(.app-footer__link-separator)):not(:where(.discord-preview-footer-separator)) {
  width: 100%;
  height: 1px;
  border: 0;
  background: var(--border-subtle);
}

/* ---------- Крапка-індикатор ---------- */
[class$="-dot"]:not(:where(.discord-role-dot)),
[class*="-dot "]:not(:where(.discord-role-dot)) {
  display: inline-block;
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--tone, var(--c-ink-400));
}

/* ---------- Посилання всередині блоків ---------- */
[class$="-link"]:not(:where(.discord-preview-link)),
[class*="-link "]:not(:where(.discord-preview-link)) {
  color: var(--c-accent-300);
}

/* ---------- Підвал блоку ---------- */
[class$="-footer"]:not(:where(.app-footer)),
[class*="-footer "]:not(:where(.app-footer)),
[class$="__footer"],
[class*="__footer "] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

/* ---------- Пошук ---------- */
[class$="-search"],
[class*="-search "],
[class$="__search"],
[class*="__search "] {
  display: block;
  min-width: 0;
}

/* ---------- Секції всередині сторінки ---------- */
[class$="-section"]:not(:where([class*="form-section"])),
[class*="-section "]:not(:where([class*="form-section"])),
[class$="__section"],
[class*="__section "] {
  display: grid;
  gap: var(--gap-stack);
  min-width: 0;
}

/* ---------- Елементи списків ---------- */
[class$="-item"]:not(:where(.dashboard-list-row)),
[class*="-item "]:not(:where(.dashboard-list-row)),
[class$="__item"]:not(:where(.dashboard-nav-measure__item)),
[class*="__item "]:not(:where(.dashboard-nav-measure__item)) {
  min-width: 0;
}

/* ---------- Нічого не має вилазити за межі екрана ---------- */
[class*="-page"],
[class*="-shell"],
[class*="-panel"],
[class*="-card"] {
  max-width: 100%;
}
```

## src/app/styles/polls.css

```css
/* =========================================================
   POLLS — рейд-пули: голосування за день і час

   Останній домен без власних правил. Сторінка показує сітку
   днів із розподілом голосів, рекомендовані слоти та стан
   синхронізації з Discord.

   Порядок: список → деталі → дні → рекомендації → синхронізація
   → адаптив. Жодного !important.
   ========================================================= */

/* =========================================================
   1. СПИСОК ПУЛІВ
   ========================================================= */

/* Вкладки станів пулу */

/* =========================================================
   2. ДЕТАЛІ ПУЛУ
   ========================================================= */

/* Призупинений пул приглушений, як закритий рейд */

/* =========================================================
   3. СІТКА ДНІВ
   ========================================================= */
/* Панель матриці — звичайний стек: заголовок зверху, сітка днів під ним.
   Раніше grid-template-columns стояв на самій панелі, і на ПК заголовок
   із сіткою ставали двома сусідніми колонками. */

/* Смуга голосів дня */

/* «Можуть» і «не можуть» — дві пігулки з різними тонами */

/* Слоти часу: список із заповненням */

/* Слот години: смуга-заливка лежить під текстом (z-index: -1 у власному
   стековому контексті), тому цифри лишаються поверх неї. */

/* Час, за який хтось проголосував, підсвічений */

/* Учасник у клітинці дня: нік → крапка ролі → роль → час */

/* =========================================================
   4. РЕКОМЕНДАЦІЇ
   ========================================================= */

/* Найкращий слот — виділений блок над списком решти */

/* Номер приходить з розмітки (<b>), а не з CSS-лічильника. Раніше було
   і те, й інше: у рядку опинялось три елементи замість двох, текст
   зривався на другий рядок, а поруч із кружечком висіла гола цифра. */

/* Порожній стан не має номера — текст займає весь рядок */

/* =========================================================
   5. СИНХРОНІЗАЦІЯ Й ГОЛОСИ
   ========================================================= */

/* =========================================================
   6. АДАПТИВ
   ========================================================= */

/* =========================================================
   7. ХЕРО ТА КЛЮЧОВІ ПОКАЗНИКИ

   Базову панель хера дає layout.css через [class$="-hero"].
   Тут — тільки те, чого немає в загальному шарі: стрічка метрик
   і eyebrow. Жодних дублів рамки чи фону.
   ========================================================= */
.poll-hero__eyebrow {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--c-accent-300);
}

/* Суфікс __stats не покривається загальним шаром (там тільки -stats),
   тому сітку задаємо явно. */
.poll-hero__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: var(--space-sm);
  margin: 0;
  min-width: 0;
}

.poll-hero__stats > div {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.poll-hero__stats dt {
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.poll-hero__stats dd {
  margin: 0;
  font-size: 1.05rem;
  font-weight: var(--font-weight-bold);
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

/* =========================================================
   8. ВКЛАДКИ Й ПОШУК У СПИСКУ
   ========================================================= */

/* =========================================================
   9. КАРТКА ПУЛУ У СПИСКУ

   Сітка замість flex-переносу: смужка стану → чекбокс → зміст →
   показники → дії. На вузьких екранах усе схлопується в стек,
   а смужка стає горизонтальною лінією зверху.
   ========================================================= */

/* Без чекбокса (немає прав на керування) колонка вибору не потрібна */

/* =========================================================
   10. ПАНЕЛЬ КЕРУВАННЯ НА СТОРІНЦІ ПУЛУ
   ========================================================= */

/* =========================================================
   11. РОЛЬ ГОЛОСУ

   Пул більше не знає класів WoW, тому єдиний колірний код —
   роль: танк / хіл / дд. Токени вже є в tokens.css.
   ========================================================= */

/* =========================================================
   12. СПИСОК ГОЛОСІВ
   ========================================================= */

/* =========================================================
   13. АДАПТИВ ДЛЯ НОВИХ БЛОКІВ

   Мобільний — не «стиснутий десктоп»: картка й панель керування
   повністю перебудовуються в стек, смужка стану переїжджає нагору.
   ========================================================= */

@media (max-width: 860px) {

  /* Вертикальна смужка стану на вузькому екрані читається погано —
     робимо її горизонтальною лінією над карткою */

  .poll-hero__stats {
    grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr));
  }
}

@media (max-width: 520px) {

  .poll-hero__stats {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Опис у списку на телефоні з'їдає весь екран — лишаємо один рядок */
}

/* Головна дія в картці списку виділяється серед іконкових кнопок */
.poll-card__primary {
  font-weight: var(--font-weight-medium);
}

/* =========================================================
   14. СТВОРЕННЯ / РЕДАГУВАННЯ ПУЛУ

   Форма йде одним вертикальним потоком: назва → складність →
   таймер → режим публікації → канал → дні → ролі → розклад/автоповтор → опис → підсумок.
   Горизонтальні сітки в секціях форми навмисно не використовуємо —
   вони змушують стрибати очима і ламаються на планшеті.
   ========================================================= */
.raid-poll-create-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
  min-width: 0;
}

.raid-poll-create-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
}

.raid-poll-create-head h2 {
  margin: var(--space-3xs) 0 0;
}

.raid-poll-create-head p {
  margin: var(--space-2xs) 0 0;
  max-width: 62ch;
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: var(--line-height-copy);
}

/* Вертикальний потік замість auto-fit сітки із загального шару */
.raid-poll-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-lg);
  min-width: 0;
}

.raid-poll-field > span,
.raid-poll-field > legend {
  font-size: var(--font-size-ui);
  font-weight: var(--font-weight-medium);
  color: var(--text-strong);
}

.raid-poll-field > small {
  color: var(--text-faint);
  font-size: 0.74rem;
  line-height: var(--line-height-body);
}

/* Складність і таймер — єдина пара, яку логічно тримати поруч:
   два коротких select-и, що читаються як одне рішення */
.raid-poll-field--pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--space-md);
}

.raid-poll-days-field,
.raid-poll-roles-field,
.raid-poll-publication-card,
.raid-poll-repeat-card,
.raid-poll-muted-box {
  display: grid;
  gap: var(--space-sm);
  padding: var(--pad-card-compact);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.raid-poll-repeat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
  gap: var(--space-md);
}

.raid-poll-publication-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-xs);
}

.raid-poll-publication-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-height: 64px;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.raid-poll-publication-option:hover {
  border-color: var(--border-strong);
}

.raid-poll-publication-option.is-selected {
  border-color: color-mix(in srgb, var(--c-accent-400) 72%, var(--border));
  background: color-mix(in srgb, var(--c-accent-400) 11%, var(--surface-raised));
}

.raid-poll-publication-option input {
  margin-top: 0.2rem;
}

.raid-poll-publication-option > span,
.raid-poll-publication-fixed {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.raid-poll-publication-option strong,
.raid-poll-publication-fixed strong {
  color: var(--text-strong);
  font-size: 0.86rem;
}

.raid-poll-publication-option small,
.raid-poll-publication-fixed span {
  color: var(--text-muted);
  font-size: var(--font-size-meta);
  line-height: var(--line-height-body);
}

.raid-poll-publication-fixed {
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

/* Вимкнений автоповтор приглушується, але лишається читабельним */
.raid-poll-repeat-grid[aria-disabled="true"] {
  opacity: 0.55;
}

.raid-poll-muted-box strong {
  font-size: var(--font-size-body-sm);
  color: var(--text-soft);
}

.raid-poll-create-preview {
  border-left: 3px solid var(--c-accent-400);
}

.raid-poll-create-preview > div {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.raid-poll-create-preview strong {
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.raid-poll-create-preview span {
  color: var(--text-soft);
  font-size: var(--font-size-body-sm);
  line-height: var(--line-height-body);
  overflow-wrap: anywhere;
}

.raid-poll-create-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
}

.raid-poll-create-alert {
  margin: 0;
}

/* Бічна довідка */
.raid-poll-help-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  position: sticky;
  top: calc(var(--nav-space) + var(--space-md));
}

.raid-poll-help-card h2 {
  margin: var(--space-3xs) 0 0;
  font-size: 1.05rem;
}

.raid-poll-help-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-size-body-sm);
  line-height: var(--line-height-copy);
}

.raid-poll-help-steps {
  display: grid;
  gap: var(--space-xs);
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: poll-help;
}

.raid-poll-help-steps li {
  counter-increment: poll-help;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: start;
  gap: var(--space-xs);
  color: var(--text-soft);
  font-size: var(--font-size-ui-lg);
  line-height: var(--line-height-body);
}

.raid-poll-help-steps li::before {
  content: counter(poll-help);
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--surface-raised);
  color: var(--c-accent-200);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-bold);
}

.raid-poll-help-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

/* =========================================================
   15. ЗВЕДЕННЯ РОЛЕЙ ТА СМУГИ ГОДИН
   ========================================================= */

@media (max-width: 1000px) {
  .raid-poll-help-card {
    position: static;
  }
}

@media (max-width: 640px) {
  .raid-poll-create-head {
    flex-direction: column;
  }

  .raid-poll-create-actions {
    justify-content: stretch;
  }

  .raid-poll-create-actions > * {
    flex: 1 1 auto;
    text-align: center;
  }
}

/* Пресети днів: «увесь тиждень / будні / вихідні» замість семи кліків */
.raid-poll-day-presets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.raid-poll-day-presets .btn {
  min-height: 32px;
  padding-inline: var(--space-sm);
  font-size: var(--font-size-meta);
}

@media (max-width: 640px) {
  .raid-poll-publication-options {
    grid-template-columns: minmax(0, 1fr);
    gap: 7px;
  }

  .raid-poll-publication-option {
    min-height: 54px;
    padding: 8px 10px;
  }
}
```

## src/app/styles/raids.css

```css
/* =========================================================
   RAIDS — список, сторінка рейду, створення й редагування

   Один шар на весь рейдовий домен: раніше ці правила були
   розсипані по pages.css і патернах, через що картка рейду
   й форма отримували випадкову геометрію.

   Мова та сама, що на сайті: тепла нічна поверхня, бурштиновий
   акцент, пігулки станів. Жодного !important.
   ========================================================= */

/* =========================================================
   1. ОБОЛОНКА Й HERO
   ========================================================= */
.raid-shell {
  display: flex;
  flex-direction: column;
  gap: var(--gap-grid);
  min-width: 0;
}

/* =========================================================
   2. СПИСОК РЕЙДІВ
   ========================================================= */
.raid-list-page-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
}

.raid-list-page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
}

.raid-list-page-head > div:first-child {
  display: grid;
  gap: var(--space-2xs);
  min-width: 0;
}

.raid-list-page-head h2 {
  margin: 0;
}

.raid-list-page-head p {
  margin: 0;
  max-width: 68ch;
  color: var(--text-soft);
  font-size: var(--font-size-body);
}

/* Лічильники — рядок пігулок, а не стовпчик */
.raid-list-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  margin-top: var(--space-2xs);
}

.raid-list-summary > span {
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* ---------- Рядок рейду ---------- */

.raid-empty {
  margin: 0;
  padding: var(--space-xl) var(--space-md);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-muted);
  text-align: center;
}

/* =========================================================
   3. СТОРІНКА РЕЙДУ
   ========================================================= */

.raid-preview-column {
  display: grid;
  gap: var(--gap-stack);
  min-width: 0;
}

/* ---------- Картка оголошення ---------- */
.raid-preview-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
  overflow: hidden;
  min-width: 0;
}

/* Бурштинова грань зліва — як у Discord-ембеда */
.raid-preview-accent {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--accent-gradient);
  pointer-events: none;
}

.raid-preview-card.is-closed .raid-preview-accent {
  background: var(--c-ink-500);
}

.raid-preview-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-md);
  align-items: start;
}

.raid-preview-head > img {
  width: 74px;
  height: 74px;
  border-radius: var(--radius-md);
  object-fit: cover;
  border: 1px solid var(--border);
  background: var(--surface-sunken);
}

.raid-preview-head > div {
  display: grid;
  gap: var(--space-sm);
  min-width: 0;
}

.raid-preview-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
}

.raid-preview-title-row h2 {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.raid-description-markdown {
  display: grid;
  gap: var(--space-xs);
  color: var(--text-soft);
  font-size: 0.92rem;
  line-height: 1.62;
  overflow-wrap: anywhere;
}

.raid-closed-banner {
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--c-ink-400);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* ---------- Метадані рейду ---------- */
.raid-preview-meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  gap: var(--space-sm);
}

.raid-preview-meta > span {
  display: grid;
  gap: var(--space-3xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  color: var(--text-body);
  font-size: 0.88rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.raid-preview-meta > span > strong {
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.raid-preview-meta > span > small {
  font-size: var(--font-size-sm);
  color: var(--text-muted);
}

/* ---------- Врізки з правилами ---------- */
.raid-ilvl-notice {
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--c-accent-400);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
  color: var(--c-accent-100);
  font-size: 0.85rem;
  line-height: var(--line-height-relaxed);
}

.raid-ilvl-notice.is-warning {
  border-left-color: var(--c-warning);
  border-color: var(--tint-warning-border);
  background: var(--tint-warning-bg);
  color: var(--text-on-warning);
}

.raid-ilvl-notice.is-blocked {
  border-left-color: var(--c-danger);
  border-color: var(--tint-danger-border);
  background: var(--tint-danger-bg);
  color: var(--text-on-danger);
}

/* ---------- Кнопки відповіді ---------- */
.raid-preview-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.raid-preview-buttons.is-disabled {
  opacity: 0.55;
  pointer-events: none;
}

.raid-preview-buttons.is-submitting {
  opacity: 0.7;
  pointer-events: none;
}

.raid-action {
  --tone: var(--c-ink-400);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-height: var(--control-height);
  padding: 0 var(--space-md);
  border: 1px solid color-mix(in srgb, var(--tone) 34%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--tone) 12%, transparent);
  color: var(--tone);
  font-family: inherit;
  font-size: 0.84rem;
  font-weight: var(--font-weight-medium);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.raid-action:hover {
  background: color-mix(in srgb, var(--tone) 20%, transparent);
  transform: translateY(-2px);
}

.raid-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.raid-action--go {
  --tone: var(--c-success);
}

.raid-action--maybe {
  --tone: var(--c-warning);
}

.raid-action--skip {
  --tone: var(--c-danger);
}

.raid-action--late {
  --tone: var(--c-info);
}

.raid-checkbox-line {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-height: 40px;
  color: var(--text-soft);
  font-size: 0.86rem;
  cursor: pointer;
}

/* ---------- Склад рейду ---------- */
.raid-preview-roster-head {
  display: grid;
  gap: var(--space-2xs);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
}

.raid-preview-roster-head strong {
  color: var(--text-strong);
}

.raid-preview-roster-head p {
  margin: 0;
  max-width: 80ch;
  color: var(--text-muted);
  font-size: var(--font-size-body-sm);
  line-height: var(--line-height-relaxed);
}

/* Явна одна колонка: інакше суфіксні патерни *-grid / *-layout
   ставлять auto-fit, і лава запасних виїжджає збоку від паті. */
.raid-party-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-md);
  min-width: 0;
}

.raid-party-card {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.raid-party-card h3 {
  margin: 0 0 var(--space-2xs);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--c-accent-300);
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
}

.raid-bench-card {
  border-style: dashed;
}

/* ---------- Рядок учасника ---------- */
.raid-party-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-xs);
  border: 1px solid transparent;
  border-left: 3px solid var(--c-ink-500);
  border-radius: var(--radius-sm);
  background: var(--surface);
  min-width: 0;
}

.raid-party-row--tank {
  border-left-color: var(--c-role-tank);
}

.raid-party-row--healer {
  border-left-color: var(--c-role-healer);
}

.raid-party-row--dps {
  border-left-color: var(--c-role-dps);
}

.raid-party-row.is-late {
  border-color: rgba(232, 179, 74, 0.3);
}

.raid-party-row.is-undergeared {
  background: var(--tint-warning-bg);
}

.raid-party-row.is-blocked {
  border-color: rgba(224, 112, 95, 0.3);
  background: rgba(224, 112, 95, 0.1);
}

.raid-party-row.is-non-guild {
  opacity: 0.82;
}

.raid-party-member-copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.raid-party-member-copy strong {
  font-size: 0.86rem;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.raid-party-member-copy small {
  font-size: var(--font-size-sm);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.raid-ilvl-warning {
  color: var(--c-warning);
}

.raid-signup-side {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3xs);
  flex: 0 0 auto;
}

.raid-role-icon,
.raid-roster-role-icon {
  font-size: var(--font-size-body);
  line-height: 1;
}

.raid-signup-avatar {
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  border-radius: var(--radius-sm);
  object-fit: cover;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
}

.raid-signup-avatar--empty {
  display: grid;
  place-items: center;
  border-style: dashed;
  color: var(--text-faint);
  font-size: var(--font-size-ui-lg);
}

.raid-signup-order {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--space-3xs);
  border-radius: var(--radius-pill);
  background: var(--surface-raised);
  color: var(--text-faint);
  font-size: 0.62rem;
  font-weight: var(--font-weight-bold);
}

.raid-signup-order--empty {
  opacity: 0.4;
}

/* ---------- Бічний список «хто йде» ---------- */

/* =========================================================
   4. СТВОРЕННЯ Й РЕДАГУВАННЯ
   ========================================================= */
.raid-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.32fr) minmax(360px, 0.68fr);
  gap: clamp(var(--space-md), 2.2vw, var(--space-xl));
  align-items: start;
  min-width: 0;
}

.raid-editor-layout > .raid-preview-column {
  position: sticky;
  top: 92px;
  align-self: start;
  max-height: calc(100vh - 112px);
  overflow: auto;
  scrollbar-gutter: stable;
  padding-right: 2px;
}

.raid-form-stack {
  display: grid;
  gap: var(--gap-grid);
  min-width: 0;
}

.raid-form-panel {
  display: flex;
  flex-direction: column;
  gap: var(--gap-stack);
  min-width: 0;
}

.raid-form-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-md);
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
}

.raid-form-heading > div:first-child {
  display: grid;
  gap: var(--space-xs);
  flex: 1 1 460px;
  min-width: 0;
}

.raid-form-heading .section-title {
  font-family: var(--font-brand);
  font-size: 1.14rem;
  font-weight: var(--font-weight-display);
  letter-spacing: 0.035em;
  color: var(--text-strong);
}

.raid-form-heading p {
  margin: 0;
  max-width: 72ch;
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: var(--line-height-relaxed);
}

.raid-form-heading-status {
  display: grid;
  justify-items: end;
  gap: var(--space-2xs);
  flex: 0 1 230px;
  min-width: 0;
}

.raid-form-heading-status small {
  color: var(--text-faint);
  font-size: var(--font-size-caption);
  text-align: right;
}

.raid-editor-jump-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
  margin-top: var(--space-2xs);
}

.raid-editor-jump-nav a {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.raid-editor-jump-nav a:hover,
.raid-editor-jump-nav a:focus-visible {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  color: var(--c-accent-200);
}

/* Секція — окрема логічна сходинка форми, а не суцільний список полів. */
.raid-form-section {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-md);
  padding: clamp(var(--space-md), 1.6vw, var(--space-lg));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-sunken) 86%, transparent);
  min-width: 0;
  scroll-margin-top: 112px;
}

.raid-form-section-heading {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-sm);
  align-items: start;
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
}

.raid-form-section-heading > div {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.raid-form-section-heading strong,
.raid-publish-panel__copy strong {
  color: var(--text-strong);
  font-size: 0.92rem;
  font-weight: var(--font-weight-display);
}

.raid-form-section-heading p,
.raid-publish-panel__copy p {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-body);
}

.raid-form-step {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(235, 146, 65, 0.34);
  border-radius: var(--control-radius);
  background: var(--accent-soft);
  color: var(--c-accent-200);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
  letter-spacing: 0.04em;
}

.raid-field--wide,
.raid-form-section > .raid-image-picker,
.raid-form-section > .raid-discord-role-block,
.raid-form-section > .raid-auto-composition-note {
  grid-column: 1 / -1;
}

/* Підпис поля: текст згори, контрол знизу. */
.field-label {
  display: grid;
  align-content: start;
  gap: var(--space-xs);
  min-width: 0;
  font-size: 0.79rem;
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.015em;
  color: var(--text-soft);
}

.field-label > small {
  font-size: 0.73rem;
  font-weight: 400;
  letter-spacing: 0;
  line-height: var(--line-height-body);
  color: var(--text-muted);
}

.raid-form-section .input,
.raid-form-section .select {
  width: 100%;
}

.raid-form-section--rules {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
}

.raid-setting-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-width: 0;
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.raid-setting-card__head {
  display: grid;
  gap: var(--space-3xs);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--border-subtle);
}

.raid-setting-card__head strong {
  color: var(--text-strong);
  font-size: 0.84rem;
}

.raid-setting-card__head span {
  color: var(--text-faint);
  font-size: var(--font-size-caption);
}

.raid-setting-card .raid-checkbox-line {
  margin-top: auto;
}

.raid-checkbox-line {
  min-width: 0;
}

.raid-checkbox-line > span {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.raid-checkbox-line > span > strong {
  color: var(--text-soft);
  font-size: var(--font-size-ui);
}

.raid-checkbox-line > span > small {
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  line-height: 1.4;
}

.raid-checkbox-line--primary {
  align-items: flex-start;
  padding: var(--space-xs) 0;
}

.raid-dependent-control[data-enabled="false"],
.raid-dependent-field[data-enabled="false"] {
  opacity: 0.5;
}

.raid-dependent-control[data-enabled="false"] {
  cursor: not-allowed;
}

.raid-dependent-field[data-enabled="false"] .select {
  cursor: not-allowed;
}

.raid-setting-status {
  display: block;
  margin-top: auto;
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-compact);
}

.raid-auto-composition-note {
  display: grid;
  gap: var(--space-2xs);
  padding: var(--space-md);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid var(--c-accent-400);
  border-radius: var(--radius-md);
  background: var(--accent-soft);
}

.raid-auto-composition-note strong {
  color: var(--c-accent-200);
  font-size: 0.84rem;
}

.raid-auto-composition-note span {
  color: var(--text-soft);
  font-size: var(--font-size-ui);
  line-height: var(--line-height-relaxed);
}

.raid-form-section--discord {
  align-items: start;
}

.raid-discord-role-block {
  display: grid;
  gap: var(--space-xs);
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}

.raid-discord-role-block__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 10px;
}

.raid-discord-role-block__head strong {
  color: var(--text-strong);
  font-size: var(--font-size-body-sm);
}

.raid-discord-role-block__head span {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}

.raid-description-textarea {
  min-height: 210px;
  resize: vertical;
}

.raid-form-hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

/* ---------- Вибір зображення ---------- */
.raid-image-picker {
  display: grid;
  gap: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
}

.raid-image-picker__input-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  align-items: center;
}

.raid-image-picker__input-row .input {
  flex: 1 1 240px;
}

.raid-image-picker__refresh {
  flex: 0 0 auto;
}

.raid-image-picker__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(132px, 100%), 1fr));
  gap: var(--space-sm);
  max-height: 340px;
  overflow-y: auto;
  padding: var(--space-xs);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.raid-image-picker__grid img,
.raid-image-picker__preview img {
  width: 100%;
  height: 88px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.raid-image-picker__grid img:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
}

.raid-image-picker__selected img,
.raid-image-picker__grid .is-selected img {
  border-color: var(--c-accent-400);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.raid-image-picker__preview {
  display: grid;
  gap: var(--space-2xs);
  max-width: 260px;
}

.raid-image-picker__meta,
.raid-image-picker__empty {
  color: var(--text-muted);
  font-size: var(--font-size-meta);
}

.raid-image-picker__error {
  color: var(--c-danger);
  font-size: var(--font-size-ui);
}

/* ---------- Фінальна дія ---------- */
.raid-publish-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-md) var(--space-lg);
  align-items: center;
  padding: clamp(var(--space-md), 1.6vw, var(--space-lg));
  border: 1px solid rgba(235, 146, 65, 0.3);
  border-radius: var(--radius-lg);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent-soft) 74%, var(--surface-raised)),
    var(--surface-raised)
  );
  scroll-margin-top: 112px;
}

.raid-publish-panel__copy {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-sm);
  align-items: start;
  min-width: 0;
}

.raid-publish-panel__copy > div {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.raid-save-state {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-top: var(--space-2xs);
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: var(--font-size-caption);
  font-weight: var(--font-weight-semibold);
}

.raid-form-panel.is-dirty .raid-save-state {
  border-color: var(--tint-warning-border);
  background: var(--tint-warning-bg);
  color: var(--text-on-warning);
}

.raid-form-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
  min-width: min(100%, 360px);
}

.raid-form-actions .btn {
  flex: 1 1 160px;
  min-width: 0;
}

.raid-publication-recovery {
  grid-column: 1 / -1;
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.raid-publication-recovery p {
  margin: 0;
}

.raid-publication-recovery input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.raid-publish-panel__warning {
  grid-column: 1 / -1;
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--tint-warning-border);
  border-radius: var(--radius-sm);
  background: var(--tint-warning-bg);
  color: var(--text-on-warning);
  font-size: 0.74rem;
}

.raid-form-links {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
}

.raid-message-link {
  color: var(--c-accent-300);
  font-size: var(--font-size-body-sm);
  font-weight: var(--font-weight-semibold);
}

/* Небезпечна зона — візуально відділена від звичайного збереження. */
.raid-form-danger-zone {
  display: grid;
  gap: var(--space-xs);
  justify-items: start;
  border-color: var(--tint-danger-border);
  border-left: 3px solid var(--c-danger);
}

.raid-form-danger-zone strong {
  color: var(--text-on-danger);
  font-size: 0.95rem;
}

.raid-form-danger-zone p {
  margin: 0;
  max-width: 72ch;
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: var(--line-height-relaxed);
}

/* =========================================================
   5. АДАПТИВ
   ========================================================= */
@media (max-width: 1180px) {
  .raid-editor-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .raid-editor-layout > .raid-preview-column {
    position: static;
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }
}

@media (max-width: 1000px) {

  .raid-form-section--rules {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .raid-setting-card--deadline {
    grid-column: 1 / -1;
  }
}

@media (max-width: 860px) {

  /* Дії — окремий рядок під карткою на всю ширину */

  .raid-preview-head {
    grid-template-columns: minmax(0, 1fr);
  }

  .raid-preview-head > img {
    width: 56px;
    height: 56px;
  }

  .raid-preview-meta {
    grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  }

  .raid-preview-buttons .raid-action {
    flex: 1 1 auto;
    justify-content: center;
  }

  .raid-form-section,
.raid-form-section--rules {
    grid-template-columns: minmax(0, 1fr);
    padding: var(--space-md);
  }

  .raid-setting-card--deadline {
    grid-column: auto;
  }

  .raid-field--wide,
.raid-form-section > .raid-image-picker,
.raid-form-section > .raid-discord-role-block,
.raid-form-section > .raid-auto-composition-note {
    grid-column: auto;
  }

  .raid-publish-panel {
    grid-template-columns: minmax(0, 1fr);
  }

  .raid-form-actions {
    width: 100%;
    min-width: 0;
    justify-content: stretch;
  }

  .raid-form-actions .btn {
    flex: 1 1 100%;
    min-width: 0;
  }

  .raid-form-heading-status {
    justify-items: start;
    flex-basis: 100%;
  }

  .raid-form-heading-status small {
    text-align: left;
  }

}

@media (max-width: 520px) {
  .raid-editor-jump-nav {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }

  .raid-editor-jump-nav::-webkit-scrollbar {
    display: none;
  }

  .raid-editor-jump-nav a {
    flex: 0 0 auto;
  }

  .raid-form-section-heading,
.raid-publish-panel__copy {
    grid-template-columns: minmax(0, 1fr);
  }

  .raid-form-step {
    width: 28px;
    height: 28px;
  }

  .raid-image-picker__input-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .raid-image-picker__refresh {
    width: 100%;
  }

  .raid-preview-meta {
    grid-template-columns: minmax(0, 1fr);
  }

}

/* =========================================================
   6. ЖИВЕ ОНОВЛЕННЯ, АРХІВ І СІРИЙ СПИСОК
   ========================================================= */

/* ---------- Індикатор живої синхронізації ---------- */
.raid-live-sync,
.raid-poll-live-sync {
  --tone: var(--c-ink-400);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  align-self: flex-start;
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid color-mix(in srgb, var(--tone) 30%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--tone) 10%, transparent);
  color: var(--tone);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.02em;
}

.raid-live-sync strong,
.raid-poll-live-sync strong {
  color: var(--text-strong);
}

.raid-live-sync__dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--tone);
}

.raid-live-sync--checking,
.raid-poll-live-sync--checking {
  --tone: var(--c-info);
}

/* Пульсація лише під час перевірки — постійний блимаючий
   індикатор відволікає від самого рейду. */
.raid-live-sync--checking .raid-live-sync__dot {
  animation: raid-live-pulse 1.4s var(--ease-in-out) infinite;
}

@keyframes raid-live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.raid-live-sync--updated,
.raid-poll-live-sync--updated {
  --tone: var(--c-success);
}

.raid-live-sync--offline,
.raid-live-sync--error,
.raid-poll-live-sync--offline,
.raid-poll-live-sync--error {
  --tone: var(--c-danger);
}

@media (prefers-reduced-motion: reduce) {
  .raid-live-sync--checking .raid-live-sync__dot {
    animation: none;
  }
}

/* ---------- Архів із довантаженням ---------- */

/* ---------- Сірий список ---------- */
.raid-greylist-form {
  display: grid;
  gap: var(--gap-stack);
  min-width: 0;
}

.raid-greylist-enabled {
  padding: var(--space-xs) var(--space-md);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.raid-greylist-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: var(--gap-grid);
  align-items: start;
}

.raid-greylist-box {
  display: grid;
  gap: var(--space-sm);
  padding: var(--pad-card-compact);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  min-width: 0;
}

.raid-greylist-box-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-sm);
}

.raid-greylist-box-head > div {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.raid-greylist-box-head strong {
  color: var(--text-strong);
}

.raid-greylist-box-head small {
  color: var(--text-muted);
  font-size: var(--font-size-meta);
}

.raid-greylist-mini-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

.raid-greylist-search {
  display: block;
  min-width: 0;
}

.raid-greylist-state-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

/* Список складу: власний скрол, щоб сторінка не тягнулась на екрани */
.raid-greylist-roster {
  display: grid;
  gap: var(--space-2xs);
  max-height: min(52vh, 480px);
  overflow-y: auto;
  padding-right: var(--space-3xs);
  min-width: 0;
}

.raid-greylist-member {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}

.raid-greylist-member:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
}

.raid-greylist-member.is-selected {
  border-color: var(--border-strong);
  background: var(--accent-soft);
}

.raid-greylist-member > span:last-child {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.raid-greylist-member strong {
  font-size: 0.86rem;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.raid-greylist-member small {
  font-size: var(--font-size-sm);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.raid-greylist-member img,
.raid-greylist-avatar {
  width: 34px;
  height: var(--control-height-sm);
  flex: 0 0 auto;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border-subtle);
  background: var(--surface-raised);
}

.raid-greylist-avatar {
  display: grid;
  place-items: center;
  color: var(--c-accent-300);
  font-size: var(--font-size-ui-lg);
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
}

.raid-greylist-manual {
  min-height: 200px;
  font-family: var(--font-mono);
  font-size: 0.84rem;
}

.raid-greylist-selected {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2xs);
}

/* =========================================================
   7. ПУЛИ — форма створення голосування
   ========================================================= */

/* Тони станів рейду: пігулка бере колір із --tone */
.raid-state--published,
.raid-state--active {
  --tone: var(--c-success);
}

.raid-state--draft {
  --tone: var(--c-warning);
}

.raid-state--closed,
.raid-state--archived {
  --tone: var(--c-ink-400);
}

.raid-poll-field {
  display: grid;
  gap: var(--space-xs);
  min-width: 0;
}

.raid-poll-field--wide {
  grid-column: 1 / -1;
}

/* Дні тижня — сітка перемикачів, а не стовпчик кнопок */
.raid-poll-day-toggle-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(96px, 100%), 1fr));
  gap: var(--space-xs);
}

.raid-poll-day-toggle {
  display: grid;
  gap: var(--space-3xs);
  justify-items: center;
  padding: var(--space-sm) var(--space-xs);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
  color: var(--text-soft);
  font-family: inherit;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.raid-poll-day-toggle:hover {
  border-color: var(--border-strong);
  background: var(--surface-hover);
  transform: translateY(-2px);
}

.raid-poll-day-toggle strong {
  font-size: var(--font-size-body);
  color: var(--text-strong);
}

.raid-poll-day-toggle span {
  font-size: var(--font-size-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.raid-poll-day-toggle.is-selected {
  border-color: transparent;
  background: var(--accent-gradient);
}

.raid-poll-day-toggle.is-selected strong,
.raid-poll-day-toggle.is-selected span {
  color: var(--text-on-accent);
}

.raid-poll-day-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.raid-poll-repeat-toggle {
  grid-column: 1 / -1;
}

/* Підсумок налаштувань перед публікацією */
.raid-poll-create-preview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
  gap: var(--space-sm);
  padding: var(--pad-card-compact);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.raid-poll-create-preview > div {
  display: grid;
  gap: var(--space-3xs);
  min-width: 0;
}

.raid-poll-create-preview strong {
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-bold);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.raid-poll-create-preview span {
  color: var(--text-body);
  font-size: 0.84rem;
  overflow-wrap: anywhere;
}

/* =========================================================
   8. ПОЗНАЧЕННЯ УЧАСНИКІВ ІЗ РУЧНИМ ЗАПИСОМ
   ========================================================= */
/* Учасник без персонажа: пунктирна рамка аватара вже є,
   додаємо приглушений підпис «ручний запис». */
.raid-party-row.is-manual .raid-party-member-copy small:last-child {
  color: var(--text-faint);
  font-style: italic;
}

/* =========================================================
   6. RAID UX REFRESH — v3.8.6
   Пріоритет: швидке сканування стану, ролей і дій без дублювання.
   ========================================================= */
.raid-page .raid-dashboard-hero {
  min-height: auto;
  padding-block: clamp(var(--space-lg), 2.2vw, var(--space-xl));
}

/* ---------- Сторінка рейду: навігація ---------- */

.raid-preview-card {
  gap: var(--space-md);
  padding: clamp(var(--space-md), 1.8vw, var(--space-lg));
}

.raid-preview-head--modern {
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-md);
}

.raid-description-markdown--compact {
  max-width: 86ch;
  font-size: 0.86rem;
  line-height: var(--line-height-relaxed);
}

.raid-closed-banner {
  display: grid;
  gap: var(--space-3xs);
}

.raid-closed-banner strong {
  color: var(--text-soft);
}

.raid-closed-banner span {
  color: var(--text-muted);
  font-size: var(--font-size-ui);
}

/* Чотири речі, які треба побачити за 2 секунди. */

.raid-preview-buttons--interactive {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.raid-preview-buttons--interactive .raid-action {
  justify-content: center;
  min-width: 0;
  padding-inline: var(--space-sm);
}

.raid-preview-roster-head--modern {
  display: flex;
  grid-template-columns: none;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-md);
}

.raid-party-card {
  padding: var(--space-sm);
}

.raid-party-row {
  padding-block: 6px;
}

/* ---------- Правий склад: тільки корисні секції ---------- */

@media (max-width: 860px) {

  .raid-preview-buttons--interactive {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .raid-preview-roster-head--modern {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (max-width: 620px) {

  .raid-preview-head--modern {
    grid-template-columns: minmax(0, 1fr);
  }

  .raid-preview-title-row {
    flex-direction: column;
    align-items: stretch;
  }

  .raid-preview-buttons--interactive {
    grid-template-columns: minmax(0, 1fr);
  }
}

/* R6.8 list navigation uses shared controls and existing palette. */

/* Discord-only signup: never visually imply that registration happens on the site. */
```

## src/app/styles/tokens.css

```css
/* =========================================================
   ДИЗАЙН-ТОКЕНИ — Mistblossom Vanguard

   Збережена тепла нічна палітра й бурштиновий акцент, але файл
   очищено від legacy aliases: тут лишаються лише токени, які
   реально споживає поточний dashboard.
   ========================================================= */

:root {
  /* ---------- Основа: тепла нічна база ---------- */
  --c-base-900: #0c0a07; /* найглибший фон, підвал */
  --c-base-850: #100d0a;
  --c-base-700: #1a1511; /* підняті поверхні */
  --c-base-500: #2c231b; /* ховер, активні поверхні */
  --c-base-400: #3a2e24; /* межі, розділювачі */

  /* ---------- Акцент: бурштин ---------- */
  --c-accent-100: #ffe6cd;
  --c-accent-200: #ffc890;
  --c-accent-300: #ffb26a;
  --c-accent-400: #ff9b55;
  --c-accent-500: #ff7a2f;
  --c-accent-600: #d86324;

  /* ---------- Текст ---------- */
  --c-ink-100: #fff6ec;
  --c-ink-200: #e6e1d8;
  --c-ink-300: #b8ada0;
  --c-ink-400: #9c948a;
  --c-ink-500: #756b5e;

  /* ---------- Статуси, зведені до теплої бази ---------- */
  --c-success: #7cc48f;
  --c-info: #79a6d8;
  --c-warning: #e8b34a;
  --c-danger: #e0705f;

  /* ---------- Ролі WoW ---------- */
  --c-role-tank: #79a6d8;
  --c-role-healer: #7cc48f;
  --c-role-dps: #e0705f;

  /* ---------- Складності рейду ---------- */
  --c-diff-mythic: #c08adf;
  --c-diff-heroic: #79a6d8;
  --c-diff-normal: #7cc48f;

  /* ---------- Точки зламу ----------
     CSS не дозволяє var() у @media, тому це довідка, а не токени.
     Уся адаптивність сайту зведена до чотирьох ширин:

       1000px — бічна колонка йде під контент (page-layout, side-stack)
        860px — багатоколонкові сітки стають одноколонковими
        640px — таблиці й рядки перебудовуються в картки
        520px — телефон: дії на всю ширину, компактна типографіка

     Desktop workspace починається з 1001px; мобільна навігація
     має окремий компактний режим до 1000px. */

  /* ---------- Текст на кольорових підкладках ----------
     Ці значення повторювались по 3–15 разів у кожному доменному
     файлі. Тепер вони мають імена, і зміна відтінку статусу — одна
     правка тут, а не пошук по 15 стилях. */
  --text-on-accent: #1c1208;
  --text-on-warning: #f4d79a;
  --text-on-danger: #ffbdb1;
  --text-on-success: #b6e2c3;

  /* ---------- Підкладки статусів ----------
     Однакові трійки «межа / фон / м'який фон» для сповіщень,
     чипів і карток. Раніше кожен файл писав свою rgba(). */
  --tint-warning-border: rgba(232, 179, 74, 0.28);
  --tint-warning-bg: rgba(232, 179, 74, 0.08);
  --tint-danger-border: rgba(224, 112, 95, 0.28);
  --tint-danger-bg: rgba(224, 112, 95, 0.08);
  --tint-success-border: rgba(124, 196, 143, 0.28);
  --tint-success-bg: rgba(124, 196, 143, 0.08);

  /* ---------- Брендовий колір інтеграції ---------- */
  --c-discord: #5865f2;

  /* =======================================================
     СЕМАНТИЧНИЙ ШАР — ним і треба користуватися у стилях
     ======================================================= */

  --surface: rgba(34, 27, 21, 0.72);
  --surface-raised: rgba(44, 35, 27, 0.85);
  --surface-hover: rgba(255, 155, 85, 0.06);
  --surface-sunken: rgba(12, 10, 7, 0.55);
  --surface-panel: var(--surface);

  --border-subtle: rgba(255, 226, 196, 0.08);
  --border: rgba(255, 226, 196, 0.13);
  --border-strong: rgba(255, 178, 106, 0.28);

  --text-strong: var(--c-ink-100);
  --text-body: var(--c-ink-200);
  --text-soft: var(--c-ink-300);
  --text-muted: var(--c-ink-400);
  --text-faint: var(--c-ink-500);
  /* compatibility aliases for older isolated modules */
  --text: var(--text-body);

  --accent-soft: rgba(255, 155, 85, 0.12);
  --accent-ring: rgba(255, 155, 85, 0.35);
  --accent-gradient: linear-gradient(135deg, var(--c-accent-300), var(--c-accent-600));

  /* ---------- Тіні ---------- */
  --shadow-sm: 0 8px 20px -14px rgba(0, 0, 0, 0.7);
  --shadow-md: 0 12px 28px -14px rgba(0, 0, 0, 0.75);
  --shadow-lg: 0 24px 50px -24px rgba(0, 0, 0, 0.9);

  /* ---------- Типографічна шкала ----------
     Значення відповідають найчастішим поточним розмірам. Винесення
     у токени не змінює геометрію, але прибирає локальне розходження. */
  --font-size-2xs: 0.66rem;
  --font-size-xs: 0.68rem;
  --font-size-caption: 0.7rem;
  --font-size-sm: 0.72rem;
  --font-size-meta: 0.76rem;
  --font-size-ui: 0.78rem;
  --font-size-ui-lg: 0.8rem;
  --font-size-body-sm: 0.82rem;
  --font-size-body: 0.9rem;
  --font-size-base: 1rem;

  --font-weight-ui: 500;
  --font-weight-medium: 600;
  --font-weight-semibold: 650;
  --font-weight-bold: 700;
  --font-weight-display: 750;
  --font-weight-heavy: 800;

  --line-height-tight: 1.35;
  --line-height-compact: 1.45;
  --line-height-body: 1.5;
  --line-height-relaxed: 1.55;
  --line-height-copy: 1.6;

  /* ---------- Відступи: шкала з кроком 4px ---------- */
  --space-3xs: 2px;
  --space-2xs: 4px;
  --space-xs: 8px;
  --space-sm: 12px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-3xl: 64px;

  /* ---------- Ритм сторінки ---------- */
  --gap-stack: var(--space-md);
  --gap-grid: var(--space-lg);
  --gap-section: var(--gap-grid);
  --pad-card: var(--space-lg);
  --pad-card-compact: var(--space-md);
  --pad-section: clamp(var(--space-xl), 5vw, var(--space-3xl));
  --pad-page-inline: clamp(var(--space-md), 4vw, var(--space-xl));

  /* ---------- Радіуси ---------- */
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-pill: 999px;
  --control-radius: 10px;

  /* ---------- Рух ---------- */
  --dur-instant: 0.12s;
  --dur-fast: 0.2s;
  --dur-base: 0.3s;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  /* ---------- Шрифти та z-index ----------
     Без зовнішнього font fetch: основний UI використовує нативний системний
     sans-stack, брендові заголовки — стабільний serif fallback. */
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-display: var(--font-guild-heading), Georgia, "Times New Roman", serif;
  --font-brand: var(--font-guild-display), "Palatino Linotype", Georgia, serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;

  --z-dropdown: 1000;
  --z-navbar: 9999;
  --z-toast: 10500;

  /* ---------- Фон сторінки ---------- */
  --site-bg-0: var(--c-base-900);
  --site-bg-1: var(--c-base-850);
  --site-bg-2: var(--c-base-700);

  /* =======================================================
     ГЕОМЕТРІЯ НАВІГАЦІЇ ДАШБОРДУ
     Мобільна навігація використовує власну компактну шапку.
     Desktop geometry живе у desktop.css/nav.css.
     ======================================================= */
  /* Геометрія мобільної навігації */
  --nav-h: 54px;
  --nav-inset: 16px;
  --nav-space: calc(var(--nav-h) + var(--nav-inset) * 2);

  --nav-surface: rgba(26, 21, 17, 0.82);
  --nav-surface-solid: rgba(18, 15, 12, 0.95);
  --nav-panel: rgba(20, 16, 13, 0.97);
  --nav-line: var(--border);
  --nav-shadow: var(--shadow-lg), 0 2px 12px rgba(0, 0, 0, 0.35);

  /* ---------- Ширина контенту ---------- */
  --page-max: 1520px;
  --page-gutter: clamp(16px, 2vw, 28px);
  --page-gap: 20px;
  --section-gap: 16px;
  --card-radius: var(--radius-md);
  --panel-padding: 20px;
  --control-height: 42px;
  --control-height-sm: 34px;
  --control-pad-x: 16px;

  /* ---------- Короткий alias для фокусу/форм ---------- */
  --orange-main: var(--c-accent-400);

  /* Universal page foundation: approved semantic geometry and states. */
  --heading-page-size: clamp(1.6rem, 2.8vw, 2.25rem);
  --heading-section-size: clamp(1.15rem, 2vw, 1.45rem);
  --heading-card-size: 1rem;
  --stroke-width: 1px;
  --focus-width: 2px;
  --focus-offset: 3px;
  --management-sidebar-width: 232px;
  --data-grid-min: 16rem;
  --toolbar-search-min: 14rem;
  --dropdown-min: 13rem;
  --data-card-min-height: 12rem;
  --skeleton-card-height: var(--data-card-min-height);
  --skeleton-line-height: 1rem;
  --skeleton-row-height: 4rem;
  --skeleton-duration: 1.2s;
  --opacity-disabled: 0.5;
  --opacity-skeleton-low: 0.45;
  --opacity-skeleton-high: 0.8;
  --tint-info-bg: rgba(121, 166, 216, 0.08);
  --tint-info-border: rgba(121, 166, 216, 0.28);
}

/* Existing WoW class palette, centralized from the guild roster. */
:root {
  --c-wow-death-knight: #c41e3a;
  --c-wow-demon-hunter: #a330c9;
  --c-wow-druid: #ff7c0a;
  --c-wow-evoker: #33937f;
  --c-wow-hunter: #aad372;
  --c-wow-mage: #3fc7eb;
  --c-wow-monk: #00ff98;
  --c-wow-paladin: #f48cba;
  --c-wow-priest: #ffffff;
  --c-wow-rogue: #fff468;
  --c-wow-shaman: #0070dd;
  --c-wow-warlock: #8788ee;
  --c-wow-warrior: #c69b6d;
}
```

## src/components/ApplicationDelivery.tsx

```tsx
"use client";
import styles from "@/components/applications/applications-workspace.module.css";
import { useEffect, useRef, useState } from "react";
import { ApiHttpError } from "@/lib/apiHttp";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
type Delivery = { state: string; attempts: number; nextAttemptAt: string | null; messageUrl: string; code: string };
const labels: Record<string, string> = { pending: "Очікує доставки", processing: "Доставка виконується", retry: "Повтор заплановано", blocked: "Перевір налаштування бота й каналу", uncertain: "Потрібна звірка з Discord", delivered: "Доставлено в Discord", cancelled: "Доставку скасовано", untracked: "Стара заявка: автоматичний повтор не заплановано" };
export default function ApplicationDelivery({ number }: { number: number }) {
  const [delivery, setDelivery] = useState<Delivery | null>(null), [error, setError] = useState(""), [readError, setReadError] = useState(""), [busy, setBusy] = useState(false), [messageUrl, setMessageUrl] = useState("");
  const epoch = useRef(0), lock = useRef(false), refresh = useRef<() => void>(() => {});
  const endpoint = `/api/applications/${number}/delivery`;
  useEffect(() => {
    let stopped = false, reading = false, queued = false, timer: ReturnType<typeof setTimeout> | undefined; const controller = new AbortController();
    async function read() {
      if (stopped || lock.current || document.hidden || !navigator.onLine) return;
      if (reading) { queued = true; return; }
      reading = true; const generation = epoch.current; clearTimeout(timer);
      try { const result = await dashboardApiJson<{ delivery: Delivery }>(endpoint, { signal: controller.signal, retries: 0, timeoutMs: 10_000 }); if (!result.delivery || !labels[result.delivery.state]) throw new Error("Invalid delivery state"); if (!stopped && generation === epoch.current && !lock.current) { setDelivery(result.delivery); setReadError(""); if (result.delivery.state === "delivered") setError(""); } }
      catch { if (!stopped && generation === epoch.current && !lock.current) setReadError("Стан доставки тимчасово недоступний."); }
      finally { reading = false; if (!stopped) { timer = setTimeout(read, queued ? 0 : 30_000); queued = false; } }
    }
    refresh.current = () => { void read(); }; void read(); document.addEventListener("visibilitychange", read); window.addEventListener("online", read);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", read); window.removeEventListener("online", read); };
  }, [endpoint]);
  async function reconcile(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current) return; lock.current = true; epoch.current++; setBusy(true); setError("");
    try { const result = await dashboardApiJson<{ delivery: Delivery }>(endpoint, { method: "POST", json: messageUrl.trim() ? { messageUrl: messageUrl.trim() } : {}, retries: 0, timeoutMs: 55_000 }); if (!result.delivery || !labels[result.delivery.state]) throw new Error("Invalid delivery state"); setDelivery(result.delivery); if (result.delivery.state === "delivered") setMessageUrl(""); else if (messageUrl.trim()) setError("Посилання не підтверджено. Перевір канал і повідомлення цієї заявки."); }
    catch (error) { setError(error instanceof ApiHttpError && error.status >= 400 && error.status < 500 ? error.message : "Відповідь не отримано. Перевір стан доставки перед повторною дією."); }
    finally { lock.current = false; setBusy(false); refresh.current(); }
  }
  return <form className={styles.delivery} onSubmit={reconcile} aria-label={`Доставка заявки #${number}`} aria-busy={busy}>
    <strong>Discord</strong><p role="status">{delivery ? labels[delivery.state] || "Стан невідомий" : "Перевіряємо доставку…"}</p>
    {delivery?.messageUrl && <a href={delivery.messageUrl} target="_blank" rel="noreferrer">Відкрити повідомлення ↗</a>}
    {delivery && !["delivered", "cancelled", "untracked"].includes(delivery.state) && <>
      {delivery.state === "uncertain" && <label>Посилання на вже створене повідомлення<input type="url" maxLength={500} value={messageUrl} onChange={event => setMessageUrl(event.target.value)} placeholder="https://discord.com/channels/…" disabled={busy}/></label>}
      <button className="btn subtle" type="submit" disabled={busy || delivery.state === "processing"}>{busy ? "Перевіряємо…" : delivery.state === "uncertain" ? "Звірити з Discord" : "Повторити доставку"}</button>
    </>}
    {(error || readError) && <p role="status">{error || readError} <button className="btn subtle" type="button" disabled={busy} onClick={() => refresh.current()}>Перевірити стан</button></p>}
  </form>;
}
```

## src/components/ApplicationFilters.tsx

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import FilterToolbar from "@/components/page/FilterToolbar";
import styles from "@/components/community/workspace.module.css";
import { listViewUrl } from "@/lib/listViewState";

type ApplicationFiltersProps = {
  initialQuery?: string;
  initialStatus?: string;
  initialClass?: string;
  initialSort?: string;
  classOptions: string[];
};

const DEFAULTS = {
  q: "",
  status: "all",
  class: "all",
  sort: "created",
};

function normalizedValue(value: string | null | undefined, fallback: string) {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function buildNextUrl(pathname: string, updates: Record<string, string>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(updates)) {
    const clean = String(value || "").trim();
    const fallback = DEFAULTS[key as keyof typeof DEFAULTS];
    if (!clean || clean === fallback) {
      params.delete(key);
    } else {
      params.set(key, clean);
    }
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export default function ApplicationFilters({
  initialQuery = "",
  initialStatus = "all",
  initialClass = "all",
  initialSort = "created",
  classOptions,
}: ApplicationFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(normalizedValue(initialStatus, DEFAULTS.status));
  const [className, setClassName] = useState(normalizedValue(initialClass, DEFAULTS.class));
  const [sort, setSort] = useState(normalizedValue(initialSort, DEFAULTS.sort));
  const latestFiltersRef = useRef({ status, className, sort });
  const lastRequestedRef = useRef("");
  const resettingRef = useRef(false);
  const paramsString = searchParams.toString();

  const options = useMemo(() => Array.from(new Set(classOptions.filter(Boolean))).sort(), [classOptions]);

  useEffect(() => {
    setQuery(initialQuery);
    setStatus(normalizedValue(initialStatus, DEFAULTS.status));
    setClassName(normalizedValue(initialClass, DEFAULTS.class));
    setSort(normalizedValue(initialSort, DEFAULTS.sort));
  }, [initialQuery, initialStatus, initialClass, initialSort]);

  useEffect(() => {
    latestFiltersRef.current = { status, className, sort };
  }, [status, className, sort]);

  useEffect(() => { lastRequestedRef.current = ""; resettingRef.current = false; }, [paramsString]);

  const applyFilters = useCallback((updates: Record<string, string>) => {
    const safePathname = pathname || "/";
    const nextUrl = listViewUrl("applications", buildNextUrl(safePathname, updates)) || "/applications";
    const currentUrl = listViewUrl("applications", `${safePathname}?${paramsString}`);
    if (nextUrl === currentUrl || nextUrl === lastRequestedRef.current) return;
    lastRequestedRef.current = nextUrl;
    startTransition(() => {
      router.replace(nextUrl, { scroll: false });
    });
  }, [pathname, router, paramsString, startTransition]);

  useEffect(() => {
    if (resettingRef.current || query.trim() === initialQuery.trim()) return;
    const timer = window.setTimeout(() => {
      const latest = latestFiltersRef.current;
      applyFilters({ q: query, status: latest.status, class: latest.className, sort: latest.sort });
    }, 360);

    return () => window.clearTimeout(timer);
  }, [applyFilters, query, initialQuery]);

  function applyImmediate(next: Partial<Record<keyof typeof DEFAULTS, string>>) {
    resettingRef.current = false;
    const merged = {
      q: next.q ?? query,
      status: next.status ?? status,
      class: next.class ?? className,
      sort: next.sort ?? sort,
    };
    latestFiltersRef.current = { status: merged.status, className: merged.class, sort: merged.sort };
    applyFilters(merged);
  }

  function resetFilters() {
    resettingRef.current = true;
    setQuery("");
    setStatus(DEFAULTS.status);
    setClassName(DEFAULTS.class);
    setSort(DEFAULTS.sort);
    latestFiltersRef.current = { status: DEFAULTS.status, className: DEFAULTS.class, sort: DEFAULTS.sort };
    lastRequestedRef.current = "/applications?view=all";
    startTransition(() => { router.replace("/applications?view=all", { scroll: false }); });
  }

  const hasActiveFilters = Boolean(query.trim()) || status !== DEFAULTS.status || className !== DEFAULTS.class || sort !== DEFAULTS.sort;

  return (
    <FilterToolbar label="Фільтри заявок" busy={isPending} search={<label className={styles.field}>
        <span>Пошук</span>
        <input
          className="input"
          name="q"
          type="search"
          maxLength={160}
          placeholder="Номер заявки, номер відстеження, нік, realm, клас..."
          value={query}
          autoComplete="off"
          onChange={(event) => { resettingRef.current = false; setQuery(event.currentTarget.value); }}
        />
      </label>} filters={<>      <label className={styles.field}>
        <span>Статус</span>
        <select
          className="select"
          name="status"
          value={status}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setStatus(next);
            applyImmediate({ status: next });
          }}
        >
          <option value="all">Усі статуси</option>
          <option value="review">На розгляді</option>
          <option value="accepted">Прийнято</option>
          <option value="declined">Відхилено</option>
        </select>
      </label>

      <label className={styles.field}>
        <span>Клас</span>
        <select
          className="select"
          name="class"
          value={className}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setClassName(next);
            applyImmediate({ class: next });
          }}
        >
          <option value="all">Усі класи</option>
          {className !== "all" && !options.includes(className) ? <option value={className}>{className} (немає у поточному списку)</option> : null}
          {options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>

      <label className={styles.field}>
        <span>Сортування</span>
        <select
          className="select"
          name="sort"
          value={sort}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setSort(next);
            applyImmediate({ sort: next });
          }}
        >
          <option value="created">За датою</option>
          <option value="updated">За оновленням</option>
        </select>
      </label>

</>} actions={<>        <button className="btn subtle btn-sm" type="button" disabled={!hasActiveFilters || isPending} onClick={resetFilters}>Скинути</button>
</>} result={isPending ? "Оновлюємо список…" : "Пошук застосовується автоматично"} />

  );
}
```

## src/components/ApplicationModerationQueue.tsx

```tsx
"use client";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "@/components/applications/applications-workspace.module.css";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ApplicationStatus } from "@/lib/applicationsStore";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { useActionFocus } from "@/hooks/useActionFocus";
import {
  readApplicationDecision, submitApplicationDecisions, summarizeApplicationDecisions, uncertainApplicationResult,
  type ApplicationDecision, type ApplicationDecisionResult,
} from "@/lib/applicationModerationClient";

export type ApplicationQueueItem = { issueNumber: number; status: ApplicationStatus; state: string };
type Row = ApplicationQueueItem & { busy: boolean; message: string; outcome?: ApplicationDecisionResult["outcome"] };
type Queue = {
  rows: Record<number, Row>; order: number[]; selected: number[]; canModerate: boolean;
  toggle: (number: number) => void; select: (numbers: number[]) => void;
  moderate: (numbers: number[], decision: ApplicationDecision, bulk?: boolean) => Promise<void>;
  reconcile: (number: number) => Promise<void>;
  lock: (number: number) => boolean; release: (number: number) => void;
};
const Context = createContext<Queue | null>(null);
export function useApplicationModerationQueue() {
  const context = useContext(Context);
  if (!context) throw new Error("ApplicationModerationProvider is required");
  return context;
}
function initialRows(items: ApplicationQueueItem[]) {
  return Object.fromEntries(items.map((item) => [item.issueNumber, { ...item, busy: false, message: "" }])) as Record<number, Row>;
}
function available(row: Row | undefined) { return Boolean(row && row.status === "review" && row.state !== "closed" && !row.busy && row.outcome !== "uncertain"); }

export function ApplicationModerationProvider({ items, canModerate, children }: { items: ApplicationQueueItem[]; canModerate: boolean; children: ReactNode }) {
  const [rows, setRows] = useState(() => initialRows(items));
  const rowsRef = useRef(rows);
  const [selected, setSelected] = useState<number[]>([]);
  const [results, setResults] = useState<ApplicationDecisionResult[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLElement>(bulkBusy);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const locks = useRef(new Set<number>());
  function update(change: (current: Record<number, Row>) => Record<number, Row>) {
    rowsRef.current = change(rowsRef.current);
    if (mounted.current) setRows(rowsRef.current);
  }
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    update((current) => Object.fromEntries(items.map((item) => {
      const old = current[item.issueNumber];
      if (old?.busy || old?.outcome === "uncertain" || old && old.status !== "review" && item.status === "review") return [item.issueNumber, old];
      return [item.issueNumber, { ...old, ...item, busy: false, message: old?.status === item.status ? old.message : "" }];
    })));
    setSelected((current) => current.filter((number) => items.some((item) => item.issueNumber === number && item.status === "review" && item.state !== "closed")));
  }, [items]);
  function lock(number: number) {
    if (locks.current.has(number) || !rowsRef.current[number]) return false;
    locks.current.add(number);
    update((current) => ({ ...current, [number]: { ...current[number], busy: true } }));
    return true;
  }
  function release(number: number) {
    locks.current.delete(number);
    update((current) => current[number] ? { ...current, [number]: { ...current[number], busy: false } } : current);
  }
  function apply(result: ApplicationDecisionResult) {
    update((current) => current[result.issueNumber] ? { ...current, [result.issueNumber]: {
      ...current[result.issueNumber], ...(result.status ? { status: result.status, state: result.state || "closed" } : {}),
      outcome: result.outcome, message: result.message,
    } } : current);
  }
  async function moderate(numbers: number[], decision: ApplicationDecision, bulk = false) {
    if (!canModerate) return;
    const targets = Array.from(new Set(numbers)).filter((number) => available(rowsRef.current[number]) && !locks.current.has(number)).slice(0, 50);
    if (!targets.length) return;
    targets.forEach(lock);
    if (bulk) { setBulkBusy(true); setResults([]); }
    let outcome: ApplicationDecisionResult[];
    try {
      outcome = await submitApplicationDecisions(dashboardApiJson, targets, decision, controller.current?.signal);
    } catch {
      outcome = targets.map(uncertainApplicationResult);
    }
    if (mounted.current) {
      outcome.forEach(apply);
      setSelected((current) => current.filter((number) => !targets.includes(number)));
      if (bulk) setResults(outcome);
      const summary = summarizeApplicationDecisions(outcome);
      dispatchDashboardToast({ tone: summary.uncertain || summary.discordPending ? "warning" : "success", title: summary.uncertain ? "Потрібна перевірка стану" : "Обробку заявок завершено",
        message: `Змінено: ${summary.changed}. Вже розглянуто: ${summary.already}. Discord не підтверджено: ${summary.discordPending}. Непевний результат: ${summary.uncertain}.` });
      if (outcome.some((item) => item.status)) notifyDashboardDataChanged({ scope: "applications", source: "application-status", action: decision });
    }
    targets.forEach(release);
    if (mounted.current && bulk) setBulkBusy(false);
  }
  async function reconcile(number: number) {
    if (!canModerate || !lock(number)) return;
    try {
      const result = await readApplicationDecision(dashboardApiJson, number, controller.current?.signal);
      if (mounted.current) {
        apply(result);
        setResults((current) => current.map((item) => item.issueNumber === number ? result : item));
      }
    } catch {
      if (mounted.current) apply(uncertainApplicationResult(number));
    } finally { release(number); }
  }
  function select(numbers: number[]) {
    if (canModerate) setSelected(Array.from(new Set(numbers)).filter((number) => available(rowsRef.current[number])).slice(0, 50));
  }
  function toggle(number: number) {
    if (!canModerate || !available(rowsRef.current[number])) return;
    setSelected((current) => current.includes(number) ? current.filter((item) => item !== number) : current.length < 50 ? [...current, number] : current);
  }
  const eligible = items.map((item) => item.issueNumber).filter((number) => available(rows[number]));
  const selectedEligible = selected.filter((number) => available(rows[number]));
  const summary = summarizeApplicationDecisions(results);
  function confirmBulk(decision: ApplicationDecision, trigger: HTMLButtonElement) {
    if (!selectedEligible.length || bulkBusy) return;
    const action = decision === "accepted" ? "Прийняти" : "Відхилити";
    if (window.confirm(`${action} ${selectedEligible.length} вибраних заявок? Остаточне рішення закриє кожну з них.`)) {
      beginActionFocus(trigger);
      void moderate(selectedEligible, decision, true);
    }
  }
  return <Context.Provider value={{ rows, order: items.map((item) => item.issueNumber), selected, canModerate, select, toggle, moderate, reconcile, lock, release }}>
    {canModerate && items.length ? <section ref={scopeRef} className={styles.bulk} aria-label="Масова обробка видимих заявок" aria-busy={bulkBusy}>
      <div className={styles.bulkHeading}><div><strong>Дії з вибраними заявками</strong><p>Тільки заявки на розгляді з поточного списку. До 50 за одну дію.</p></div><span>Вибрано: {selectedEligible.length}</span></div>
      <div className={styles.actions}>
        <button className="btn subtle" type="button" onClick={() => select(eligible.slice(0, 50))} disabled={bulkBusy || !eligible.length}>Вибрати {Math.min(eligible.length, 50)}</button>
        <button className="btn subtle" type="button" onClick={() => select([])} disabled={bulkBusy || !selected.length}>Скинути вибір</button>
        <button className="btn primary" type="button" onClick={(event) => confirmBulk("accepted", event.currentTarget)} disabled={bulkBusy || !selectedEligible.length}>Прийняти вибрані</button>
        <button className="btn danger" type="button" onClick={(event) => confirmBulk("declined", event.currentTarget)} disabled={bulkBusy || !selectedEligible.length}>Відхилити вибрані</button>
      </div>
      <p data-action-result tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{bulkBusy ? "Обробляємо заявки. Після втрати відповіді перевіримо збережений стан за твоєю дією." : results.length ? `Змінено: ${summary.changed} · Вже розглянуто: ${summary.already} · Discord не підтверджено: ${summary.discordPending} · Непевний результат: ${summary.uncertain}` : ""}</p>
      {results.length ? <div className={styles.results} aria-label="Результати масової обробки">
        <ul>{results.map((item) => <li key={item.issueNumber} data-outcome={item.outcome}><a href={`#application-result-${item.issueNumber}`}>#{item.issueNumber}</a> — {item.message}</li>)}</ul>
      </div> : null}
    </section> : null}
    {children}
  </Context.Provider>;
}

export function ApplicationSelection({ issueNumber }: { issueNumber: number }) {
  const queue = useApplicationModerationQueue();
  if (!queue.canModerate) return null;
  return <label className={styles.selection}><input type="checkbox" checked={queue.selected.includes(issueNumber)} disabled={!available(queue.rows[issueNumber])} onChange={() => queue.toggle(issueNumber)} aria-label={`Вибрати заявку #${issueNumber}`} />Вибрати заявку</label>;
}

export function ApplicationNextReview({ issueNumber }: { issueNumber: number }) {
  const { rows, order } = useApplicationModerationQueue();
  const index = order.indexOf(issueNumber);
  const next = [...order.slice(index + 1), ...order.slice(0, Math.max(0, index))].find((number) => number !== issueNumber && available(rows[number]));
  if (!next) return null;
  return <button className="btn subtle" type="button" onClick={() => {
    const target = document.getElementById(`application-decision-${next}`);
    target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    target?.querySelector<HTMLButtonElement>("[data-decision-primary]")?.focus({ preventScroll: true });
  }}>Наступна заявка на розгляді</button>;
}

export function ApplicationStatusBadge({issueNumber,initialStatus}: {issueNumber: number;initialStatus: ApplicationStatus}) {
  const queue = useApplicationModerationQueue();
  const row = queue.rows[issueNumber], status = row?.status || initialStatus;
  return <StatusBadge tone={row?.busy ? "info" : status === "accepted" ? "success" : status === "declined" ? "danger" : "warning"}>{row?.busy ? "Зберігаємо…" : status === "accepted" ? "Прийнято" : status === "declined" ? "Відхилено" : "На розгляді"}</StatusBadge>;
}
```

## src/components/ApplicationStatusActions.tsx

```tsx
"use client";
import DropdownMenu from "@/components/ui/DropdownMenu";
import styles from "@/components/applications/applications-workspace.module.css";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardErrorMessage, dispatchDashboardToast } from "@/lib/clientToasts";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { ApplicationNextReview, useApplicationModerationQueue } from "@/components/ApplicationModerationQueue";
import type { ApplicationStatus } from "@/lib/applicationsStore";
import { useActionFocus } from "@/hooks/useActionFocus";


export default function ApplicationStatusActions({ issueNumber, initialStatus, issueState = "open", canModerate = true, canDelete = false }: {
  issueNumber: number; initialStatus: ApplicationStatus; issueState?: string; canModerate?: boolean; canDelete?: boolean;
}) {
  const router = useRouter();
  const queue = useApplicationModerationQueue();
  const row = queue.rows[issueNumber];
  const status = row?.status || initialStatus;
  const isClosed = (row?.state || issueState) === "closed";
  const busy = Boolean(row?.busy);
  const uncertain = row?.outcome === "uncertain";
  const locked = !canModerate || !queue.canModerate || isClosed || status !== "review" || uncertain;
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteUncertain, setDeleteUncertain] = useState(false);
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLDivElement>(busy || deleting);
  const { scopeRef: deleteScopeRef, beginActionFocus: beginDeleteFocus } = useActionFocus<HTMLDivElement>(deleting);

  async function deleteApplication(trigger: HTMLButtonElement) {
    if (!canDelete || deleting || deleteUncertain || busy) return;
    if (!window.confirm(`Видалити заявку #${issueNumber} із сервера та її Discord-повідомлення? Цю дію не можна скасувати.`)) return;
    if (!queue.lock(issueNumber)) return;
    beginDeleteFocus(trigger);
    setDeleting(true); setDeleteMessage("Видаляємо заявку та Discord-повідомлення…");
    try {
      const data = await dashboardApiJson<{ ok?: boolean; discord?: { deleted?: boolean } }>(`/api/applications/${issueNumber}`, {
        method: "DELETE", headers: { "X-Dashboard-Action": "delete-application" }, retries: 0, timeoutMs: 45_000,
      });
      if (!data?.ok) throw new Error("Сервер не підтвердив видалення.");
      setDeleteMessage("Заявку видалено. Оновлюємо список…");
      notifyDashboardDataChanged({ scope: "applications", resourceId: String(issueNumber), source: "application-delete", action: "delete" });
      dispatchDashboardToast({ tone: "success", title: "Заявку видалено", message: data.discord?.deleted ? "Запис і Discord-повідомлення видалено." : "Заявку видалено. Discord-повідомлення вже було відсутнє або не мало reference." });
      router.refresh();
    } catch (error) {
      setDeleteUncertain(true);
      setDeleteMessage("Видалення не підтверджено. Онови список і перевір результат перед повторною дією.");
      dispatchDashboardToast({ tone: "warning", title: "Перевір результат видалення", message: dashboardErrorMessage(error, "Відповідь не отримано.") });
    } finally { setDeleting(false); queue.release(issueNumber); }
  }
  const fallback = !canModerate ? "Доступний лише перегляд." : isClosed && status === "review" ? "Заявку закрито без остаточного рішення. Повторна модерація вимкнена." : isClosed || status !== "review" ? "Рішення збережено. Повторна модерація вимкнена." : "Обери остаточне рішення. Статус зміниться після підтвердження сервера.";
  return <div ref={scopeRef} id={`application-decision-${issueNumber}`} className={styles.stack} role="group" aria-label={`Рішення щодо заявки #${issueNumber}`} aria-busy={busy || deleting} data-status={status} data-busy={busy} data-closed={isClosed} data-locked={locked}>
    {!locked ? <div className={styles.actions} aria-label={`Рішення щодо заявки #${issueNumber}`}>
      <button className="btn primary" type="button" data-decision-primary disabled={busy || deleting} onClick={(event) => { beginActionFocus(event.currentTarget); void queue.moderate([issueNumber], "accepted"); }}>Прийняти</button>
      <button className="btn danger" type="button" disabled={busy || deleting} onClick={(event) => { beginActionFocus(event.currentTarget); void queue.moderate([issueNumber], "declined"); }}>Відхилити</button>
    </div> : null}
    <p id={`application-result-${issueNumber}`} className={styles.message} data-action-result tabIndex={-1} data-outcome={row?.outcome || "idle"} role="status" aria-live="polite" aria-atomic="true">{busy ? "Перевіряємо та зберігаємо результат…" : row?.message || fallback}</p>
    {canModerate && uncertain ? <button className="btn subtle" type="button" disabled={busy} onClick={(event) => { beginActionFocus(event.currentTarget); void queue.reconcile(issueNumber); }}>{busy ? "Перевіряємо стан…" : "Перевірити збережений стан"}</button> : null}
    {canModerate && (isClosed || status !== "review") ? <ApplicationNextReview issueNumber={issueNumber} /> : null}
    {canDelete ? <div ref={deleteScopeRef} className={styles.stack}><DropdownMenu label="Інші дії із заявкою" closeOnAction={false}>
      <button className="btn danger" type="button" onClick={(event) => void deleteApplication(event.currentTarget)} disabled={deleting || busy || deleteUncertain} aria-busy={deleting}>{deleting ? "Видаляємо…" : "Видалити заявку"}</button>
      </DropdownMenu>
      <small id={`application-delete-result-${issueNumber}`} data-action-result tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{deleteMessage}</small>
      {deleteUncertain ? <button className="btn subtle" type="button" onClick={() => router.refresh()}>Оновити список</button> : null}
    </div> : null}
  </div>;
}
```

## src/components/DiscordPublicationStatus.tsx

```tsx
"use client";
import styles from "@/components/community/publication.module.css";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiHttpError } from "@/lib/apiHttp";
import { dashboardApiJson } from "@/lib/dashboardApiClient";
import { unknownPublicationStatus, type PublicationStatus } from "@/lib/publicationStatus";
import { useActionFocus } from "@/hooks/useActionFocus";

type Reply = { ok: boolean; publication?: PublicationStatus | null; warning?: string | null };
export default function DiscordPublicationStatus({ endpoint, initialStatus, discordEnabled }: { endpoint: string; initialStatus: PublicationStatus; discordEnabled: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState<"read" | "write" | null>(null);
  const [messageUrl, setMessageUrl] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLElement>(pending !== null);
  // A server refresh can arrive while the local POST is in flight. Its result
  // must not overwrite a newer status read at the end of this action.
  useEffect(() => { if (!lock.current) setStatus(initialStatus); }, [initialStatus]);
  async function read() {
    const data = await dashboardApiJson<Reply>(endpoint, { method: "GET", timeoutMs: 10_000, retries: 0 });
    if (!data.ok || !data.publication) throw new Error("Стан не підтверджено.");
    setStatus(data.publication);
    return data.publication;
  }
  async function run(write: boolean, trigger: HTMLButtonElement) {
    if (lock.current) return;
    if (write && (!status.canAct || !discordEnabled)) return;
    if (write && status.channelMove && !window.confirm("Перенести оголошення до збереженого каналу? Буде створено нове повідомлення, після чого сайт спробує прибрати старе.")) return;
    lock.current = true;
    beginActionFocus(trigger);
    setPending(write ? "write" : "read"); setNotice("");
    let actionWarning = "";
    try {
      if (write) {
        const data = await dashboardApiJson<Reply>(endpoint, { method: "POST", json: { publicationMessageUrl: status.manualAllowed ? messageUrl.trim() : "" }, timeoutMs: 45_000, retries: 0 });
        if (!data.ok) throw new Error("Результат дії не підтверджено.");
        actionWarning = data.warning || "";
        setMessageUrl("");
      }
      const fresh = await read();
      setNotice(write ? actionWarning || (fresh.message.pending || fresh.event?.pending ? "Операція ще потребує завершення. Перевір збережений стан нижче." : "Discord підтвердив виконання дії. Стан перечитано зі сховища.") : "Збережений стан оновлено. Discord цим читанням не опитувався.");
      if (write) router.refresh();
    } catch (error) {
      const detail = error instanceof ApiHttpError && [400, 403, 409].includes(error.status) ? ` ${error.message.slice(0, 500)}` : "";
      setNotice((write ? "Виконання не підтверджено повністю. Звір збережений стан перед наступною дією. Повторного автоматичного надсилання немає." : "Не вдалося оновити стан. Спробуй прочитати його ще раз.") + detail);
      // Even a lost response can follow a successful Discord write. Re-read
      // the durable receipt; never automatically replay this POST.
      if (write) { try { await read(); } catch { setStatus(unknownPublicationStatus()); } }
      else setStatus(unknownPublicationStatus());
    } finally { lock.current = false; setPending(null); }
  }
  return <section ref={scopeRef} id="discord-publication" className={styles.panel} aria-label="Стан публікації Discord" aria-busy={pending !== null}>
    <div><span className="eyebrow">Discord · збережений стан</span><h2>Публікація та відновлення</h2>
      <p className={styles.metadata}>Дії використовують останні збережені дані. Зміни у формі спочатку збережи.</p></div>
    <dl className={styles.states}>
      <div><dt>Оголошення · {status.message.label}</dt><dd>{status.message.description}</dd></div>
      {status.event ? <div><dt>Подія · {status.event.label}</dt><dd>{status.event.description}</dd></div> : null}
    </dl>
    {status.scheduled ? <p>Розклад збережено. Публікація доступна лише після настання запланованого часу.</p> : null}
    {status.manualAllowed ? <label className={styles.field}>Посилання на вже створене оголошення (необовʼязково)
      <input type="url" aria-label="Посилання на вже створене оголошення" value={messageUrl} onChange={event => setMessageUrl(event.target.value)} placeholder="https://discord.com/channels/…" maxLength={300} disabled={pending !== null} />
      <span className={styles.metadata}>Посилання перевіряється за каналом, автором, часом і записом. Воно не дозволяє примусове повторне надсилання.</span>
    </label> : null}
    {!discordEnabled ? <p>Discord-публікація зараз недоступна. Збережений стан можна перечитати.</p> : null}
    <div className={styles.actions}>
      <button type="button" className="btn subtle" disabled={pending !== null} onClick={(event) => run(false, event.currentTarget)}>{pending === "read" ? "Читаємо стан…" : "Оновити стан"}</button>
      {status.canAct && discordEnabled ? <button type="button" className="btn primary" disabled={pending !== null} onClick={(event) => run(true, event.currentTarget)}>{pending === "write" ? "Виконуємо…" : status.actionLabel}</button> : null}
    </div>
    <p className={styles.result} data-action-result tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">{pending ? pending === "read" ? "Читаємо збережений стан…" : "Звіряємо та зберігаємо результат Discord…" : notice}</p>
  </section>;
}
```

## src/components/GuildRosterExplorer.tsx

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GuildRosterMember, GuildRosterStats, GuildScoreSegment } from "@/lib/guildRoster";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import { currentSeasonRaidProgress, currentSeasonRaidSlugs } from "@/lib/characterRaidProgress";
import { formatStableNumber, stableTextCompare } from "@/lib/stableUiText";
import { useSearchParams } from "next/navigation";
import ListViewMemory from "@/components/ListViewMemory";
import { listViewUrl } from "@/lib/listViewState";
import { replaceClientListLocation } from "@/lib/clientListLocation";
import { readGuildRosterView, compareGuildRosterMembers, type GuildRosterSort, type GuildRaidClearFilter, type GuildLinkFilter } from "@/lib/guildRosterViewState";
import styles from "./guild/guild-workspace.module.css";
import { normalizedRaidProgress, bestRaid, raidWeight, raidIsClear, raidHasProgress, friendlySource } from "@/lib/guildRosterPresentation";
import GuildRosterTable from "@/components/guild/GuildRosterTable";
import FilterToolbar from "@/components/page/FilterToolbar";
import FormField from "@/components/ui/FormField";
import FormSection from "@/components/page/FormSection";
import PageSection from "@/components/page/PageSection";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import StatusBadge from "@/components/page/StatusBadge";
import Button from "@/components/ui/Button";

type Props = {
  members: GuildRosterMember[];
  stats: GuildRosterStats;
  source: string;
  error?: string | null;
  navigationScope: string;
};

type GuildRosterLivePayload = Omit<Props, "navigationScope"> & {
  ok?: boolean;
  memberCount?: number;
  updatedAt?: string | null;
  refresh?: {
    sync?: {
      status?: string;
      phase?: string;
      totalMembers?: number;
      processed?: { roster?: number; battleNet?: number; raiderIo?: number };
    };
  };
};

const SEGMENT_LABELS: Record<GuildScoreSegment, string> = {
  all: "Загальний",
  dps: "DPS",
  healer: "Heal",
  tank: "Tank",
};

const ROLE_FILTERS = [
  { value: "all", label: "Усі" },
  { value: "tank", label: "Танк" },
  { value: "healer", label: "Хіл" },
  { value: "dps", label: "ДД" },
] as const;

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return formatStableNumber(value, digits);
}

function formatRosterDate(value?: string | null) {
  if (!value) return "ще немає";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Kyiv",
  }).format(date);
}

function uniqueSorted(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((a, b) => stableTextCompare(a, b));
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.filterField} htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {(options.some((option) => option.value === value) ? options : [...options, { value, label: `${value} (немає в поточному складі)` }]).map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CompactRange({
  id,
  label,
  minValue,
  maxValue,
  absoluteMax,
  onMinChange,
  onMaxChange,
}: {
  id: string;
  label: string;
  minValue: number;
  maxValue: number;
  absoluteMax: number;
  onMinChange: (value: number) => void;
  onMaxChange: (value: number) => void;
}) {
  const safeMax = Math.max(0, absoluteMax);
  return (
    <fieldset className={styles.rangeField}>
      <legend>{label}</legend>
      <label>
        <span>від</span>
        <input
          id={`${id}-min`}
          type="number"
          inputMode="numeric"
          min={0}
          max={safeMax}
          value={minValue}
          onChange={(event) => onMinChange(Math.max(0, Math.min(safeMax, Number(event.target.value) || 0)))}
        />
      </label>
      <span className={styles.rangeDash}>—</span>
      <label>
        <span>до</span>
        <input
          id={`${id}-max`}
          type="number"
          inputMode="numeric"
          min={0}
          max={safeMax}
          value={maxValue}
          onChange={(event) => onMaxChange(Math.max(0, Math.min(safeMax, Number(event.target.value) || 0)))}
        />
      </label>
    </fieldset>
  );
}

export default function GuildRosterExplorer({ members, stats, source, error, navigationScope }: Props) {
  const initialRoster = useMemo<GuildRosterLivePayload>(
    () => ({ members, stats, source, error: error || null }),
    [members, stats, source, error],
  );
  const rosterResource = useDashboardApiResource<GuildRosterLivePayload>({
    key: "guild-roster",
    scope: "guild",
    initialData: initialRoster,
    minIntervalMs: 60_000,
    request: () => ({
      url: "/api/guild/refresh",
      method: "POST",
      headers: { "X-Dashboard-Action": "guild-roster-cache-sync" },
      json: { cacheOnly: true, includeMembers: true, includeStats: true, bypassCache: true },
      select: (payload) => {
        const data = payload as Partial<GuildRosterLivePayload> | null;
        return {
          members: Array.isArray(data?.members) ? data.members : members,
          stats: data?.stats || stats,
          source: typeof data?.source === "string" ? data.source : source,
          error: typeof data?.error === "string" ? data.error : null,
          ok: data?.ok,
          memberCount: data?.memberCount,
          updatedAt: data?.updatedAt,
          refresh: data?.refresh,
        };
      },
    }),
    refreshOnMount: false,
  });

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!document.hidden) void rosterResource.refresh("guild-roster-poll");
        schedule();
      }, 60_000);
    };
    const onVisibility = () => {
      if (!document.hidden) void rosterResource.refresh("guild-roster-visible", { force: true });
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [rosterResource.refresh]);

  const liveMembers = rosterResource.data.members;
  const liveStats = rosterResource.data.stats || stats;
  const liveSource = rosterResource.data.source || source;
  const liveError = rosterResource.data.error || error || rosterResource.error || null;
  const liveSync = rosterResource.data.refresh?.sync;
  const syncProcessed = liveSync?.phase === "raiderio"
    ? Number(liveSync.processed?.raiderIo || 0)
    : liveSync?.phase === "battlenet"
      ? Number(liveSync.processed?.battleNet || 0)
      : Number(liveSync?.processed?.roster || 0);
  const syncTotal = Math.max(0, Number(liveSync?.totalMembers || 0));
  const liveSyncLabel = liveSync?.status === "running"
    ? `Фонова синхронізація · ${liveSync.phase === "raiderio" ? "Raider.IO" : liveSync.phase === "battlenet" ? "Battle.net профілі" : "склад Battle.net"}${syncTotal ? ` · ${Math.min(syncProcessed, syncTotal)}/${syncTotal}` : ""}`
    : null;

  const searchParams = useSearchParams();
  const currentUrl = listViewUrl("guild", `/guild?${searchParams}`) || "/guild";
  const view = readGuildRosterView(new URL(currentUrl, "https://list.invalid").searchParams);
  const maxRio = Math.max(0, Math.ceil(liveStats.maxRioAll || 0), view.rio.min, view.rio.max ?? 0);
  const maxItemLevel = Math.max(0, Math.ceil(liveStats.maxItemLevel || 0), view.ilvl.min, view.ilvl.max ?? 0);
  const [query, setQuery] = useState(view.q);
  const ownQuery = useRef<string | null>(null);
  useEffect(() => {
    if (ownQuery.current !== view.q) setQuery(view.q);
    ownQuery.current = null;
  }, [view.q]);
  const roleFilter = view.role, segment = view.segment, classFilter = view.className, specFilter = view.spec;
  const factionFilter = view.faction, raidFilter = view.raid, raidClearFilter = view.clear, linkFilter = view.link;
  const rioMin = view.rio.min, rioMax = view.rio.max ?? maxRio;
  const itemLevelMin = view.ilvl.min, itemLevelMax = view.ilvl.max ?? maxItemLevel;
  const sort = view.sort, filtersOpen = view.filtersOpen, page = view.page, pageSize = Number(view.size);
  const rioUpperBound = view.rio.max ?? Infinity, itemLevelUpperBound = view.ilvl.max ?? Infinity;

  function changeFilters(patch: Record<string, string | null>) {
    return replaceClientListLocation("guild", { ...patch, page: null });
  }
  function changeQuery(value: string) {
    setQuery(value);
    const href = changeFilters({ q: value });
    ownQuery.current = new URL(href, "https://list.invalid").searchParams.get("q") || "";
  }
  const setRoleFilter = (value: string) => changeFilters({ role: value });
  const setSegment = (value: string) => changeFilters({ segment: value });
  const setClassFilter = (value: string) => changeFilters({ class: value, spec: null });
  const setSpecFilter = (value: string) => changeFilters({ spec: value });
  const setFactionFilter = (value: string) => changeFilters({ faction: value });
  const setRaidFilter = (value: string) => changeFilters({ raid: value });
  const setRaidClearFilter = (value: string) => changeFilters({ clear: value });
  const setLinkFilter = (value: string) => changeFilters({ link: value });
  const setRioMin = (value: number) => changeFilters({ rioMin: String(value) });
  const setRioMax = (value: number) => changeFilters({ rioMax: String(value) });
  const setItemLevelMin = (value: number) => changeFilters({ ilvlMin: String(value) });
  const setItemLevelMax = (value: number) => changeFilters({ ilvlMax: String(value) });
  const setSort = (value: string) => changeFilters({ sort: value });
  const setPageSize = (value: number) => changeFilters({ size: String(value) });
  const setPage = (value: number) => replaceClientListLocation("guild", { page: String(value) });

  const options = useMemo(() => {
    const raidMap = new Map<string, string>();
    for (const slug of currentSeasonRaidSlugs(liveStats.raidSeasonSnapshot)) {
      const catalog = liveStats.raidSeasonSnapshot?.catalog?.[slug];
      raidMap.set(slug, catalog?.name || catalog?.shortName || slug);
    }
    for (const member of liveMembers) {
      for (const raid of currentSeasonRaidProgress(normalizedRaidProgress(member), liveStats.raidSeasonSnapshot)) {
        if (raid.slug && !/^tier-/i.test(raid.slug)) raidMap.set(raid.slug, raid.name || raid.slug);
      }
    }
    return {
      classes: uniqueSorted(liveMembers.map((member) => member.className)),
      specs: uniqueSorted(
        liveMembers
          .filter((member) => classFilter === "all" || member.className === classFilter)
          .map((member) => member.specName),
      ),
      factions: uniqueSorted(liveMembers.map((member) => member.faction)),
      raids: Array.from(raidMap.entries()).sort((a, b) => stableTextCompare(a[1], b[1])),
    };
  }, [liveMembers, liveStats.raidSeasonSnapshot, classFilter]);

  const raidStats = useMemo(() => {
    let profiles = 0;
    let heroicClears = 0;
    let mythicClears = 0;
    for (const member of liveMembers) {
      const raids = currentSeasonRaidProgress(normalizedRaidProgress(member), liveStats.raidSeasonSnapshot);
      if (raids.length) profiles += 1;
      const raid = bestRaid(member, liveStats.raidSeasonSnapshot);
      if (raidIsClear(raid, "heroic")) heroicClears += 1;
      if (raidIsClear(raid, "mythic")) mythicClears += 1;
    }
    return { profiles, heroicClears, mythicClears };
  }, [liveMembers, liveStats.raidSeasonSnapshot]);

  const filteredMembers = useMemo(() => {
    const search = query.trim().toLowerCase();
    const lowRio = rioMin, highRio = rioUpperBound;
    const lowIlvl = itemLevelMin, highIlvl = itemLevelUpperBound;

    return liveMembers
      .filter((member) => {
        const score = member.scores[segment] || 0;
        if (score < lowRio || score > highRio) return false;
        if (member.itemLevel < lowIlvl || member.itemLevel > highIlvl) return false;
        if (roleFilter !== "all" && member.role !== roleFilter) return false;
        if (classFilter !== "all" && member.className !== classFilter) return false;
        if (specFilter !== "all" && member.specName !== specFilter) return false;
        if (factionFilter !== "all" && member.faction !== factionFilter) return false;
        if (linkFilter === "profile" && !member.ownerProfileId) return false;
        if (linkFilter === "raiderio" && !member.profileUrl) return false;

        const raid = bestRaid(member, liveStats.raidSeasonSnapshot, raidFilter);
        if (raidFilter !== "all" && !raid) return false;
        if (raidClearFilter === "progress" && !raidHasProgress(raid)) return false;
        if (raidClearFilter === "normal-clear" && !raidIsClear(raid, "normal")) return false;
        if (raidClearFilter === "heroic-clear" && !raidIsClear(raid, "heroic")) return false;
        if (raidClearFilter === "mythic-clear" && !raidIsClear(raid, "mythic")) return false;
        if (raidClearFilter === "no-raid" && currentSeasonRaidProgress(normalizedRaidProgress(member), liveStats.raidSeasonSnapshot).length > 0) return false;

        if (!search) return true;
        const raidText = normalizedRaidProgress(member)
          .map((item) => `${item.name} ${item.summary || ""}`)
          .join(" ");
        return [
          member.name,
          member.realmName,
          member.realmSlug,
          member.className,
          member.specName,
          member.raceName,
          member.faction,
          member.ownerDisplayName || "",
          raidText,
        ].join(" ").toLowerCase().includes(search);
      })
      .sort((a, b) => compareGuildRosterMembers(a, b, sort, segment,
        (member) => raidWeight(bestRaid(member, liveStats.raidSeasonSnapshot, raidFilter))));
  }, [
    liveMembers,
    query,
    roleFilter,
    segment,
    classFilter,
    specFilter,
    factionFilter,
    raidFilter,
    raidClearFilter,
    linkFilter,
    rioMin,
    rioUpperBound,
    itemLevelMin,
    itemLevelUpperBound,
    sort,
    liveStats.raidSeasonSnapshot,
  ]);

  const activeFilterCount = useMemo(() => [
    query.trim() ? 1 : 0,
    roleFilter !== "all" ? 1 : 0,
    segment !== "all" ? 1 : 0,
    classFilter !== "all" ? 1 : 0,
    specFilter !== "all" ? 1 : 0,
    factionFilter !== "all" ? 1 : 0,
    raidFilter !== "all" ? 1 : 0,
    raidClearFilter !== "all" ? 1 : 0,
    linkFilter !== "all" ? 1 : 0,
    rioMin > 0 || Number.isFinite(rioUpperBound) ? 1 : 0,
    itemLevelMin > 0 || Number.isFinite(itemLevelUpperBound) ? 1 : 0,
  ].reduce((sum, value) => sum + value, 0), [
    query, roleFilter, segment, classFilter, specFilter, factionFilter,
    raidFilter, raidClearFilter, linkFilter, rioMin, rioUpperBound, itemLevelMin,
    itemLevelUpperBound,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredMembers.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pagedMembers = filteredMembers.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    if (liveMembers.length && page > pageCount) replaceClientListLocation("guild", { page: String(pageCount) });
  }, [page, pageCount, liveMembers.length]);

  function resetFilters() {
    changeFilters(Object.fromEntries(["q", "role", "segment", "class", "spec", "faction", "raid", "clear", "link", "rioMin", "rioMax", "ilvlMin", "ilvlMax", "sort"].map((key) => [key, null])));
    setQuery("");
    ownQuery.current = "";
  }
  const listMemory = <div className={styles.viewMemory}><ListViewMemory key={navigationScope} kind="guild" scope={navigationScope} currentUrl={currentUrl} clientLocation /></div>;

  if (!liveMembers.length) {
    const actions = <Button onClick={() => void rosterResource.refresh("guild-empty-retry", {force: true})}>Повторити</Button>;
    return <>{listMemory}{liveError || rosterResource.status === "error"
      ? <ErrorState title="Склад тимчасово недоступний" description="Не вдалося отримати склад гільдії. Спробуй оновити дані." actions={actions} />
      : <EmptyState title="Склад ще готується" description="Персонажі зʼявляться після завершення синхронізації." actions={actions} />}</>;
  }
  return <PageSection id="guild-roster-title" title="Персонажі гільдії" description="Пошук, ролі, спорядження та прогрес поточного сезону.">
    {listMemory}
    <FilterToolbar label="Пошук і фільтри складу" search={<FormField id="guild-roster-search" label="Пошук персонажа" type="search" maxLength={160} value={query} onChange={event => changeQuery(event.target.value)} placeholder="Імʼя, клас, спек або рейд" autoComplete="off" />}
      filters={<div className={styles.actions} aria-label="Швидкий фільтр ролі">{ROLE_FILTERS.map(item => <Button key={item.value} aria-pressed={roleFilter === item.value} onClick={() => setRoleFilter(item.value)}>{item.label}</Button>)}</div>}
      actions={<><Button onClick={() => replaceClientListLocation("guild", {filters: filtersOpen ? null : "1"})} aria-expanded={filtersOpen}>Фільтри{activeFilterCount ? ` · ${activeFilterCount}` : ""}</Button><Button onClick={resetFilters} disabled={!activeFilterCount}>Скинути</Button></>}
      result={`Знайдено ${filteredMembers.length} із ${liveMembers.length}`} />
    <dl className={styles.metrics} aria-label="Показники складу">
      <div><dt>Персонажів</dt><dd>{liveStats.memberCount || liveMembers.length}</dd></div>
      <div><dt>Показано</dt><dd>{filteredMembers.length}</dd></div>
      <div><dt>Сер. ilvl</dt><dd>{formatNumber(liveStats.averageItemLevel)}</dd></div>
      <div><dt>Топ M+</dt><dd>{formatNumber(liveStats.maxRioAll, 1)}</dd></div>
      <div><dt>Рейд-профілі</dt><dd>{raidStats.profiles}</dd></div>
      <div><dt>Heroic clear</dt><dd>{raidStats.heroicClears}</dd></div>
      <div><dt>Mythic clear</dt><dd>{raidStats.mythicClears}</dd></div>
    </dl>
      {filtersOpen ? (
        <FormSection title="Розширені фільтри"><div className={styles.filtersPanel}>
          <FilterSelect
            id="guild-rio-segment"
            label="RIO показник"
            value={segment}
            options={Object.entries(SEGMENT_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(value) => setSegment(value as GuildScoreSegment)}
          />
          <FilterSelect
            id="guild-class"
            label="Клас"
            value={classFilter}
            options={[{ value: "all", label: "Усі класи" }, ...options.classes.map((value) => ({ value, label: value }))]}
            onChange={setClassFilter}
          />
          <FilterSelect
            id="guild-spec"
            label="Спек"
            value={specFilter}
            options={[{ value: "all", label: "Усі спеки" }, ...options.specs.map((value) => ({ value, label: value }))]}
            onChange={setSpecFilter}
          />
          <FilterSelect
            id="guild-faction"
            label="Фракція"
            value={factionFilter}
            options={[{ value: "all", label: "Усі фракції" }, ...options.factions.map((value) => ({ value, label: value }))]}
            onChange={setFactionFilter}
          />
          <FilterSelect
            id="guild-raid"
            label="Рейд поточного сезону"
            value={raidFilter}
            options={[{ value: "all", label: "Основний рейд поточного сезону" }, ...options.raids.map(([value, label]) => ({ value, label }))]}
            onChange={setRaidFilter}
          />
          <FilterSelect
            id="guild-raid-clear"
            label="Закриття рейду"
            value={raidClearFilter}
            options={[
              { value: "all", label: "Будь-який прогрес" },
              { value: "progress", label: "Є прогрес" },
              { value: "normal-clear", label: "Normal закрито" },
              { value: "heroic-clear", label: "Heroic закрито" },
              { value: "mythic-clear", label: "Mythic закрито" },
              { value: "no-raid", label: "Без даних рейду" },
            ]}
            onChange={(value) => setRaidClearFilter(value as GuildRaidClearFilter)}
          />
          <FilterSelect
            id="guild-links"
            label="Зв’язок"
            value={linkFilter}
            options={[
              { value: "all", label: "Усі персонажі" },
              { value: "profile", label: "Є профіль сайту" },
              { value: "raiderio", label: "Є Raider.IO" },
            ]}
            onChange={(value) => setLinkFilter(value as GuildLinkFilter)}
          />
          <FilterSelect
            id="guild-sort"
            label="Сортування"
            value={sort}
            options={[
              { value: "rio-desc", label: "RIO: від більшого" },
              { value: "rio-asc", label: "RIO: від меншого" },
              { value: "ilvl-desc", label: "Item level: від більшого" },
              { value: "raid-desc", label: "Рейд-прогрес: від більшого" },
              { value: "name-asc", label: "Ім’я: А–Я" },
              { value: "rank-asc", label: "Гільдійний ранг" },
            ]}
            onChange={(value) => setSort(value as GuildRosterSort)}
          />
          <CompactRange id="guild-rio" label="RIO" minValue={rioMin} maxValue={rioMax} absoluteMax={maxRio} onMinChange={setRioMin} onMaxChange={setRioMax} />
          <CompactRange id="guild-ilvl" label="Item level" minValue={itemLevelMin} maxValue={itemLevelMax} absoluteMax={maxItemLevel} onMinChange={setItemLevelMin} onMaxChange={setItemLevelMax} />
          <div className={styles.filterActions}>
            <button type="button" className="btn subtle" onClick={resetFilters}>Скинути все</button>
            <small>База: {formatRosterDate(liveStats.updatedAt)}</small>
          </div>
        </div></FormSection>
      ) : null}


    <div className={styles.actions} role="status" aria-live="polite"><StatusBadge tone={rosterResource.status === "error" ? "warning" : "neutral"}>{rosterResource.status === "checking" ? "Оновлюємо дані" : rosterResource.status === "error" ? "Показано останні доступні дані" : "Дані синхронізовано"}</StatusBadge><small className={styles.metadata}>{liveSyncLabel || `Оновлено ${formatRosterDate(liveStats.updatedAt)}`} · {friendlySource(liveSource)}</small></div>
    {pagedMembers.length ? <GuildRosterTable members={pagedMembers} segment={segment} raidFilter={raidFilter} snapshot={liveStats.raidSeasonSnapshot} /> : <EmptyState title="Нікого не знайдено" description="Зміни пошук або скинь фільтри." actions={<Button onClick={resetFilters}>Скинути фільтри</Button>} />}
      <footer className={styles.footer}>
        <div className={styles.pageSize}>
          <span>На сторінці</span>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <small>Сторінка {safePage} / {pageCount} · {filteredMembers.length} результатів</small>
        <div className={styles.pagination}>
          <button type="button" className="btn subtle" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))}>Назад</button>
          <button type="button" className="btn subtle" disabled={safePage >= pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))}>Далі</button>
        </div>
      </footer>
  </PageSection>;
}
```

## src/components/GuildRosterLiveHeroStats.tsx

```tsx
"use client";

import { useMemo } from "react";
import GuildRosterRefreshButton, {
  type GuildRosterRefreshSettings,
} from "@/components/GuildRosterRefreshButton";
import type { GuildRosterMember, GuildRosterStats } from "@/lib/guildRoster";
import { useDashboardApiResource } from "@/lib/dashboardBackgroundApi";
import PageHeader from "@/components/page/PageHeader";
import styles from "./community/workspace.module.css";

type Props = {
  members: GuildRosterMember[];
  stats: GuildRosterStats;
  source: string;
  error?: string | null;
  refreshSettings?: GuildRosterRefreshSettings;
  allowManualRefresh?: boolean;
};

type GuildRosterLivePayload = Props & {
  ok?: boolean;
  memberCount?: number;
  updatedAt?: string | null;
  refresh?: unknown;
};

function formatDate(value?: string | null) {
  if (!value) return "очікується";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Kyiv",
  }).format(date);
}

function round(value: number) {
  return Math.round(value || 0).toLocaleString("uk-UA");
}

export default function GuildRosterLiveHeroStats({
  members,
  stats,
  source,
  error,
  refreshSettings,
  allowManualRefresh = false,
}: Props) {
  const initialRoster = useMemo<GuildRosterLivePayload>(
    () => ({ members, stats, source, error: error || null }),
    [members, stats, source, error],
  );
  const rosterResource = useDashboardApiResource<GuildRosterLivePayload>({
    key: "guild-roster",
    scope: "guild",
    initialData: initialRoster,
    minIntervalMs: 60_000,
    request: () => ({
      url: "/api/guild/refresh",
      method: "POST",
      headers: { "X-Dashboard-Action": "guild-roster-cache-sync" },
      json: { cacheOnly: true, includeMembers: true, includeStats: true, bypassCache: true },
      select: (payload) => {
        const data = payload as Partial<GuildRosterLivePayload> | null;
        return {
          members: Array.isArray(data?.members) ? data.members : members,
          stats: data?.stats || stats,
          source: typeof data?.source === "string" ? data.source : source,
          error: typeof data?.error === "string" ? data.error : null,
          ok: data?.ok,
          memberCount: data?.memberCount,
          updatedAt: data?.updatedAt,
          refresh: data?.refresh,
        };
      },
    }),
    refreshOnMount: false,
  });

  const liveMembers = rosterResource.data.members;
  const liveStats = rosterResource.data.stats || stats;
  const rioProfiles = liveMembers.filter((member) => member.hasRaiderIo).length;
  const raidProfiles = liveMembers.filter((member) => member.raidProgression?.length).length;

  const unavailable = Boolean(rosterResource.data.error && !liveMembers.length);
  return <PageHeader title="Склад гільдії" eyebrow={liveStats.guildName} description={`${liveStats.guildRealm} · ${liveStats.guildFaction}. Персонажі, спорядження та прогрес гільдії.`}
    breadcrumbs={[{label: "Склад гільдії"}]}
    actions={allowManualRefresh && refreshSettings ? <GuildRosterRefreshButton settings={refreshSettings} /> : undefined}
    metrics={[{label: "Персонажі",value: unavailable ? "—" : liveStats.memberCount.toLocaleString("uk-UA")},{label: "Середній RIO",value: unavailable ? "—" : round(liveStats.averageRioAll)},
      {label: "Середній ilvl",value: unavailable ? "—" : round(liveStats.averageItemLevel)},{label: "RIO-профілі",value: unavailable ? "—" : rioProfiles},{label: "Рейдові дані",value: unavailable ? "—" : raidProfiles},
      {label: "Оновлено",value: <span className={styles.metadata}>{formatDate(liveStats.updatedAt)}</span>}]} />;
}
```

## src/components/RaidArchiveLoadMore.tsx

```tsx
"use client";

import DataGrid from "@/components/page/DataGrid";
import styles from "@/components/raids/raid-workspace.module.css";
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
  return <div className={styles.archive} aria-live="polite">
    <DataGrid label="Архів рейдів" columns="two">{items.slice(0, safeVisibleCount)}</DataGrid>
    <div className={styles.archiveFooter}>
      <span className={styles.metadata}>Показано {safeVisibleCount} з {totalCount}</span>
      {remaining > 0 ? <button className="btn subtle" type="button" onClick={() => replaceClientListLocation("raids", { archive: String(Math.min(items.length, safeVisibleCount + pageSize)) })}>Ще {nextCount}</button> : null}
    </div>
  </div>;
}
```

## src/components/RaidPollActionResult.tsx

```tsx
import styles from "@/components/polls/poll-workspace.module.css";
export default function RaidPollActionResult({ message, href, unconfirmed = false }: { message: string; href: string; unconfirmed?: boolean }) {
  return <p className={styles.result} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="">
    {message}{unconfirmed ? <> <a href={href}>Перевірити стан</a></> : null}
  </p>;
}
```

## src/components/RaidPollActions.tsx

```tsx
"use client";

import DropdownMenu from "@/components/ui/DropdownMenu";
import styles from "@/components/polls/poll-workspace.module.css";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { useRaidPollMutation } from "@/hooks/useRaidPollMutation";
import RaidPollPauseButton from "@/components/RaidPollPauseButton";
import RaidPollActionResult from "@/components/RaidPollActionResult";

export type RaidPollActionState = "scheduled" | "open" | "paused" | "closed";

type Kind = "close" | "reopen" | "sync" | "delete";

/**
 * Раніше закриття йшло звичайною формою. DashboardFormEnhancer шле
 * Accept: application/json, тож роут відповідав JSON замість редіректу,
 * і сторінка списку не оновлювалась — картка лишалась «Активний».
 * Тепер усі дії роблять fetch + router.refresh().
 */
export default function RaidPollActions({
  pollId,
  pollTitle,
  state,
  canManage = false,
  editHref,
  messageUrl,
  redirectAfterDelete,
  showView = false,
  disabled = false,
}: {
  pollId: string;
  pollTitle: string;
  state: RaidPollActionState;
  canManage?: boolean;
  editHref?: string;
  messageUrl?: string | null;
  redirectAfterDelete?: string | null;
  showView?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const operation = useRaidPollMutation();
  const [kind, setKind] = useState<Kind | null>(null);
  const [pausePending, setPausePending] = useState(false);
  const locked = disabled || operation.pending || pausePending;
  const href = `/polls/${encodeURIComponent(pollId)}`;
  function run(nextKind: Kind, trigger: HTMLElement) {
    if (locked || !canManage) return;
    if (nextKind === "close") {
      const question = state === "scheduled"
        ? `Скасувати заплановану публікацію «${pollTitle}»?\n\nDiscord-повідомлення не буде створено, а автоповтор для цього плану буде вимкнено.`
        : `Закрити рейд-пул «${pollTitle}»?\n\nКнопки голосування в Discord стануть неактивними. Пул можна буде відкрити знову.`;
      if (!window.confirm(question)) return;
    }
    if (nextKind === "delete" && !window.confirm(`Видалити рейд-пул «${pollTitle}»?\n\nЗапис зникне з бази даних, Discord-повідомлення буде прибрано. Дію не можна скасувати.`)) return;
    setKind(nextKind);
    const endpoint = nextKind === "delete" ? `/api/polls/${encodeURIComponent(pollId)}`
      : nextKind === "sync" ? `/api/polls/${encodeURIComponent(pollId)}/discord-sync` : `/api/polls/${encodeURIComponent(pollId)}/close`;
    void operation.run(endpoint, { method: nextKind === "delete" ? "DELETE" : "POST", action: `${nextKind}-raid-poll`, json: nextKind === "close" || nextKind === "reopen" ? { action: nextKind } : undefined }, trigger, data => {
      notifyDashboardDataChanged({ scope: "raids", kind: "raid-poll", pollId, source: "poll-actions", action: `${nextKind}-raid-poll` });
      if (nextKind === "delete" && redirectAfterDelete) router.push(redirectAfterDelete);
      router.refresh();
      return {
        tone: data.discordDeleteFailed || data.warning ? "warning" : "success",
        title: nextKind === "close" ? (state === "scheduled" ? "План публікації скасовано" : "Рейд-пул закрито")
          : nextKind === "reopen" ? "Рейд-пул відкрито" : nextKind === "sync" ? (data.republished ? "Повідомлення опубліковано заново" : "Discord синхронізовано") : "Рейд-пул видалено",
        message: data.warning || (nextKind === "close" ? (state === "scheduled" ? "Пул не буде автоматично опубліковано в Discord." : "Кнопки голосування в Discord вимкнено, фінальний результат оновлено.")
          : nextKind === "reopen" ? "Голосування знову приймає голоси." : nextKind === "sync" ? (data.republished ? "Привʼязку повідомлення збережено. Онови стан публікації для подробиць." : "Embed і кнопки приведено у відповідність до стану на сайті.") : "Запис і Discord-повідомлення прибрано."),
        ttl: 6200,
      };
    });
  }
  const pending = operation.pending ? kind : null;
  return <div ref={operation.scopeRef} className={styles.actions} aria-busy={operation.pending || pausePending}>
    <RaidPollActionResult message={operation.message} unconfirmed={operation.unconfirmed} href={href} />
    {showView ? <a className="btn subtle poll-card__primary" href={href}>Результати</a> : null}
    {messageUrl ? <a className="btn subtle" href={messageUrl} target="_blank" rel="noreferrer">Discord</a> : null}
    {canManage ? <DropdownMenu label="Керування рейд-пулом" closeOnAction={false}>
    {canManage && editHref ? <a className="btn subtle" href={editHref}>Редагувати</a> : null}
    {canManage && state !== "closed" && state !== "scheduled" ? <RaidPollPauseButton pollId={pollId} paused={state === "paused"} disabled={disabled || operation.pending} onPendingChange={setPausePending} /> : null}
    {canManage && state !== "scheduled" ? <button className="btn subtle" type="button" onClick={event => run("sync", event.currentTarget)} disabled={locked} aria-busy={pending === "sync"}>{pending === "sync" ? "Синхронізуємо…" : "Синхронізувати Discord"}</button> : null}
    {canManage && state !== "closed" ? <button className="btn danger" type="button" onClick={event => run("close", event.currentTarget)} disabled={locked} aria-busy={pending === "close"}>{pending === "close" ? (state === "scheduled" ? "Скасовуємо…" : "Закриваємо…") : (state === "scheduled" ? "Скасувати план" : "Закрити")}</button> : null}
    {canManage && state === "closed" ? <button className="btn subtle" type="button" onClick={event => run("reopen", event.currentTarget)} disabled={locked} aria-busy={pending === "reopen"}>{pending === "reopen" ? "Відкриваємо…" : "Відкрити знову"}</button> : null}
    {canManage ? <button className="btn danger" type="button" onClick={event => run("delete", event.currentTarget)} disabled={locked} aria-busy={pending === "delete"}>{pending === "delete" ? "Видаляємо…" : "Видалити"}</button> : null}
    </DropdownMenu> : null}
  </div>;
}
```

## src/components/RaidPollBrowser.tsx

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { dispatchDashboardToast } from "@/lib/clientToasts";
import { requestRaidPollMutation, raidPollMutationFailure } from "@/lib/raidPollMutation";
import { useDashboardRequests } from "@/hooks/useDashboardRequests";
import { useActionFocus } from "@/hooks/useActionFocus";
import PollDirectoryCard from "@/components/polls/PollDirectoryCard";
import FilterToolbar from "@/components/page/FilterToolbar";
import EmptyState from "@/components/page/EmptyState";
import DataGrid from "@/components/page/DataGrid";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";
import styles from "@/components/polls/poll-workspace.module.css";

import ListViewMemory from "@/components/ListViewMemory";
import { listViewUrl } from "@/lib/listViewState";
import { replaceClientListLocation } from "@/lib/clientListLocation";

export type RaidPollCardModel = {
  id: string;
  shortId: string;
  title: string;
  description: string;
  difficulty: string;
  difficultyLabel: string;
  state: "scheduled" | "open" | "paused" | "closed";
  statusLabel: string;
  dayLabels: string[];
  votes: number;
  tanks: number;
  healers: number;
  dps: number;
  deadlineCaption: string;
  deadlineLabel: string;
  remainingLabel: string;
  recommendation: string;
  repeatLabel: string;
  autoRepeat: boolean;
  pausedNote: string | null;
  messageUrl: string | null;
};

type TabKey = "all" | "scheduled" | "open" | "paused" | "closed";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "all", label: "Усі" },
  { key: "scheduled", label: "Заплановані" },
  { key: "open", label: "Активні" },
  { key: "paused", label: "На паузі" },
  { key: "closed", label: "Архів" },
];

export default function RaidPollBrowser({
  cards,
  canManage = false,
  navigationScope,
}: {
  cards: RaidPollCardModel[];
  canManage?: boolean;
  createHref?: string;
  navigationScope: string;
}) {
  const counts = useMemo(
    () => ({
      all: cards.length,
      scheduled: cards.filter((card) => card.state === "scheduled").length,
      open: cards.filter((card) => card.state === "open").length,
      paused: cards.filter((card) => card.state === "paused").length,
      closed: cards.filter((card) => card.state === "closed").length,
    }),
    [cards],
  );

  const search = useSearchParams();
  const [initialTab] = useState<TabKey>(() => counts.scheduled ? "scheduled" : counts.open ? "open" : counts.paused ? "paused" : counts.closed ? "closed" : "all");
  const filters = new URL(listViewUrl("polls", `/polls?${search}`) || "/polls", "https://list.invalid").searchParams;
  if (!filters.has("tab")) filters.set("tab", search.get("view") === "all" ? "all" : initialTab);
  const currentUrl = listViewUrl("polls", `/polls?${filters}`) || "/polls";
  const tab = (filters.get("tab") || "all") as TabKey;
  const urlQuery = filters.get("q") || "";
  const [query, setQuery] = useState(urlQuery);
  const ownQuery = useRef<string | null>(null);
  useEffect(() => {
    if (ownQuery.current !== urlQuery) setQuery(urlQuery);
    ownQuery.current = null;
  }, [urlQuery]);
  function changeQuery(value: string) {
    setQuery(value); setSelected([]);
    const href = replaceClientListLocation("polls", { q: value });
    ownQuery.current = new URL(href, "https://list.invalid").searchParams.get("q") || "";
  }
  function changeTab(value: TabKey) {
    setSelected([]);
    replaceClientListLocation("polls", { tab: value });
  }
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkPending, setBulkPending] = useState(false);
  type ItemResult = { id: string; title: string; outcome: "confirmed" | "partial" | "rejected" | "unconfirmed"; message: string };
  const [results, setResults] = useState<ItemResult[]>([]);
  const [resultKind, setResultKind] = useState<"close" | "delete" | null>(null);
  const [summary, setSummary] = useState("");
  const requests = useDashboardRequests();
  const { scopeRef, beginActionFocus } = useActionFocus<HTMLElement>(bulkPending);
  const router = useRouter();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (tab !== "all" && card.state !== tab) return false;
      if (!needle) return true;
      return `${card.title} ${card.description} ${card.difficultyLabel} ${card.id}`.toLowerCase().includes(needle);
    });
  }, [cards, tab, query]);

  const visibleIds = new Set(visible.map(card => card.id));
  const visibleSelection = selected.filter(id => visibleIds.has(id));


  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  /**
   * Масові дії йдуть послідовно, а не Promise.all: паралельні виклики
   * вперлися б у rate limit Discord і частина пулів лишилась би
   * неоновленою без жодного сигналу користувачу.
   */
  async function runBulk(kind: "close" | "delete", trigger: HTMLElement) {
    if (!canManage || requests.pending("bulk") || bulkPending || !visibleSelection.length) return;
    const scheduledSelected = visible.filter(card => card.state === "scheduled" && visibleSelection.includes(card.id)).length;
    const question = kind === "close"
      ? `Закрити вибрані рейд-пули (${visibleSelection.length})?${scheduledSelected ? `\n\nЗапланованих: ${scheduledSelected}. Їхню публікацію буде скасовано, а автоповтор вимкнено.` : ""}`
      : `Видалити вибрані рейд-пули (${visibleSelection.length})? Дію не можна скасувати.`;
    if (!window.confirm(question)) return;

    const request = requests.begin("bulk", Math.max(45_000, visibleSelection.length * 45_000));
    beginActionFocus(trigger, { preferResult: true });
    setBulkPending(true); setResultKind(kind); setResults([]); setSummary(`Обробляємо: 0 з ${visibleSelection.length}.`);
    const items: ItemResult[] = [];
    try {
      for (const id of visibleSelection) {
        if (!request.current()) return;
        const title = cards.find(card => card.id === id)?.title || id;
        try {
          const data = await requestRaidPollMutation(kind === "delete" ? `/api/polls/${encodeURIComponent(id)}` : `/api/polls/${encodeURIComponent(id)}/close`, {
            method: kind === "delete" ? "DELETE" : "POST", action: `bulk-${kind}-raid-poll`, signal: request.signal, json: kind === "close" ? { action: "close" } : undefined,
          });
          if (!request.current()) return;
          const partial = Boolean(data.warning || data.discordDeleteFailed);
          items.push({ id, title, outcome: partial ? "partial" : "confirmed", message: data.warning || (partial ? "Запис змінено, оновлення Discord потребує перевірки." : "Сервер підтвердив виконання.") });
        } catch (error) {
          if (!request.current()) return;
          items.push({ id, title, ...raidPollMutationFailure(error) });
        }
        setResults([...items]); setSummary(`Оброблено: ${items.length} з ${visibleSelection.length}.`);
      }
      const count = (outcome: ItemResult["outcome"]) => items.filter(item => item.outcome === outcome).length;
      const confirmed = count("confirmed"), partial = count("partial"), rejected = count("rejected"), unconfirmed = count("unconfirmed");
      const message = `Підтверджено: ${confirmed}. Частково: ${partial}. Відхилено: ${rejected}. Не підтверджено: ${unconfirmed}.`;
      setSummary(message);
      // Unknown outcomes must not remain selected for an accidental bulk replay.
      setSelected(items.filter(item => item.outcome === "rejected").map(item => item.id));
      dispatchDashboardToast({ tone: partial || rejected || unconfirmed ? "warning" : "success", title: partial || rejected || unconfirmed ? "Обробку завершено з зауваженнями" : kind === "close" ? "Рейд-пули закрито" : "Рейд-пули видалено", message, ttl: 7200 });
      if (confirmed || partial) router.refresh();
    } finally {
      if (request.current()) setBulkPending(false);
      request.finish();
    }
  }

  return (
    <section ref={scopeRef} className={styles.stack} aria-label="Список рейд-пулів" aria-busy={bulkPending}>
      <ListViewMemory key={navigationScope} kind="polls" scope={navigationScope} currentUrl={currentUrl} />
      <FilterToolbar label="Пошук і фільтри рейд-пулів" search={<FormField label="Пошук рейд-пулу" type="search" maxLength={160} value={query} disabled={bulkPending} onChange={event => changeQuery(event.target.value)} placeholder="Назва, складність або ID" autoComplete="off" />}
        filters={<label>Стан<select value={tab} disabled={bulkPending} onChange={event => changeTab(event.target.value as TabKey)}>{TABS.map(item => <option key={item.key} value={item.key}>{item.label} ({counts[item.key]})</option>)}</select></label>}
        actions={<Button disabled={bulkPending || !query && tab === "all"} onClick={() => {setSelected([]);setQuery("");replaceClientListLocation("polls", {q: null,tab: "all",view: "all"});}}>Скинути</Button>}
        result={`Показано ${visible.length} із ${cards.length}`} />
      <p className={styles.result} role="status" aria-live="polite" aria-atomic="true" tabIndex={-1} data-action-result="" data-bulk-result="">{summary}</p>
      {results.length ? <ul className={styles.results} aria-label="Результати масової дії">{results.map(item => <li key={item.id} data-poll-outcome={item.outcome}><strong>{item.title}</strong><span>{item.message}</span><a href={resultKind === "delete" && (item.outcome === "confirmed" || item.outcome === "partial") ? "/polls" : `/polls/${encodeURIComponent(item.id)}`}>{resultKind === "delete" && (item.outcome === "confirmed" || item.outcome === "partial") ? "До списку рейд-пулів" : "Перевірити стан"}</a></li>)}</ul> : null}
      {canManage && visibleSelection.length ? (
        <div className={styles.bulk} role="region" aria-label="Масові дії">
          <strong>Вибрано: {visibleSelection.length}</strong>
          <button type="button" className="btn subtle" onClick={() => setSelected([])} disabled={bulkPending}>Зняти вибір</button>
          <button type="button" className="btn subtle" onClick={() => setSelected(visible.map((card) => card.id))} disabled={bulkPending}>
            Вибрати всі у вкладці
          </button>
          <button type="button" className="btn danger" onClick={event => void runBulk("close", event.currentTarget)} disabled={bulkPending}>
            {bulkPending ? "Обробляємо…" : tab === "scheduled" ? "Скасувати заплановані" : "Закрити вибрані"}
          </button>
          <button type="button" className="btn danger" onClick={event => void runBulk("delete", event.currentTarget)} disabled={bulkPending}>
            {bulkPending ? "Обробляємо…" : "Видалити вибрані"}
          </button>
        </div>
      ) : null}

      <DataGrid label="Рейд-пули" columns="two">
        {visible.length ? (
          visible.map((card) => (
            <PollDirectoryCard
              key={card.id}
              card={card}
              canManage={canManage}
              selected={visibleSelection.includes(card.id)}
              selectionDisabled={bulkPending}
              onToggle={toggle}
            />
          ))
        ) : (
          <EmptyState title={query.trim() ? "Нічого не знайдено" : "У цьому списку поки немає пулів"} description="Зміни пошук або стан, щоб переглянути інші голосування." actions={<Button onClick={() => {changeQuery("");changeTab("all");}}>Показати всі</Button>} />
        )}
      </DataGrid>
    </section>
  );
}
```

## src/components/RaidPollPauseButton.tsx

```tsx
"use client";
import styles from "@/components/polls/poll-workspace.module.css";

import { useRouter } from "next/navigation";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { useRaidPollMutation } from "@/hooks/useRaidPollMutation";
import RaidPollActionResult from "@/components/RaidPollActionResult";

export default function RaidPollPauseButton({ pollId, paused, compact = false, disabled = false, onPendingChange }: {
  pollId: string; paused: boolean; compact?: boolean; disabled?: boolean; onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const operation = useRaidPollMutation(onPendingChange);
  const action = paused ? "resume" : "pause";
  function toggle(trigger: HTMLElement) {
    if (disabled) return;
    void operation.run(`/api/polls/${encodeURIComponent(pollId)}/pause`, { method: "POST", action: `${action}-raid-poll`, json: { action } }, trigger, () => {
      notifyDashboardDataChanged({ scope: "raids", kind: "raid-poll", source: "site-pause", pollId, action: `${action}-raid-poll` });
      router.refresh();
      return { tone: "success", title: paused ? "Рейд-пул відновлено" : "Рейд-пул на паузі", message: paused ? "Голоси знову приймаються, залишок часу повернено без втрат." : "Час до закриття заморожено, Discord-кнопки вимкнено.", ttl: 6200 };
    });
  }
  const label = operation.pending ? (paused ? "Відновлюємо…" : "Ставимо на паузу…") : (paused ? "Відновити" : "Пауза");
  return <div ref={operation.scopeRef} className={styles.actions} aria-busy={operation.pending}>
    <RaidPollActionResult message={operation.message} unconfirmed={operation.unconfirmed} href={`/polls/${encodeURIComponent(pollId)}`} />
    <button className="btn subtle" type="button" onClick={event => toggle(event.currentTarget)} disabled={disabled || operation.pending} aria-busy={operation.pending} aria-label={compact ? label : undefined} title={paused ? "Відновити голосування і повернути заморожений час" : "Призупинити голосування без втрати часу та голосів"}>
      <span aria-hidden="true">{paused ? "▶" : "⏸"}</span>{compact ? null : <span>{label}</span>}
    </button>
  </div>;
}
```

## src/components/RaidPollRecalculateButton.tsx

```tsx
"use client";
import styles from "@/components/polls/poll-workspace.module.css";

import { useRouter } from "next/navigation";
import { notifyDashboardDataChanged } from "@/lib/dashboardLiveRefresh";
import { useRaidPollMutation } from "@/hooks/useRaidPollMutation";
import RaidPollActionResult from "@/components/RaidPollActionResult";

export default function RaidPollRecalculateButton() {
  const router = useRouter();
  const operation = useRaidPollMutation();
  function recalculate(trigger: HTMLElement) {
    void operation.run("/api/polls/recalculate-recommendations", { method: "POST", action: "recalculate-raid-poll-recommendations" }, trigger, data => {
      const updated = data.updated ?? 0, failed = data.failed ?? 0;
      notifyDashboardDataChanged({ scope: "raids", kind: "raid-poll", source: "site-recalculate", action: "recalculate-raid-poll-recommendations" });
      router.refresh();
      return { tone: failed ? "warning" : "success", title: failed ? "Перерахунок частковий" : "Дні перераховано", message: failed ? `Оновлено ${updated}, з помилкою ${failed}. Перевір логи Discord/бази даних.` : `Оновлено ${updated} Discord-повідомлень без перетину рекомендованих днів.`, ttl: 7200 };
    });
  }
  return <div ref={operation.scopeRef} className={styles.actions} aria-busy={operation.pending}>
    <RaidPollActionResult message={operation.message} unconfirmed={operation.unconfirmed} href="/polls" />
    <button className="btn subtle" type="button" onClick={event => recalculate(event.currentTarget)} disabled={operation.pending} aria-busy={operation.pending}>{operation.pending ? "Рахуємо..." : "Перерахувати дні Discord"}</button>
  </div>;
}
```

## src/components/RaidPollViews.tsx

```tsx
import type { ReactNode } from "react";
import RaidPollCreateClientForm from "@/components/RaidPollCreateClientForm";

import DashboardIdentity from "@/components/DashboardIdentity";
import type { DashboardSession } from "@/lib/auth";
import type { DiscordRoleOption } from "@/components/DiscordEmbedEditor";
import { type RaidPollItem } from "@/lib/raidPolls";

export type PollChannelOption = { id: string; name: string };

export function RaidPollPageShell({
  user,
  title,
  description,
  eyebrow = "Mistblossom Vanguard • Голосування",
  stats = [],
  actions,
  activeSection = "polls",
  children,
}: {
  user?: DashboardSession | null;
  title: string;
  description: string;
  eyebrow?: string;
  stats?: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
  activeSection?: "polls" | "raids";
  children: ReactNode;
}) {
  return (
    <main className="container app-page raid-page raid-poll-page poll-page">
      <section className="dashboard-shell content-shell raid-shell app-page-stack" aria-label="Панель рейд-пулів Mistblossom Vanguard">
        <DashboardIdentity user={user || null} activeSection={activeSection} />

        {/* Спрощений херо: один рядок сенсу + компактна стрічка метрик замість
            важкої бічної панелі, яка займала половину першого екрана. */}
        <header className="poll-hero">
          <div className="poll-hero__copy">
            <span className="poll-hero__eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>

          {stats.length ? (
            <dl className="poll-hero__stats">
              {stats.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {actions ? <div className="poll-hero__actions">{actions}</div> : null}
        </header>

        {children}
      </section>
    </main>
  );
}

export function RaidPollCreateForm({ channels, roles = [], discordEnabled }: { channels: PollChannelOption[]; roles?: DiscordRoleOption[]; discordEnabled: boolean }) {
  return <RaidPollCreateClientForm channels={channels} roles={roles} defaultChannelId={channels[0]?.id || ""} disabled={!discordEnabled} />;
}

export function RaidPollEditForm({ poll, channels, roles = [], discordEnabled }: { poll: RaidPollItem; channels: PollChannelOption[]; roles?: DiscordRoleOption[]; discordEnabled: boolean }) {
  return <RaidPollCreateClientForm poll={poll} channels={channels} roles={roles} defaultChannelId={poll.channelId || channels[0]?.id || ""} disabled={!discordEnabled} />;
}

export {buildRaidPollCardModel} from "@/lib/raidPollPresentation";
export {default as RaidPollList} from "@/components/polls/PollDirectoryList";
export {default as RaidPollResults} from "@/components/polls/PollResults";
```

## src/components/RaidViews.tsx

```tsx
import { raidStatusLabel, raidStatusClass } from "@/lib/raidPresentation";

import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import RaidRoleMentionPicker from "@/components/RaidRoleMentionPicker";
import RaidImagePicker from "@/components/RaidImagePicker";
import RaidEditorFormEnhancer from "@/components/RaidEditorFormEnhancer";
import type { DiscordRoleOption } from "@/components/DiscordEmbedEditor";

import type { DashboardSession } from "@/lib/auth";
import { hierarchyTitle } from "@/lib/permissions";

import { isInternalRaidThumbnail } from "@/lib/raidThumbnailAssets";
import { isRaidClosed, raidAutoCompositionLabel, type RaidItem } from "@/lib/raids";
import { todayIso } from "@/components/RaidSignupPresentation";

// Реекспорт для сумісності: раніше ці помічники жили тут.
export { formatRaidDateTime, todayIso } from "@/components/RaidSignupPresentation";

export type RaidChannelOption = { id: string; name: string };
export type RaidRoleOption = DiscordRoleOption;

export function attendanceStatusLabel(action?: string) {
  if (action === "skipped") return "Позначено, що ти пропускаєш рейд.";
  if (action === "late")
    return "Записано: ти затримаєшся. Склад рейду оновлено.";
  if (action === "tentative")
    return "Записано 50/50. За потреби цей запис піде в лаву запасних після сірого списку.";
  if (action === "going") return "Тебе записали на рейд. Склад рейду оновлено.";
  return "Дію виконано.";
}

export function StatusNotice({
  params: _params,
}: {
  params: Record<string, string | undefined>;
}) {
  return null;
}

export {default as RaidManageActions} from "@/components/raids/RaidManageActions";
export {default as RaidAnnouncementPreview} from "@/components/raids/RaidOverview";
export {default as RaidListCard} from "@/components/raids/RaidDirectoryCard";
export {RosterSideList, signupDisplayName} from "@/components/raids/RaidRoster";

export function RaidForm({
  raid,
  channels,
  voiceChannels = [],
  roles = [],
  discordEnabled = true,
  defaultChannelId = "",
  defaultVoiceChannelId = "",
  editorAccountName = "",
  publicationPending = false,
  publicationEventPending = false,
}: {
  raid?: RaidItem | null;
  channels: RaidChannelOption[];
  voiceChannels?: RaidChannelOption[];
  roles?: RaidRoleOption[];
  discordEnabled?: boolean;
  defaultChannelId?: string;
  defaultVoiceChannelId?: string;
  editorAccountName?: string;
  publicationPending?: boolean;
  publicationEventPending?: boolean;
}) {
  const defaultComposition = raid
    ? raidAutoCompositionLabel(raid).replace(/\s/g, "")
    : "0/0/0";
  const channelOptions =
    raid?.channelId &&
    !channels.some((channel) => channel.id === raid.channelId)
      ? [{ id: raid.channelId, name: "поточний канал" }, ...channels]
      : channels;
  const voiceChannelOptions =
    raid?.voiceChannelId &&
    !voiceChannels.some((channel) => channel.id === raid.voiceChannelId)
      ? [{ id: raid.voiceChannelId, name: "поточний голосовий канал" }, ...voiceChannels]
      : voiceChannels;
  const selectedChannelId = raid?.channelId || defaultChannelId || channelOptions[0]?.id || "";
  const selectedVoiceChannelId = raid?.voiceChannelId || defaultVoiceChannelId || voiceChannelOptions[0]?.id || "";
  const selectedMentionRoleIds = Array.from(
    new Set((raid?.mentionRoleIds || []).filter(Boolean)),
  );
  const activeSignupCount = raid
    ? raid.signups.filter(
        (signup) =>
          signup.status === "going" ||
          signup.status === "late" ||
          signup.status === "tentative",
      ).length
    : 0;
  const isExistingRaid = Boolean(raid?.id);
  const isDiscordPublished = Boolean(
    raid?.channelId && raid?.messageId && raid?.status !== "draft",
  );
  const canPublish = discordEnabled && (publicationPending || publicationEventPending || !(raid ? isRaidClosed(raid) : false));
  const saveLabel =
    isExistingRaid && raid?.status !== "draft"
      ? "Зберегти без публікації"
      : "Зберегти чернетку";
  const publishLabel = publicationPending || publicationEventPending ? "Перевірити Discord" : isDiscordPublished
    ? "Оновити Discord"
    : "Опублікувати в Discord";
  const initialSaveState = isExistingRaid
    ? "Усі завантажені зміни збережені"
    : "Новий рейд ще не збережено";

  return (
    <div className="raid-form-stack">
      <RaidEditorFormEnhancer />
      <form
        className="panel raid-form-panel raid-form-panel--modern"
        action="/api/raids"
        method="post"
        data-raid-editor-form="true"
        data-existing-raid={isExistingRaid ? "true" : "false"}
      >
        <input type="hidden" name="raidId" value={raid?.id || ""} />
        {!raid?.id ? <input type="hidden" name="creationToken" value={randomUUID()} /> : null}
        <input type="hidden" name="composition" value={defaultComposition} />

        <div className="raid-form-heading">
          <div>
            <div className="section-title">
              {raid?.id ? "Редагування рейду" : "Створення рейду"}
            </div>
            <p>
              Заповнюй форму зверху вниз. Чернетка змінює тільки сайт, а
              публікація створює або оновлює Discord-оголошення.
            </p>
            <nav className="raid-editor-jump-nav" aria-label="Розділи форми рейду">
              <a href="#raid-editor-main">Основне</a>
              <a href="#raid-editor-rules">Запис</a>
              <a href="#raid-editor-discord">Discord</a>
              <a href="#raid-editor-content">Оформлення</a>
              <a href="#raid-editor-publish">Публікація</a>
            </nav>
          </div>
          <div className="raid-form-heading-status">
            {raid ? (
              <em className={`raid-state raid-state--${raidStatusClass(raid)}`}>
                {raidStatusLabel(raid)}
              </em>
            ) : (
              <em className="raid-state raid-state--draft">Новий</em>
            )}
            <small>{defaultComposition} • склад формується автоматично</small>
          </div>
        </div>

        <section
          className="raid-form-section raid-form-section--core"
          id="raid-editor-main"
          aria-labelledby="raid-editor-main-title"
        >
          <div className="raid-form-section-heading">
            <span className="raid-form-step" aria-hidden="true">01</span>
            <div>
              <strong id="raid-editor-main-title">Основне</strong>
              <p>Назва, складність, дата, час і відповідальний рейд-лідер.</p>
            </div>
          </div>

          <label className="field-label">
            Назва рейду
            <input
              className="input"
              name="title"
              defaultValue={raid?.title || "Войдспайр"}
              maxLength={120}
              required
            />
          </label>
          <label className="field-label">
            Складність
            <select
              className="select"
              name="difficulty"
              defaultValue={raid?.difficulty || "heroic"}
            >
              <option value="normal">Нормал</option>
              <option value="heroic">Героїк</option>
              <option value="mythic">Міфік</option>
            </select>
          </label>
          <label className="field-label">
            Дата
            <input
              className="input"
              type="date"
              name="date"
              defaultValue={raid?.date || todayIso()}
              required
            />
          </label>
          <label className="field-label">
            Час
            <input
              className="input"
              type="time"
              name="time"
              defaultValue={raid?.time || "20:00"}
              required
            />
          </label>
          <label className="field-label raid-field--wide">
            Рейд-лідер / РЛ
            <input
              className="input"
              name="raidLeaderName"
              placeholder="Напр. Sebas"
              defaultValue={raid?.raidLeaderName || ""}
              maxLength={120}
            />
            <small>
              Необов’язково. Якщо залишити порожнім, блок РЛ у Discord не
              показуватиметься.
            </small>
          </label>
        </section>

        <section
          className="raid-form-section raid-form-section--rules"
          id="raid-editor-rules"
          aria-labelledby="raid-editor-rules-title"
        >
          <div className="raid-form-section-heading">
            <span className="raid-form-step" aria-hidden="true">02</span>
            <div>
              <strong id="raid-editor-rules-title">Правила запису</strong>
              <p>Ліміти, вимоги до спорядження та автоматичний дедлайн.</p>
            </div>
          </div>

          <div className="raid-setting-card">
            <div className="raid-setting-card__head">
              <strong>Item level</strong>
              <span>Фільтр спорядження</span>
            </div>
            <label className="field-label">
              Мінімальний item level
              <input
                className="input"
                type="number"
                name="minItemLevel"
                min="1"
                max="9999"
                step="1"
                placeholder="Напр. 675"
                defaultValue={raid?.minItemLevel || ""}
              />
              <small>Порожнє поле повністю вимикає перевірку ilvl.</small>
            </label>
            <label className="raid-checkbox-line raid-dependent-control">
              <input
                type="checkbox"
                name="minItemLevelRequired"
                value="1"
                defaultChecked={Boolean(raid?.minItemLevelRequired)}
              />
              <span>
                <strong>Блокувати нижчий ilvl</strong>
                <small>Без цього перемикача система лише попереджає.</small>
              </span>
            </label>
          </div>

          <div className="raid-setting-card">
            <div className="raid-setting-card__head">
              <strong>Місткість</strong>
              <span>Ліміт активних записів</span>
            </div>
            <label className="field-label">
              Максимум гравців
              <input
                className="input"
                type="number"
                name="maxPlayers"
                min={Math.max(1, activeSignupCount || 1)}
                max="80"
                step="1"
                placeholder="Напр. 20"
                defaultValue={raid?.maxPlayers || ""}
              />
              <small>
                {activeSignupCount > 0
                  ? `Зараз активних записів: ${activeSignupCount}. Менше цього значення зберегти не можна.`
                  : "Порожньо — без жорсткого ліміту, склад масштабується автоматично."}
              </small>
            </label>
          </div>

          <div className="raid-setting-card raid-setting-card--deadline">
            <div className="raid-setting-card__head">
              <strong>Дедлайн</strong>
              <span>Автоматичне закриття запису</span>
            </div>
            <label className="raid-checkbox-line raid-checkbox-line--primary">
              <input
                type="checkbox"
                name="registrationLockEnabled"
                value="1"
                defaultChecked={Boolean(raid?.registrationLockEnabled)}
              />
              <span>
                <strong>Закривати запис до старту</strong>
                <small>Після дедлайну кнопки запису в Discord стають неактивними.</small>
              </span>
            </label>
            <label className="field-label raid-dependent-field">
              Коли закрити запис
              <select
                className="select"
                name="registrationLockMinutesBefore"
                defaultValue={String(raid?.registrationLockMinutesBefore || 60)}
              >
                <option value="30">За 30 хв</option>
                <option value="60">За 1 год</option>
                <option value="120">За 2 год</option>
                <option value="180">За 3 год</option>
                <option value="1440">За 1 день</option>
              </select>
            </label>
            <span
              className="raid-setting-status"
              data-raid-registration-deadline
              aria-live="polite"
            >
              Дедлайн буде розраховано за датою та часом рейду.
            </span>
          </div>

          <div className="raid-auto-composition-note">
            <strong>Склад формується автоматично • {defaultComposition}</strong>
            <span>
              Максимум 2 танки на рейд, кількість хілів масштабується від паті,
              а ДД добираються з урахуванням критичних бафів та балансу
              мілі/рендж. Якщо задано максимум гравців, схема рахується від
              цього ліміту.
            </span>
          </div>
        </section>

        <section
          className="raid-form-section raid-form-section--discord"
          id="raid-editor-discord"
          aria-labelledby="raid-editor-discord-title"
        >
          <div className="raid-form-section-heading">
            <span className="raid-form-step" aria-hidden="true">03</span>
            <div>
              <strong id="raid-editor-discord-title">Discord і правила рейду</strong>
              <p>Канал публікації, лут, розхідники та ролі для згадки.</p>
            </div>
          </div>

          <label className="field-label raid-field--wide">
            Канал Discord
            {channelOptions.length ? (
              <select
                className="select"
                name="channelId"
                defaultValue={selectedChannelId}
                disabled={!discordEnabled}
              >
                {channelOptions.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                name="channelId"
                inputMode="numeric"
                pattern="[0-9]{16,25}"
                maxLength={25}
                autoComplete="off"
                placeholder="ID текстового каналу Discord"
                defaultValue={selectedChannelId}
                disabled={!discordEnabled}
                required={discordEnabled}
              />
            )}
            {!discordEnabled ? (
              <small>Discord зараз недоступний — дані можна зберегти як чернетку.</small>
            ) : !channelOptions.length ? (
              <small>
                Список каналів не прочитався автоматично. Встав ID каналу
                вручну або перевір Discord-конфігурацію сервера.
              </small>
            ) : (
              <small>Саме в цей канал піде нове або оновлене оголошення.</small>
            )}
          </label>

          <label className="field-label raid-field--wide">
            Голосовий канал рейду
            {voiceChannelOptions.length ? (
              <select
                className="select"
                name="voiceChannelId"
                defaultValue={selectedVoiceChannelId}
                disabled={!discordEnabled}
              >
                <option value="">Не вибрано</option>
                {voiceChannelOptions.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    🔊 {channel.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                name="voiceChannelId"
                inputMode="numeric"
                pattern="[0-9]{16,25}"
                maxLength={25}
                autoComplete="off"
                placeholder="ID голосового каналу Discord (необов’язково)"
                defaultValue={selectedVoiceChannelId}
                disabled={!discordEnabled}
              />
            )}
            <small>
              Використовується в нагадуванні за 15 хвилин і в приватних повідомленнях учасникам.
              {editorAccountName ? ` Останній вибір запам’ятовується для акаунта ${editorAccountName}.` : ""}
            </small>
          </label>

          <div className="raid-setting-card raid-field--wide">
            <div className="raid-setting-card__head">
              <strong>Discord-подія</strong>
              <span>Scheduled Event сервера</span>
            </div>
            <label className="raid-checkbox-line raid-checkbox-line--primary">
              <input
                type="checkbox"
                name="discordEventEnabled"
                value="1"
                defaultChecked={raid?.discordEventEnabled !== false}
              />
              <span>
                <strong>Створювати подію разом із рейдом</strong>
                <small>Під час публікації Dashboard створить або оновить Discord Scheduled Event за датою й часом рейду.</small>
              </span>
            </label>
            <label className="field-label raid-dependent-field">
              Тривалість події
              <select
                className="select"
                name="discordEventDurationMinutes"
                defaultValue={String(raid?.discordEventDurationMinutes || 180)}
              >
                <option value="120">2 години</option>
                <option value="180">3 години</option>
                <option value="240">4 години</option>
                <option value="300">5 годин</option>
                <option value="360">6 годин</option>
              </select>
              <small>External event автоматично стартує й завершується в Discord за цим інтервалом.</small>
            </label>
            {raid?.discordEventLastError ? (
              <span className="raid-setting-status is-warning">
                ⚠ Остання синхронізація події: {raid.discordEventLastError}
              </span>
            ) : raid?.discordEventUrl ? (
              <a className="raid-message-link" href={raid.discordEventUrl} target="_blank" rel="noreferrer">
                📅 Відкрити Discord-подію
              </a>
            ) : (
              <span className="raid-setting-status">Подія буде створена під час публікації рейду.</span>
            )}
          </div>

          <label className="field-label">
            Розхідники
            <select
              className="select"
              name="consumables"
              defaultValue={raid?.consumables || "own"}
            >
              <option value="own">Власні</option>
              <option value="guild">Гільдійні</option>
            </select>
          </label>
          <label className="field-label">
            Лут
            <select
              className="select"
              name="lootMode"
              defaultValue={raid?.lootMode || "ms-os"}
            >
              <option value="ms-os">MS &gt; OS</option>
              <option value="free-roll">Вільний рол</option>
              <option value="soft-reserve">Soft Reserve</option>
              <option value="loot-council">Loot Council</option>
            </select>
          </label>

          <div className="raid-discord-role-block">
            <div className="raid-discord-role-block__head">
              <strong>Кого тегнути</strong>
              <span>Ролі з’являться над Discord embed.</span>
            </div>
            <RaidRoleMentionPicker
              roles={roles}
              selectedRoleIds={selectedMentionRoleIds}
            />
          </div>
        </section>

        <section
          className="raid-form-section raid-form-section--content"
          id="raid-editor-content"
          aria-labelledby="raid-editor-content-title"
        >
          <div className="raid-form-section-heading">
            <span className="raid-form-step" aria-hidden="true">04</span>
            <div>
              <strong id="raid-editor-content-title">Опис і візуал</strong>
              <p>Текст оголошення, мініатюра та велике зображення рейду.</p>
            </div>
          </div>

          <label className="field-label raid-field--wide">
            Опис
            <textarea
              className="input textarea markdown-area raid-description-textarea"
              name="description"
              rows={8}
              maxLength={4096}
              defaultValue={
                raid?.description ||
                "Глибоко в серці темної цитаделі нас чекають давні таємниці та смертельні вороги.\n\nБудьте готові до суворого випробування!"
              }
            />
            <small>
              Підтримується Discord Markdown: жирний текст, курсив, списки,
              заголовки, цитати, посилання й код.
            </small>
          </label>
          <label className="field-label raid-field--wide">
            Мініатюра / іконка
            <input
              className="input"
              name="thumbnailUrl"
              type="url"
              inputMode="url"
              maxLength={2048}
              autoComplete="url"
              placeholder="https://..."
              defaultValue={
                raid?.thumbnailUrl && !isInternalRaidThumbnail(raid.thumbnailUrl)
                  ? raid.thumbnailUrl
                  : ""
              }
            />
            <small>
              Залиш порожнім для автоматичної мініатюри за складністю. Власний URL
              завжди має пріоритет.
            </small>
          </label>
          <RaidImagePicker defaultValue={raid?.imageUrl || ""} />
        </section>

        <section
          className="raid-publish-panel"
          id="raid-editor-publish"
          aria-labelledby="raid-editor-publish-title"
        >
          <div className="raid-publish-panel__copy">
            <span className="raid-form-step" aria-hidden="true">05</span>
            <div>
              <strong id="raid-editor-publish-title">Збереження і публікація</strong>
              <p>
                “Зберегти” не чіпає Discord. “{publishLabel}” зберігає форму й
                одразу синхронізує оголошення.
              </p>
              <span className="raid-save-state" data-raid-save-state aria-live="polite">
                {initialSaveState}
              </span>
            </div>
          </div>
          <div className="raid-form-actions">
            <button
              className="btn subtle"
              name="action"
              value="save"
              type="submit"
            >
              {saveLabel}
            </button>
            <button
              className="btn primary"
              formAction="/api/raids/publish"
              name="action"
              value="publish"
              type="submit"
              disabled={!canPublish}
            >
              {publishLabel}
            </button>
          </div>
          {publicationPending || publicationEventPending ? (
            <p className="notice warning-note raid-publication-recovery">Є незавершена публікація. <a href="#discord-publication">Перейди до стану й відновлення Discord</a>, щоб звірити її без надсилання форми.</p>
          ) : null}
          {!canPublish ? (
            <p className="raid-publish-panel__warning">
              Discord-публікація зараз недоступна. Чернетку та локальні зміни
              все одно можна зберегти.
            </p>
          ) : null}
          <div className="raid-form-links">
            {raid?.id ? (
              <a
                className="raid-message-link"
                href={`/raids/${encodeURIComponent(raid.id)}`}
              >
                Відкрити сторінку рейду
              </a>
            ) : null}
            {raid?.messageUrl ? (
              <a
                className="raid-message-link"
                href={raid.messageUrl}
                target="_blank"
                rel="noreferrer"
              >
                Відкрити Discord-повідомлення
              </a>
            ) : null}
            {raid?.discordEventUrl ? (
              <a
                className="raid-message-link"
                href={raid.discordEventUrl}
                target="_blank"
                rel="noreferrer"
              >
                Відкрити Discord-подію
              </a>
            ) : null}
          </div>
        </section>
      </form>

      {raid?.id ? (
        <form
          className="panel raid-form-danger-zone raid-form-danger-zone--separate"
          action={`/api/raids/${encodeURIComponent(raid.id)}/delete`}
          method="post"
          data-confirm-message={
            raid.status === "draft"
              ? "Видалити чернетку рейду?"
              : "Видалити рейд із панелі? Повʼязане Discord-повідомлення також буде прибране, якщо це можливо."
          }
        >
          <strong>
            {raid.status === "draft" ? "Видалення чернетки" : "Видалення рейду"}
          </strong>
          <p>
            {raid.status === "draft"
              ? "Чернетка зникне зі списку рейдів."
              : "З панелі рейд видаляється тільки вручну. Автоматично після старту прибирається лише Discord-повідомлення, а архів у панелі зберігається."}
          </p>
          <button className="btn danger" type="submit">
            {raid.status === "draft" ? "Видалити чернетку" : "Видалити рейд"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function RaidPageShell({
  user,
  title,
  description,
  children,
}: {
  user?: DashboardSession | null;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="container app-page raid-page raid-page--modern">
      <section
        className="dashboard-shell content-shell raid-shell app-page-stack"
        aria-label="Панель рейдів Mistblossom Vanguard"
      >
        <DashboardIdentity user={user || null} activeSection="raids" />
        <header className="hero panel dashboard-hero raid-dashboard-hero app-page-hero">
          <div className="hero-copy dashboard-hero__copy guild-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Рейди</div>
            <div className="content-hero-status-row">
              <span className="content-mode-pill content-mode-pill--library">
                {user ? hierarchyTitle(user.role) : "Учасник"}
              </span>
              <span className="content-hero-path">
                Запис у Discord • склад паті • оновлення без перезавантаження
              </span>
            </div>
            <h1>{title}</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">{description}</p>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд рейдів"
            summary={[
              {
                label: "РОЗДІЛ",
                value: "Рейди",
                note: "Запис, склад і публікація",
              },
              {
                label: "ДОСТУП",
                value: user ? hierarchyTitle(user.role) : "Учасник",
                note: user ? "Права з профілю" : "Публічний перегляд",
              },
            ]}
            stats={[
              { label: "DISCORD", value: "Так" },
              { label: "ПАТІ", value: "Авто" },
              { label: "ОНОВЛЕННЯ", value: "Так" },
            ]}
          />
        </header>
        {children}
      </section>
    </main>
  );
}

export function RaidUnavailableState({
  canManage = false,
}: {
  canManage?: boolean;
}) {
  return (
    <section className="panel raid-member-panel">
      <h2>Рейд недоступний</h2>
      <p>
        {canManage
          ? "Рейд не знайдено або був видалений."
          : "Цей рейд не знайдено, ще не опублікований або був видалений. Перевір посилання з Discord-повідомлення."}
      </p>
    </section>
  );
}

export function makePreviewRaid(
  user: DashboardSession,
  createdByName?: string,
): RaidItem {
  return {
    id: "previewraid",
    title: "Войдспайр",
    difficulty: "heroic",
    date: todayIso(),
    time: "20:00",
    description:
      "Глибоко в серці темної цитаделі Войдспайр нас чекають давні таємниці та смертельні вороги.\n\nБудьте готові до суворого випробування!",
    createdByDiscordId: user.provider === "discord" ? user.id : "",
    createdByName: createdByName || user.name || "@Sebas",
    createdByMain: null,
    raidLeaderName: null,
    consumables: "own",
    lootMode: "ms-os",
    composition: { tanks: 0, healers: 0, dps: 0 },
    maxPlayers: null,
    registrationLockEnabled: false,
    registrationLockMinutesBefore: null,
    mentionRoleIds: [],
    discordEventEnabled: true,
    discordEventDurationMinutes: 180,
    status: "draft",
    signups: [],
  };
}
```

## src/components/applications/ApplicationCard.tsx

```tsx
import type { ApplicationItem } from "@/lib/applicationsStore";
import { listEntryId } from "@/lib/listViewState";
import ApplicationDelivery from "@/components/ApplicationDelivery";
import ApplicationStatusActions from "@/components/ApplicationStatusActions";
import { ApplicationSelection, ApplicationStatusBadge } from "@/components/ApplicationModerationQueue";
import DataCard from "@/components/page/DataCard";
import RaiderIoPanel, { CharacterAvatar } from "./ApplicationPerformance";
import styles from "./applications-workspace.module.css";

export function applicationDate(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Дата невідома";
  return new Intl.DateTimeFormat("uk-UA", {timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "short"}).format(new Date(value));
}
export default function ApplicationCard({item, canManage, canViewSensitive, isOwner}: {item: ApplicationItem; canManage: boolean; canViewSensitive: boolean; isOwner: boolean}) {
  const name = item.character_name || item.title || "Персонаж";
  return <DataCard id={listEntryId("applications", String(item.id || item.tracking_number || item.number))} listEntry="applications" title={name}
    description={`Заявка #${item.number || "—"} · ${applicationDate(item.created_at)}`}
    badge={<ApplicationStatusBadge issueNumber={item.number} initialStatus={item.status_key} />}>
    <div className={styles.stack}>
      <div className={styles.identity}><CharacterAvatar item={item} /><span>{String(item.region || "eu").toUpperCase()} · {item.realm || "Реалм не вказано"}<small>{[item.class_name, item.faction].filter(Boolean).join(" · ")}</small></span></div>
      <dl className={styles.facts}>
        <div><dt>Відстеження</dt><dd>{item.tracking_number || "—"}</dd></div><div><dt>Джерело</dt><dd>{item.source || "Не вказано"}</dd></div>
        <div><dt>Коли грає</dt><dd>{item.availability || "Не вказано"}</dd></div>
        {canViewSensitive ? <><div><dt>Discord</dt><dd>{item.discord || "Не вказано"}</dd></div><div><dt>BattleTag</dt><dd>{item.battle_tag || "Не вказано"}</dd></div></> : null}
      </dl>
      <RaiderIoPanel item={item} />
      <div className={styles.actions}><small className={styles.metadata}>{item.source_system === "public-site" ? "Надіслано із сайту" : "Синхронізовано зі сховищем"}</small>
        {canViewSensitive && item.html_url ? <a className="btn subtle" href={item.html_url} target="_blank" rel="noreferrer">Відкрити джерело ↗</a> : null}</div>
      <ApplicationSelection issueNumber={item.number} />
      <ApplicationStatusActions issueNumber={item.number} initialStatus={item.status_key} issueState={item.state} canModerate={canManage} canDelete={isOwner && canManage} />
      {canManage ? <details className={styles.details}><summary>Доставка в Discord</summary><ApplicationDelivery number={item.number} /></details> : null}
    </div>
  </DataCard>;
}
```

## src/components/applications/ApplicationPerformance.tsx

```tsx
import type { ApplicationItem } from "@/lib/applicationsStore";
import styles from "./applications-workspace.module.css";
function formatScore(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "—";
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}


function MiniMetric({ label, value }: { label: string; value: string }) {
  return <span className={styles.metric}><strong>{value}</strong><small>{label}</small></span>;
}

function formatRaidName(raid: unknown): string | null {
  if (typeof raid === "string") {
    const value = raid.trim();
    return value || null;
  }

  if (raid && typeof raid === "object") {
    const item = raid as {
      name?: string;
      key?: string;
      summary?: string;
      mythic_bosses_killed?: number;
      heroic_bosses_killed?: number;
      normal_bosses_killed?: number;
      total_bosses?: number;
    };

    const baseName = item.name || item.key || "Raid";
    if (item.summary && item.summary.trim()) return `${baseName}: ${item.summary.trim()}`;

    const total = Number(item.total_bosses || 0) > 0 ? item.total_bosses : "?";
    const progress = [
      Number(item.mythic_bosses_killed || 0) > 0 ? `${item.mythic_bosses_killed}/${total} M` : "",
      Number(item.heroic_bosses_killed || 0) > 0 ? `${item.heroic_bosses_killed}/${total} H` : "",
      Number(item.normal_bosses_killed || 0) > 0 ? `${item.normal_bosses_killed}/${total} N` : "",
    ].filter(Boolean).join(" • ");

    return progress ? `${baseName}: ${progress}` : null;
  }

  return null;
}

function getRaidLines(raids: unknown[] | undefined): string[] {
  return (Array.isArray(raids) ? raids : [])
    .map(formatRaidName)
    .filter((value): value is string => Boolean(value));
}

function raidKey(raid: unknown, index: number): string {
  if (typeof raid === "string") return `${raid}-${index}`;

  if (raid && typeof raid === "object") {
    const item = raid as { key?: string; name?: string; summary?: string };
    return `${item.key || item.name || item.summary || "raid"}-${index}`;
  }

  return `raid-${index}`;
}

function getCharacterAvatarUrl(item: ApplicationItem): string | undefined {
  return item.avatar_url || item.raider_io?.thumbnail_url || undefined;
}

function getInitial(value?: string | null): string {
  return (value || "?").trim().charAt(0).toUpperCase() || "?";
}

export function CharacterAvatar({ item }: { item: ApplicationItem }) {
  const avatarUrl = getCharacterAvatarUrl(item);

  if (avatarUrl) {
    return <img className={styles.avatar} src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" decoding="async" />;
  }

  return (
    <div className={styles.placeholder}>
      {getInitial(item.character_name || item.title)}
    </div>
  );
}

export default function RaiderIoPanel({ item }: { item: ApplicationItem }) {
  const rio = item.raider_io ?? null;
  const current = rio?.mythic_plus?.current || {};
  const previous = rio?.mythic_plus?.previous || {};
  const currentRaids = getRaidLines(rio?.raids?.current);
  const previousRaids = getRaidLines(rio?.raids?.previous);

  return (
    <div className={styles.stack}>
      <h4 className={styles.heading}>Raider.IO</h4>
      {(item.raider_io_error ?? null) ? <p className={styles.metadata}>Raider.IO тимчасово не відповів для цього персонажа.</p> : null}
      <div className={styles.facts}>
        <MiniMetric label="M+ зараз" value={formatScore(current.all)} />
        <MiniMetric label="Хіл" value={formatScore(current.healer)} />
        <MiniMetric label="DPS" value={formatScore(current.dps)} />
        <MiniMetric label="Танк" value={formatScore(current.tank)} />
        <MiniMetric label="M+ попередній" value={formatScore(previous.all)} />
      </div>
      <div className={styles.facts}>
        <div>
          <strong>Рейди зараз</strong>
          {currentRaids.length ? currentRaids.map((raid, index) => <span key={raidKey(raid, index)}>{raid}</span>) : <span>Дані відсутні</span>}
        </div>
        <div>
          <strong>Рейди раніше</strong>
          {previousRaids.length ? previousRaids.map((raid, index) => <span key={raidKey(raid, index)}>{raid}</span>) : <span>Дані відсутні</span>}
        </div>
      </div>
      {rio?.profile_url ? <a className="btn subtle" href={rio.profile_url} target="_blank" rel="noreferrer">Відкрити Raider.IO</a> : null}
    </div>
  );
}
```

## src/components/applications/ApplicationWorkspaceView.tsx

```tsx
import Link from "next/link";
import type { ApplicationWorkspaceModel } from "@/services/applicationWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import Notice from "@/components/page/Notice";
import ApplicationFilters from "@/components/ApplicationFilters";
import { ApplicationModerationProvider } from "@/components/ApplicationModerationQueue";
import ListViewMemory from "@/components/ListViewMemory";
import { listNavigationScope } from "@/lib/listNavigationScope";
import ApplicationCard from "./ApplicationCard";

export default function ApplicationWorkspaceView(model: ApplicationWorkspaceModel) {
  const {user, currentUrl, listParams, items, counts, classOptions, mayManageApplications, mayViewSensitiveApplications, unavailable, filtersUnavailable} = model;
  const scope = listNavigationScope(user);
  return <PageContainer label="Заявки до гільдії" navigation={<DashboardIdentity user={user} activeSection="applications" />}>
    <PageHeader title="Заявки до гільдії" description="Кандидати, їхній прогрес і рішення офіцерів. Пошук та фільтри оновлюють поточну чергу."
      breadcrumbs={[{label: "Заявки"}]} metrics={[{label: "У поточному списку",value: unavailable ? "—" : counts.all},{label: "На розгляді",value: unavailable ? "—" : counts.review},{label: "Прийнято",value: unavailable ? "—" : counts.accepted},{label: "Відхилено",value: unavailable ? "—" : counts.declined}]} />
    <ApplicationFilters initialQuery={listParams.get("q") || ""} initialStatus={listParams.get("status") || "all"} initialClass={listParams.get("class") || "all"} initialSort={listParams.get("sort") || "created"} classOptions={classOptions} />
    <ListViewMemory key={scope} kind="applications" scope={scope} currentUrl={currentUrl} restorePosition={!unavailable} />
    {filtersUnavailable ? <Notice title="Список класів тимчасово недоступний" tone="warning">Поточний фільтр збережено. Інші фільтри залишаються доступними.</Notice> : null}
    {!mayManageApplications ? <Notice title="Режим перегляду">Зміна рішень недоступна. Контактні дані показуються відповідно до твоїх прав.</Notice> : null}
    <PageSection id="applications-list-title" title="Кандидати" description={mayManageApplications ? "Приймай рішення окремо або вибери кілька заявок для спільної дії." : "Дані кандидатів, доступні для перегляду."}>
      {unavailable ? <ErrorState title="Заявки тимчасово недоступні" description="Не вдалося отримати чергу. Фільтри збережено." actions={<PageRefreshButton />} />
        : items.length ? <ApplicationModerationProvider key={`${scope}:${currentUrl}`} canModerate={mayManageApplications} items={items.map(item => ({issueNumber: item.number,status: item.status_key,state: item.state}))}>
          <DataGrid label="Список заявок" columns="two">{items.map(item => <ApplicationCard key={String(item.id || item.tracking_number || item.number)} item={item} canManage={mayManageApplications} canViewSensitive={mayViewSensitiveApplications} isOwner={Boolean(user.isServerOwner)} />)}</DataGrid>
        </ApplicationModerationProvider>
        : <EmptyState title={listParams.size ? "Нічого не знайдено" : "Заявок поки немає"} description="Зміни пошук або скинь фільтри, щоб перевірити всю чергу." actions={listParams.size ? <Link className="btn subtle" href="/applications?view=all" data-list-reset-position>Скинути фільтри</Link> : null} />}
    </PageSection>
  </PageContainer>;
}
```

## src/components/applications/applications-workspace.module.css

```css
.stack, .delivery { display: grid; gap: var(--space-sm); min-width: 0; }
.identity { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }
.identity > span { display: grid; gap: var(--space-2xs); overflow-wrap: anywhere; }
.avatar, .placeholder { width: var(--control-height); height: var(--control-height); border-radius: var(--control-radius); object-fit: cover; flex: none; }
.placeholder { display: grid; place-items: center; background: var(--surface-raised); color: var(--text-muted); }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-sm); margin: 0; min-width: 0; }
.facts > div { min-width: 0; display: grid; gap: var(--space-2xs); }
.facts dt, .metadata, .identity small { color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-copy); }
.facts dd { margin: 0; color: var(--text-body); font-size: var(--font-size-body-sm); overflow-wrap: anywhere; }
.facts > div > span { display: block; font-size: var(--font-size-body-sm); color: var(--text-soft); overflow-wrap: anywhere; }
.metric { display: grid; gap: var(--space-2xs); padding: var(--space-xs); border-bottom: var(--stroke-width) solid var(--border); }
.metric strong { color: var(--text-body); }
.metric small { font-size: var(--font-size-meta); color: var(--text-muted); }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }
.actions :global(.btn) { white-space: normal; }
.heading { margin: 0; font-size: var(--heading-card-size); color: var(--text-strong); }
.bulk { display: grid; gap: var(--space-md); padding: var(--panel-padding); margin-bottom: var(--section-gap); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); min-width: 0; }
.bulkHeading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-sm); }
.bulkHeading p { color: var(--text-muted); font-size: var(--font-size-meta); margin: var(--space-xs) 0 0; }
.results, .message { font-size: var(--font-size-body-sm); color: var(--text-soft); overflow-wrap: anywhere; line-height: var(--line-height-copy); }
.selection { display: inline-flex; align-items: center; gap: var(--space-xs); color: var(--text-body); font-size: var(--font-size-body-sm); }
.details { border-top: var(--stroke-width) solid var(--border); padding-top: var(--space-sm); min-width: 0; }
.details > summary { cursor: pointer; min-height: var(--control-height); color: var(--text-body); font-size: var(--font-size-body-sm); }
.delivery :is(label,p) { margin: 0; color: var(--text-soft); font-size: var(--font-size-body-sm); overflow-wrap: anywhere; }
.delivery label { display: grid; gap: var(--space-xs); }
.delivery input { width: 100%; min-width: 0; }
```

## src/components/community/publication.module.css

```css
.panel { display: grid; gap: var(--space-md); min-width: 0; padding: var(--panel-padding); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); }
.panel h2 { margin: var(--space-xs) 0; font-size: var(--heading-section-size); color: var(--text-strong); }
.metadata { font-size: var(--font-size-meta); color: var(--text-muted); line-height: var(--line-height-copy); margin: 0; }
.states { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%,var(--data-grid-min)),1fr)); gap: var(--space-md); margin: 0; }
.states > div { min-width: 0; display: grid; gap: var(--space-xs); }
.states dt { color: var(--text-body); font-size: var(--font-size-body-sm); font-weight: var(--font-weight-semibold); }
.states dd { margin: 0; color: var(--text-soft); font-size: var(--font-size-body-sm); overflow-wrap: anywhere; }
.field { display: grid; gap: var(--space-xs); min-width: 0; font-size: var(--font-size-body-sm); color: var(--text-body); }
.field input { width: 100%; min-width: 0; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-xs); }
.result { color: var(--text-soft); font-size: var(--font-size-body-sm); overflow-wrap: anywhere; margin: 0; }
.result:empty { position: absolute; width: var(--stroke-width); height: var(--stroke-width); overflow: hidden; clip-path: inset(50%); }
```

## src/components/community/workspace.module.css

```css
.stack { display: grid; gap: var(--section-gap); min-width: 0; }
.metadata { font-size: var(--font-size-meta); color: var(--text-muted); line-height: var(--line-height-copy); }
.details { border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); padding: var(--space-md); min-width: 0; }
.details > summary { cursor: pointer; color: var(--text-body); font-weight: var(--font-weight-semibold); min-height: var(--control-height); }
.details[open] > summary { margin-bottom: var(--space-md); }
.field { display: grid; gap: var(--space-xs); min-width: 0; color: var(--text-body); font-size: var(--font-size-body-sm); }
.field :is(input, select) { width: 100%; min-width: 0; }
.list { display: grid; gap: var(--space-xs); margin: 0; padding: 0; list-style: none; min-width: 0; }
.list > li { padding: var(--space-sm); border-bottom: var(--stroke-width) solid var(--border-subtle); overflow-wrap: anywhere; }
.columns { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--section-gap); min-width: 0; align-items: start; }
@container (max-width: 1000px) { .columns { grid-template-columns: minmax(0, 1fr); } }
```

## src/components/guild/GuildDiscordGuide.tsx

```tsx
import { MISTBLOSSOM_DISCORD_CHANNELS, discordGuildChannelUrl } from "@/lib/discordGuildLinks";
import styles from "@/components/community/workspace.module.css";
export default function GuildDiscordGuide() {
  const channels = [MISTBLOSSOM_DISCORD_CHANNELS.rules, MISTBLOSSOM_DISCORD_CHANNELS.announcements, MISTBLOSSOM_DISCORD_CHANNELS.raids, MISTBLOSSOM_DISCORD_CHANNELS.general];
  return <details className={styles.details}><summary>Ключові канали гільдії в Discord</summary>
    <p className={styles.metadata}>Нові учасники спочатку приймають правила, після чого отримують доступ до основного чату.</p>
    <ul className={styles.list}>{channels.map(channel => <li key={channel.id}><a href={discordGuildChannelUrl(channel.id)} target="_blank" rel="noreferrer">{channel.label} ↗</a><p className={styles.metadata}>{channel.description}</p></li>)}</ul>
  </details>;
}
```

## src/components/guild/GuildRosterTable.tsx

```tsx
"use client";
import type { KeyboardEvent, MouseEvent } from "react";
import Link from "next/link";
import type { GuildRosterMember, GuildRosterStats, GuildScoreSegment } from "@/lib/guildRoster";
import { bestRaid, raidSummary } from "@/lib/guildRosterPresentation";
import { formatStableNumber } from "@/lib/stableUiText";
import { listEntryId } from "@/lib/listViewState";
import DataTable from "@/components/ui/DataTable";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "./guild-workspace.module.css";

function openProfile(event: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>, href: string | null) {
  if (!href || event.target instanceof Element && event.target.closest("a,button,input,select,textarea,label")) return;
  if ("key" in event) { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); }
  window.location.href = href;
}
export default function GuildRosterTable({members, segment, raidFilter, snapshot}: {members: GuildRosterMember[]; segment: GuildScoreSegment; raidFilter: string; snapshot: GuildRosterStats["raidSeasonSnapshot"]}) {
  return <DataTable caption="Персонажі гільдії" headings={["Персонаж", "Клас / спек", "Роль", "ILVL", "RIO", "Рейд", "Ранг", "Посилання"]} className={styles.tableArea} tableClassName={styles.table}>
    {members.map(member => {
      const href = member.ownerProfileId ? `/profile/${encodeURIComponent(member.ownerProfileId)}?from=guild` : null;
      const raid = bestRaid(member, snapshot, raidFilter), progress = raidSummary(raid), score = member.scores[segment] || 0;
      return <tr key={member.key} id={listEntryId("guild", member.key)} data-list-entry="guild" data-list-href={href || undefined} tabIndex={href ? 0 : undefined}
        onClick={event => openProfile(event, href)} onKeyDown={event => openProfile(event, href)}>
        <th scope="row" data-label="Персонаж"><div className={styles.identity}>
          {member.avatarUrl ? <img className={styles.avatar} src={member.avatarUrl} width={40} height={40} alt="" loading="lazy" decoding="async" /> : null}
          <span>{href ? <Link href={href} className={styles.characterName} data-wow-class={member.className.toLowerCase()} prefetch={false}>{member.name}</Link> : <strong className={styles.characterName} data-wow-class={member.className.toLowerCase()}>{member.name}</strong>}<small>{member.realmName || member.realmSlug}</small></span>
        </div></th>
        <td data-label="Клас / спек"><strong>{member.className || "—"}</strong><small>{member.specName || "—"}</small></td>
        <td data-label="Роль"><StatusBadge tone={member.role === "healer" ? "success" : member.role === "tank" ? "info" : "neutral"}>{member.role === "tank" ? "Танк" : member.role === "healer" ? "Хіл" : member.role === "dps" ? "ДД" : "—"}</StatusBadge></td>
        <td data-label="ILVL">{member.itemLevel || "—"}</td>
        <td data-label="RIO"><strong>{score > 0 ? formatStableNumber(score, 1) : "—"}</strong><small>{segment === "all" ? "Загальний" : segment}</small></td>
        <td data-label="Рейд" title={raid ? `${raid.name}: ${progress.detail}` : undefined}><strong>{progress.main}</strong><small>{raid?.name || progress.detail}</small></td>
        <td data-label="Ранг">{member.rank === null || member.rank === undefined ? "—" : `#${member.rank}`}</td>
        <td data-label="Посилання"><div className={styles.actions}>{href ? <Link href={href} prefetch={false}>Профіль</Link> : null}{member.profileUrl ? <a href={member.profileUrl} target="_blank" rel="noreferrer">Raider.IO ↗</a> : null}{!href && !member.profileUrl ? "—" : null}</div></td>
      </tr>;
    })}
  </DataTable>;
}
```

## src/components/guild/guild-workspace.module.css

```css
.actions, .footer, .pagination, .pageSize { display: flex; flex-wrap: wrap; gap: var(--space-xs); align-items: center; min-width: 0; }
.footer { justify-content: space-between; gap: var(--space-md); }
.metadata, .footer small { color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-copy); }
.viewMemory { min-width: 0; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-sm); margin: 0; }
.metrics > div { padding: var(--space-sm); border-bottom: var(--stroke-width) solid var(--border); min-width: 0; }
.metrics dt { color: var(--text-muted); font-size: var(--font-size-meta); }
.metrics dd { margin: var(--space-2xs) 0 0; color: var(--text-body); font-weight: var(--font-weight-semibold); }
.filtersPanel { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-md); }
.filterField, .rangeField { display: grid; gap: var(--space-xs); color: var(--text-body); font-size: var(--font-size-body-sm); min-width: 0; }
.filterField :is(select,input), .rangeField input { width: 100%; min-width: 0; }
.filterActions { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-xs); }
.filterActions small { color: var(--text-muted); font-size: var(--font-size-meta); }
.tableArea { container-type: inline-size; min-width: 0; }
.table { table-layout: fixed; width: 100%; }
.table :is(th,td) { font-size: var(--font-size-body-sm); font-weight: var(--font-weight-ui); }
.table small { display: block; margin-top: var(--space-2xs); color: var(--text-muted); font-size: var(--font-size-meta); }
.identity { display: flex; align-items: start; gap: var(--space-xs); min-width: 0; }
.identity > span { min-width: 0; overflow-wrap: anywhere; }
.avatar { border-radius: var(--control-radius); object-fit: cover; flex: none; }
.characterName { color: var(--text-strong); font-weight: var(--font-weight-semibold); text-decoration: none; }
.characterName:hover { text-decoration: underline; }
.characterName[data-wow-class="death knight"] { color: var(--c-wow-death-knight); }
.characterName[data-wow-class="demon hunter"] { color: var(--c-wow-demon-hunter); }
.characterName[data-wow-class="druid"] { color: var(--c-wow-druid); }
.characterName[data-wow-class="evoker"] { color: var(--c-wow-evoker); }
.characterName[data-wow-class="hunter"] { color: var(--c-wow-hunter); }
.characterName[data-wow-class="mage"] { color: var(--c-wow-mage); }
.characterName[data-wow-class="monk"] { color: var(--c-wow-monk); }
.characterName[data-wow-class="paladin"] { color: var(--c-wow-paladin); }
.characterName[data-wow-class="priest"] { color: var(--c-wow-priest); }
.characterName[data-wow-class="rogue"] { color: var(--c-wow-rogue); }
.characterName[data-wow-class="shaman"] { color: var(--c-wow-shaman); }
.characterName[data-wow-class="warlock"] { color: var(--c-wow-warlock); }
.characterName[data-wow-class="warrior"] { color: var(--c-wow-warrior); }
@container (max-width: 1100px) {
  .table { display: block; }
  .table thead { position: absolute; width: var(--stroke-width); height: var(--stroke-width); overflow: hidden; clip-path: inset(50%); }
  .table tbody { display: grid; }
  .table tr { display: grid; padding: var(--space-sm); border-bottom: var(--stroke-width) solid var(--border); }
  .table :is(th,td) { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,2fr); gap: var(--space-xs); padding: var(--space-xs); border: 0; }
  .table :is(th,td)::before { content: attr(data-label); color: var(--text-muted); font-size: var(--font-size-meta); }
  .table :is(th,td) > small { grid-column: 2; }
}
.rangeField { grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); margin: 0; padding: var(--space-sm); border: var(--stroke-width) solid var(--border); border-radius: var(--control-radius); }
.rangeField label { display: grid; gap: var(--space-2xs); }
.rangeField input { min-width: 0; }
.rangeDash { align-self: end; padding-bottom: var(--space-sm); color: var(--text-muted); }
```

## src/components/page/DataCard.tsx

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./page-system.module.css";

export type DataCardProps = {
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
  id?: string;
  listEntry?: "applications" | "raids" | "polls";
  titleHref?: string;
};
export default function DataCard({ title, description, badge, children, actions, headingLevel = 3, id, listEntry, titleHref }: DataCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return <article className={styles.dataCard} id={id} data-list-entry={listEntry}>
    <header className={styles.cardHeader}>
      <Heading className={styles.cardTitle}>{titleHref ? <Link href={titleHref} prefetch={false}>{title}</Link> : title}</Heading>{badge}
    </header>
    {description ? <p className={styles.cardDescription}>{description}</p> : null}
    {children ? <div className={styles.cardBody}>{children}</div> : null}
    {actions ? <footer className={styles.cardActions}>{actions}</footer> : null}
  </article>;
}
```

## src/components/polls/PollAvailabilityMatrix.tsx

```tsx
import {RAID_POLL_TIMES,pollVotersForDay,pollAbsentVotersForDay,raidPollDayFullLabel,raidPollVoteSchedule,raidPollRoleShortLabel,raidPollAvailabilityLabel,type RaidPollItem,pollVoteCounts} from "@/lib/raidPolls";
import {pollDays,bestTimeForDay,voteDisplayName} from "@/lib/raidPollPresentation";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import DataCard from "@/components/page/DataCard";
import Progress from "@/components/page/Progress";
import StatusBadge from "@/components/page/StatusBadge";
import styles from "./poll-workspace.module.css";
export default function PollAvailabilityMatrix({poll,counts}: {poll: RaidPollItem;counts: ReturnType<typeof pollVoteCounts>}) {
  const days = pollDays(poll), maxDay = Math.max(1,...days.map(day => counts.days[day.value]));
  const maxSlot = Math.max(1,...days.flatMap(day => RAID_POLL_TIMES.map(time => counts.dayTimes[day.value][time])));
  return <PageSection id={`poll-${poll.id}-matrix-title`} title="Матриця день / час" description="Єдиний масштаб смуг дозволяє порівнювати явку між днями.">
    <DataGrid label="Доступність за днями">{days.map(day => {
      const available = pollVotersForDay(poll,day.value), absent = pollAbsentVotersForDay(poll,day.value);
      return <DataCard key={day.value} title={raidPollDayFullLabel(day.value)} description={`Найкращий час: ${bestTimeForDay(counts.dayTimes[day.value])}`}>
        <div className={styles.stack}>
          <Progress value={counts.days[day.value]} max={maxDay} label={`Можуть у ${day.label}: ${counts.days[day.value]}`} />
          <div className={styles.actions}><StatusBadge tone="success">Можуть: {counts.days[day.value]}</StatusBadge><StatusBadge>Не можуть: {counts.absent[day.value]}</StatusBadge></div>
          <ul className={styles.times}>{RAID_POLL_TIMES.map(time => <li key={time}><span>{time}</span><Progress value={counts.dayTimes[day.value][time]} max={maxSlot} label={`${day.label} ${time}: ${counts.dayTimes[day.value][time]} гравців`} /><strong>{counts.dayTimes[day.value][time]}</strong></li>)}</ul>
          <details className={styles.details}><summary>Доступні учасники: {available.length}</summary>{available.length ? <ul className={styles.voters}>{available.map(vote => <li key={vote.discordId}><strong>{voteDisplayName(vote)}</strong><span>{raidPollRoleShortLabel(vote.role)} · {raidPollAvailabilityLabel(raidPollVoteSchedule(vote)[day.value])}</span></li>)}</ul> : <p className={styles.metadata}>Доступних учасників поки немає.</p>}</details>
          {absent.length ? <p className={styles.metadata}>Не можуть: {absent.map(voteDisplayName).join(", ")}</p> : null}
        </div>
      </DataCard>;
    })}</DataGrid>
  </PageSection>;
}
```

## src/components/polls/PollDetailsView.tsx

```tsx
import Link from "next/link";
import type {PollDetailsWorkspaceModel} from "@/services/pollWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import ErrorState from "@/components/page/ErrorState";
import EmptyState from "@/components/page/EmptyState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import DiscordPublicationWorkbench from "@/components/DiscordPublicationWorkbench";
import RaidPollLiveSync from "@/components/RaidPollLiveSync";
import ListReturnLink from "@/components/ListReturnLink";
import {listNavigationScope} from "@/lib/listNavigationScope";
import {raidPollLiveRevision,raidPollTitle} from "@/lib/raidPolls";
import PollResults from "./PollResults";
export default function PollDetailsView({user,canManage,poll,relatedPolls,unavailable,relatedUnavailable}: PollDetailsWorkspaceModel) {
  return <PageContainer label="Рейд-пул" navigation={<DashboardIdentity user={user} activeSection="polls" />}>
    <PageHeader title={poll ? raidPollTitle(poll) : "Рейд-пул"} description={poll?.description || "Дні, час, голоси та результати голосування."} breadcrumbs={[{label:"Рейд-пули",href:"/polls"},{label:"Результати"}]} />
    <ListReturnLink kind="polls" scope={listNavigationScope(user)} />
    {unavailable ? <ErrorState title="Рейд-пул тимчасово недоступний" description="Не вдалося прочитати результати голосування." actions={<PageRefreshButton />} /> : poll ? <>
      {canManage ? <><PageErrorBoundary resetKey={poll.id}><DiscordPublicationWorkbench kind="poll" id={poll.id} /></PageErrorBoundary><RaidPollLiveSync pollId={poll.id} initialRevision={raidPollLiveRevision(poll)} /></> : null}
      <PollResults poll={poll} relatedPolls={relatedPolls} canManage={canManage} relatedUnavailable={relatedUnavailable} />
    </> : <EmptyState title="Рейд-пул не знайдено" description="Перевір посилання або повернись до списку доступних голосувань." actions={<Link className="btn subtle" href="/polls">До списку</Link>} />}
  </PageContainer>;
}
```

## src/components/polls/PollDirectoryCard.tsx

```tsx
"use client";
import type {RaidPollCardModel} from "@/components/RaidPollBrowser";
import {listEntryId} from "@/lib/listViewState";
import DataCard from "@/components/page/DataCard";
import StatusBadge from "@/components/page/StatusBadge";
import RaidPollActions from "@/components/RaidPollActions";
import styles from "./poll-workspace.module.css";
export default function PollDirectoryCard({card,canManage,selected,selectionDisabled,onToggle}: {card: RaidPollCardModel;canManage: boolean;selected: boolean;selectionDisabled: boolean;onToggle: (id: string) => void}) {
  const href = `/polls/${encodeURIComponent(card.id)}`;
  return <DataCard id={listEntryId("polls",card.id)} listEntry="polls" title={card.title} titleHref={href} description={card.description}
    badge={<StatusBadge tone={card.state === "open" ? "success" : card.state === "closed" ? "neutral" : "warning"}>{card.statusLabel}</StatusBadge>}
    actions={<RaidPollActions pollId={card.id} pollTitle={card.title} state={card.state} canManage={canManage} disabled={selectionDisabled} editHref={`${href}/edit`} messageUrl={card.messageUrl} showView />}>
    <div className={styles.stack}>
      <div className={styles.actions}><StatusBadge>{card.difficultyLabel}</StatusBadge>{card.autoRepeat ? <StatusBadge>Повтор: {card.repeatLabel}</StatusBadge> : null}<small className={styles.metadata} title={card.id}>ID: {card.shortId}</small></div>
      {card.pausedNote ? <p className={styles.metadata}>{card.pausedNote}</p> : null}
      <div className={styles.actions} aria-label="Дні рейд-пулу">{card.dayLabels.map(day => <StatusBadge key={day}>{day}</StatusBadge>)}</div>
      <dl className={styles.facts}><div><dt>Голоси</dt><dd>{card.votes}<small>Танки {card.tanks} · хіли {card.healers} · ДД {card.dps}</small></dd></div><div><dt>{card.deadlineCaption}</dt><dd>{card.remainingLabel}<small>{card.deadlineLabel}</small></dd></div><div><dt>Рекомендація</dt><dd>{card.recommendation}</dd></div></dl>
      {canManage ? <label className={styles.selection}><input type="checkbox" disabled={selectionDisabled} checked={selected} onChange={() => onToggle(card.id)} aria-label={`Вибрати «${card.title}»`} />Вибрати для спільної дії</label> : null}
    </div>
  </DataCard>;
}
```

## src/components/polls/PollDirectoryList.tsx

```tsx
import type {RaidPollItem} from "@/lib/raidPolls";
import {buildRaidPollCardModel} from "@/lib/raidPollPresentation";
import RaidPollBrowser from "@/components/RaidPollBrowser";
export default function PollDirectoryList({polls,relatedPolls,canManage = false,navigationScope,createHref}: {polls: RaidPollItem[];relatedPolls?: RaidPollItem[];canManage?: boolean;navigationScope: string;createHref?: string}) {
  const related = relatedPolls?.length ? relatedPolls : polls;
  const cards = polls.map(poll => buildRaidPollCardModel(poll,related));
  return <RaidPollBrowser key={navigationScope} cards={cards} canManage={canManage} navigationScope={navigationScope} createHref={createHref} />;
}
```

## src/components/polls/PollDirectoryView.tsx

```tsx
import Link from "next/link";
import type {PollDirectoryWorkspaceModel} from "@/services/pollWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import Notice from "@/components/page/Notice";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import DropdownMenu from "@/components/ui/DropdownMenu";
import RaidPollRecalculateButton from "@/components/RaidPollRecalculateButton";
import {listNavigationScope} from "@/lib/listNavigationScope";
import PollDirectoryList from "./PollDirectoryList";
export default function PollDirectoryView({user,canManage,publishedPolls,visiblePolls,counts,unavailable,discordEnabled}: PollDirectoryWorkspaceModel) {
  return <PageContainer label="Рейд-пули" navigation={<DashboardIdentity user={user} activeSection="polls" />}>
    <PageHeader title="Рейд-пули" description="Доступність гравців за днями й часом. Голоси надходять із Discord, рекомендації враховують інші активні пули."
      breadcrumbs={[{label:"Рейд-пули"}]} actions={canManage ? <><Link className="btn primary" href="/polls/new">Створити рейд-пул</Link><DropdownMenu label="Інші інструменти" closeOnAction={false}><RaidPollRecalculateButton /></DropdownMenu></> : null}
      metrics={[{label:"Заплановані",value:unavailable ? "—" : counts.scheduled},{label:"Активні",value:unavailable ? "—" : counts.open},{label:"На паузі",value:unavailable ? "—" : counts.paused},{label:"Усього",value:unavailable ? "—" : visiblePolls.length},{label:"У Discord",value:unavailable ? "—" : publishedPolls.length}]} />
    {canManage && !discordEnabled ? <Notice title="Публікація в Discord недоступна" tone="warning">Перевір підключення бота й доступ до каналу.</Notice> : null}
    <PageSection id="polls-directory-title" title="Голосування" description="Вибери стан або знайди потрібний пул за назвою.">
      {unavailable ? <ErrorState title="Рейд-пули тимчасово недоступні" description="Не вдалося отримати список голосувань." actions={<PageRefreshButton />} /> : <PollDirectoryList polls={visiblePolls} relatedPolls={publishedPolls} canManage={canManage} navigationScope={listNavigationScope(user)} />}
    </PageSection>
  </PageContainer>;
}
```

## src/components/polls/PollRecommendations.tsx

```tsx
import type {RaidPollItem} from "@/lib/raidPolls";
import {raidPollUniqueDayRecommendations,raidPollSlotSummary,RAID_POLL_WOW_WEEK_LABEL} from "@/lib/raidPolls";
import PageSection from "@/components/page/PageSection";
import DataCard from "@/components/page/DataCard";
import DataGrid from "@/components/page/DataGrid";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import styles from "./poll-workspace.module.css";
export default function PollRecommendations({poll,relatedPolls,unavailable = false}: {poll: RaidPollItem;relatedPolls: RaidPollItem[];unavailable?: boolean}) {
  const recommendations = unavailable ? [] : raidPollUniqueDayRecommendations(poll,relatedPolls,3);
  return <PageSection id={`poll-${poll.id}-recommendations-title`} title="Рекомендовані слоти" description="До двох основних рейдів і один додатковий. Дні узгоджені з іншими активними пулами.">
    {unavailable ? <ErrorState title="Рекомендації тимчасово недоступні" description="Не вдалося отримати інші активні пули й перевірити перетин днів. Голоси цього пулу доступні нижче." actions={<PageRefreshButton />} />
      : recommendations.length ? <DataGrid label="Рекомендовані день і час">{recommendations.map((slot,index) => <DataCard key={`${slot.day}:${slot.time}`} title={`${index === 2 ? "Додатковий рейд" : `Рейд ${index + 1}`} · ${raidPollSlotSummary(slot)}`}>
        <dl className={styles.facts}><div><dt>Танки</dt><dd>{slot.tanks} / {slot.desiredTanks}</dd></div><div><dt>Хіли</dt><dd>{slot.healers} / {slot.desiredHealers}</dd></div><div><dt>Усього</dt><dd>{slot.total}</dd></div><div><dt>ДД</dt><dd>{slot.effectiveDps}</dd></div>{slot.unknown ? <div><dt>Без вибраної ролі</dt><dd>{slot.unknown}</dd></div> : null}</dl>
      </DataCard>)}</DataGrid> : <EmptyState title="Придатних слотів поки немає" description="Потрібно більше голосів із вибраною роллю та доступністю." />}
    <details className={styles.details}><summary>Як визначається пріоритет</summary><p>WoW-тиждень: {RAID_POLL_WOW_WEEK_LABEL}. Вибраний найраніший час означає доступність і на пізніші слоти цього дня. Один день не пропонується двом активним пулам.</p>
      <p>Спочатку формуються два основні рейди. Субота або неділя отримує місце, якщо є життєздатне ядро й явка не просідає більш ніж приблизно на 40% від найсильнішого дня. Третій рейд є додатковим і за придатності має пріоритет ближче до понеділка або вівторка.</p>
      <p>У межах пріоритету враховуються зібране ядро, танки, хіли, загальна кількість гравців, ДД і голоси без ролі. Класи й спеціалізації не впливають на цей розрахунок.</p>
    </details>
  </PageSection>;
}
```

## src/components/polls/PollResults.tsx

```tsx
import {pollVoteCounts,raidPollStateKey,raidPollStatusLabel,raidPollRemainingLabel,raidPollRepeatScheduleLabel,raidPollDifficultyLabel,type RaidPollItem} from "@/lib/raidPolls";
import {roleBreakdown,pollDays,pollCloseLabel,formatDateTime} from "@/lib/raidPollPresentation";
import DataCard from "@/components/page/DataCard";
import StatusBadge from "@/components/page/StatusBadge";
import Notice from "@/components/page/Notice";
import PageSection from "@/components/page/PageSection";
import DropdownMenu from "@/components/ui/DropdownMenu";
import RaidPollActions from "@/components/RaidPollActions";
import RaidPollRecalculateButton from "@/components/RaidPollRecalculateButton";
import PollRecommendations from "./PollRecommendations";
import PollAvailabilityMatrix from "./PollAvailabilityMatrix";
import PollVotes from "./PollVotes";
import styles from "./poll-workspace.module.css";
export default function PollResults({poll,canManage = false,relatedPolls = [poll],relatedUnavailable = false}: {poll: RaidPollItem;canManage?: boolean;relatedPolls?: RaidPollItem[];relatedUnavailable?: boolean}) {
  const counts = pollVoteCounts(poll), state = raidPollStateKey(poll), roles = roleBreakdown(poll), days = pollDays(poll);
  return <div className={styles.stack}>
    <DataCard title="Стан голосування" badge={<StatusBadge tone={state === "open" ? "success" : state === "closed" ? "neutral" : "warning"}>{raidPollStatusLabel(poll)}</StatusBadge>}
      actions={<><RaidPollActions pollId={poll.id} pollTitle={poll.title} state={state} canManage={canManage} editHref={`/polls/${encodeURIComponent(poll.id)}/edit`} messageUrl={poll.messageUrl} redirectAfterDelete="/polls" />{canManage ? <DropdownMenu label="Перерахунок" closeOnAction={false}><RaidPollRecalculateButton /></DropdownMenu> : null}</>}>
      <div className={styles.stack}><StatusBadge>{raidPollDifficultyLabel(poll.difficulty)}</StatusBadge>
      <dl className={styles.facts}><div><dt>Проголосували</dt><dd>{counts.total}<small>Танки {roles.tanks} · хіли {roles.healers} · ДД {roles.dps}</small></dd></div><div><dt>{state === "scheduled" ? "До публікації" : state === "closed" ? "Завершено" : state === "paused" ? "Заморожено" : "До закриття"}</dt><dd>{state === "closed" ? "—" : raidPollRemainingLabel(poll)}<small>{pollCloseLabel(poll)}</small></dd></div><div><dt>Дні пулу</dt><dd>{days.map(day => day.label).join(" · ")}<small>{days.length} із 7</small></dd></div><div><dt>Автоповтор</dt><dd>{poll.autoRepeatWeekly ? "Увімкнено" : "Вимкнено"}<small>{raidPollRepeatScheduleLabel(poll)}</small></dd></div></dl>
      </div>
    </DataCard>
    {state === "scheduled" ? <Notice title="Публікацію заплановано">Публікація в Discord: {formatDateTime(poll.scheduledPublishAtMs || poll.scheduledPublishAt)}. Відлік до закриття почнеться після успішної публікації.</Notice> : null}
    {canManage && state === "scheduled" && poll.scheduledPublishLastError ? <Notice title="Публікація потребує уваги" tone="warning">{poll.scheduledPublishLastErrorAt ? `Остання спроба: ${formatDateTime(poll.scheduledPublishLastErrorAt)}. ` : ""}{poll.scheduledPublishLastError} Автоматична спроба повториться пізніше.</Notice> : null}
    {state === "paused" ? <Notice title="Голосування призупинено">{poll.pausedByName ? `Призупинив: ${poll.pausedByName}. ` : ""}Залишок часу: {raidPollRemainingLabel(poll)}. {poll.pausedNote}</Notice> : null}
    <PollRecommendations poll={poll} relatedPolls={relatedPolls} unavailable={relatedUnavailable} />
    <PollAvailabilityMatrix poll={poll} counts={counts} />
    <PageSection id={`poll-${poll.id}-discord-title`} title="Discord" description="Стан оголошення та можливість голосувати."><dl className={styles.facts}><div><dt>Повідомлення</dt><dd>{poll.messageId ? "Опубліковано" : "Немає"}</dd></div><div><dt>Оновлено</dt><dd>{formatDateTime(poll.updatedAt)}</dd></div><div><dt>Голосування</dt><dd>{state === "open" ? "Активне" : state === "paused" ? "Пауза" : "Вимкнене"}</dd></div></dl></PageSection>
    <PollVotes poll={poll} />
  </div>;
}
```

## src/components/polls/PollVotes.tsx

```tsx
import {raidPollVoteSchedule,raidPollAvailabilityLabel,raidPollRoleLabel,type RaidPollItem} from "@/lib/raidPolls";
import {pollDays,formatDateTime,voteDisplayName} from "@/lib/raidPollPresentation";
import PageSection from "@/components/page/PageSection";
import EmptyState from "@/components/page/EmptyState";
import StatusBadge from "@/components/page/StatusBadge";
import DataTable from "@/components/ui/DataTable";
import styles from "./poll-workspace.module.css";
export default function PollVotes({poll}: {poll: RaidPollItem}) {
  const days = pollDays(poll), votes = [...poll.votes].sort((a,b) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0));
  return <PageSection id={`poll-${poll.id}-votes-title`} title="Усі голоси" description={`${votes.length} голосів. Останні зміни зверху.`}>
    {votes.length ? <DataTable caption="Голоси учасників" headings={["Учасник", "Доступність", "Оновлено"]} tableClassName={styles.table}>
      {votes.map(vote => {const schedule = raidPollVoteSchedule(vote); return <tr key={vote.discordId}><th scope="row"><strong>{voteDisplayName(vote)}</strong><small>{raidPollRoleLabel(vote.role)}</small></th>
        <td><div className={styles.actions}>{days.map(day => <StatusBadge key={day.value} tone={schedule[day.value] === "absent" ? "neutral" : schedule[day.value] ? "success" : "neutral"}>{day.label}: {raidPollAvailabilityLabel(schedule[day.value])}</StatusBadge>)}</div></td>
        <td>{formatDateTime(vote.updatedAt)}</td></tr>;})}
    </DataTable> : <EmptyState title="Голосів поки немає" description="Відкрий повідомлення Discord і вкажи доступність. Результат зʼявиться тут." />}
  </PageSection>;
}
```

## src/components/polls/poll-workspace.module.css

```css
.stack { display: grid; gap: var(--section-gap); min-width: 0; }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-xs); align-items: center; min-width: 0; }
.actions :global(.btn) { white-space: normal; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-md); margin: 0; min-width: 0; }
.facts > div { display: grid; gap: var(--space-2xs); min-width: 0; }
.facts dt, .metadata, .facts small { font-size: var(--font-size-meta); color: var(--text-muted); line-height: var(--line-height-copy); }
.facts dd { margin: 0; font-size: var(--font-size-body-sm); color: var(--text-body); overflow-wrap: anywhere; }
.facts small { display: block; margin-top: var(--space-2xs); }
.selection { display: inline-flex; gap: var(--space-xs); align-items: center; color: var(--text-soft); font-size: var(--font-size-body-sm); }
.bulk { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); padding: var(--panel-padding); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); }
.result, .results { color: var(--text-soft); font-size: var(--font-size-body-sm); overflow-wrap: anywhere; }
.result:empty { position: absolute; width: var(--stroke-width); height: var(--stroke-width); overflow: hidden; clip-path: inset(50%); margin: 0; padding: 0; }
.results { display: grid; gap: var(--space-xs); margin: 0; padding: var(--space-md); }
.results li { display: grid; gap: var(--space-xs); padding: var(--space-sm); border-bottom: var(--stroke-width) solid var(--border); }
.details { border-top: var(--stroke-width) solid var(--border); padding-top: var(--space-sm); min-width: 0; font-size: var(--font-size-body-sm); color: var(--text-soft); line-height: var(--line-height-copy); }
.details > summary { cursor: pointer; min-height: var(--control-height); color: var(--text-body); }
.times, .voters { display: grid; gap: var(--space-xs); list-style: none; margin: 0; padding: 0; min-width: 0; }
.times > li { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: var(--space-sm); color: var(--text-body); font-size: var(--font-size-body-sm); }
.voters > li { display: grid; gap: var(--space-2xs); padding: var(--space-xs); border-bottom: var(--stroke-width) solid var(--border); overflow-wrap: anywhere; }
.voters span { color: var(--text-muted); font-size: var(--font-size-meta); }
.table { table-layout: fixed; width: 100%; }
.table :is(th,td) { font-size: var(--font-size-body-sm); font-weight: var(--font-weight-ui); }
.table small { display: block; color: var(--text-muted); font-size: var(--font-size-meta); margin-top: var(--space-2xs); }
.actions > .result:not(:empty) { flex-basis: 100%; }
```

## src/components/raids/RaidDetailsView.tsx

```tsx
import Link from "next/link";
import type {RaidDetailsWorkspaceModel} from "@/services/raidDetailsWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import ErrorState from "@/components/page/ErrorState";
import EmptyState from "@/components/page/EmptyState";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import PageErrorBoundary from "@/components/page/PageErrorBoundary";
import DiscordPublicationWorkbench from "@/components/DiscordPublicationWorkbench";
import RaidLiveSync from "@/components/RaidLiveSync";
import ListReturnLink from "@/components/ListReturnLink";
import {listNavigationScope} from "@/lib/listNavigationScope";
import {raidLiveRevision,raidTitle} from "@/lib/raids";
import RaidOverview from "./RaidOverview";
import RaidManageActions from "./RaidManageActions";
import {RosterSideList} from "./RaidRoster";
import styles from "@/components/community/workspace.module.css";
export default function RaidDetailsView({user,canManage,canSeeRoster,raid,unavailable,canReturnToList}: RaidDetailsWorkspaceModel) {
  return <PageContainer label="Сторінка рейду" navigation={<DashboardIdentity user={user} activeSection="raids" />}>
    <PageHeader title={raid ? raidTitle(raid) : "Сторінка рейду"} description="Склад, умови участі та розподіл паті. Запис і зміна статусу участі — через Discord."
      breadcrumbs={[{label:"Рейди",href:"/raids"},{label:raid ? raidTitle(raid) : "Деталі"}]} actions={raid?.messageUrl ? <a className="btn primary" href={raid.messageUrl} target="_blank" rel="noreferrer">Відкрити в Discord ↗</a> : null} />
    {canReturnToList ? <ListReturnLink kind="raids" scope={listNavigationScope(user)} /> : null}
    {unavailable ? <ErrorState title="Рейд тимчасово недоступний" description="Не вдалося прочитати дані рейду. Спробуй повторити." actions={<PageRefreshButton />} /> : raid ? <>
      <RaidLiveSync raidId={raid.id} initialRevision={raidLiveRevision(raid)} />
      {canManage ? <PageErrorBoundary resetKey={raid.id}><DiscordPublicationWorkbench kind="raid" id={raid.id} /></PageErrorBoundary> : null}
      <div className={canSeeRoster ? styles.columns : styles.stack}>
        <RaidOverview raid={raid} showRosterDetails={canSeeRoster} showMemberItemLevels={canManage} showBenchPriorityMarkers={canManage} manageActions={canManage ? <RaidManageActions raid={raid} /> : null} />
        {canSeeRoster ? <RosterSideList raid={raid} showItemLevel={canManage} showBenchPriorityMarkers={canManage} /> : null}
      </div>
    </> : <EmptyState title="Рейд недоступний" description="Рейд не знайдено, не опубліковано або видалено." actions={<Link className="btn subtle" href="/raids">До списку рейдів</Link>} />}
  </PageContainer>;
}
```

## src/components/raids/RaidDirectoryCard.tsx

```tsx
import Link from "next/link";
import {listEntryId} from "@/lib/listViewState";
import {buildRaidGroupLayout, raidGroupLayoutSlotCounts, raidDisplayCapacity, raidAverageItemLevel, raidRegistrationLockSummary, raidTitle, isRaidClosed, resolveRaidThumbnailUrl, type RaidItem} from "@/lib/raids";
import {raidStatusLabel} from "@/lib/raidPresentation";
import {formatRaidDateTime} from "@/components/RaidSignupPresentation";
import DataCard from "@/components/page/DataCard";
import StatusBadge from "@/components/page/StatusBadge";
import Progress from "@/components/page/Progress";
import RaidManageActions from "./RaidManageActions";
import styles from "./raid-workspace.module.css";
export default function RaidDirectoryCard({raid,canManage = false}: {raid: RaidItem; canManage?: boolean}) {
  const layout = buildRaidGroupLayout(raid), counts = raidGroupLayoutSlotCounts(layout), capacity = layout.targetSize || raidDisplayCapacity(raid);
  const lock = raidRegistrationLockSummary(raid), average = raidAverageItemLevel(raid), href = `/raids/${encodeURIComponent(raid.id)}`;
  return <DataCard id={listEntryId("raids",raid.id)} listEntry="raids" title={raidTitle(raid)} titleHref={href} description={formatRaidDateTime(raid.date,raid.time)}
    badge={<StatusBadge tone={raid.status === "draft" ? "warning" : isRaidClosed(raid) ? "neutral" : "success"}>{raidStatusLabel(raid)}</StatusBadge>}
    actions={<><Link className="btn primary" href={href} prefetch={false}>Відкрити рейд</Link>{canManage ? <RaidManageActions raid={raid} /> : null}</>}>
    <div className={styles.identity}><img className={styles.thumbnail} src={resolveRaidThumbnailUrl(raid)} alt="" width={64} height={64} loading="lazy" decoding="async" /><span>{raid.raidLeaderName ? `РЛ: ${raid.raidLeaderName}` : "Рейд-лідер не вказаний"}{lock.enabled ? <small>{lock.label}</small> : null}</span></div>
    <dl className={styles.facts}><div><dt>Основа</dt><dd>{counts.roster} / {capacity}</dd></div><div><dt>Ролі</dt><dd>Танки {counts.tanks} · хіли {counts.healers} · ДД {counts.dps}</dd></div><div><dt>Лава</dt><dd>{layout.bench.members.length}</dd></div><div><dt>Середній ilvl</dt><dd>{average || "—"}</dd></div></dl>
    <Progress value={counts.roster} max={capacity} label={`Заповнення рейду ${counts.roster} з ${capacity}`} />
  </DataCard>;
}
```

## src/components/raids/RaidDirectoryView.tsx

```tsx
import Link from "next/link";
import type {RaidDirectoryWorkspaceModel} from "@/services/raidDirectoryWorkspace";
import DashboardIdentity from "@/components/DashboardIdentity";
import PageContainer from "@/components/page/PageContainer";
import PageHeader from "@/components/page/PageHeader";
import PageSection from "@/components/page/PageSection";
import DataGrid from "@/components/page/DataGrid";
import FilterToolbar from "@/components/page/FilterToolbar";
import FilterNavigationForm from "@/components/page/FilterNavigationForm";
import EmptyState from "@/components/page/EmptyState";
import ErrorState from "@/components/page/ErrorState";
import Notice from "@/components/page/Notice";
import PageRefreshButton from "@/components/page/PageRefreshButton";
import FormField from "@/components/ui/FormField";
import Button from "@/components/ui/Button";
import DropdownMenu from "@/components/ui/DropdownMenu";
import ListViewMemory from "@/components/ListViewMemory";
import {listNavigationScope} from "@/lib/listNavigationScope";
import {formatRaidDateTime} from "@/components/RaidSignupPresentation";
import RaidArchiveLoadMore from "@/components/RaidArchiveLoadMore";
import RaidDirectoryCard from "./RaidDirectoryCard";
export default function RaidDirectoryView(model: RaidDirectoryWorkspaceModel) {
  const {user,canManage,unavailable,discordEnabled,activeRaids,draftRaids,closedRaids,nextRaid,currentUrl,query,state,visibleCurrent,visibleArchive} = model;
  const empty = <EmptyState title={query || state !== "all" ? "Рейдів за цими фільтрами немає" : "Рейди ще не створені"} description="Зміни пошук, скинь фільтри або повернись пізніше." actions={<Link className="btn subtle" href="/raids?view=all" data-list-reset-position>Показати всі рейди</Link>} />;
  return <PageContainer label="Рейди" navigation={<DashboardIdentity user={user} activeSection="raids" />}>
    <PageHeader title="Рейди" description="Поточні рейди, їхній склад та архів. Запис на участь відбувається через Discord."
      breadcrumbs={[{label: "Рейди"}]} actions={canManage ? <><Link className="btn primary" href="/raids/new">Створити рейд</Link><DropdownMenu label="Інші інструменти" items={[{id:"roster",label:"Збір сезонного складу",href:"/roster"},{id:"polls",label:"Рейд-пули",href:"/polls"},{id:"bench",label:"Сірий список",href:"/raids/bench-priority"}]} /></> : null}
      metrics={[{label:"Активні",value:unavailable ? "—" : activeRaids.length},...(canManage ? [{label:"Чернетки",value:unavailable ? "—" : draftRaids.length}] : []),{label:"Архів",value:unavailable ? "—" : closedRaids.length},{label:"Найближчий рейд",value:unavailable ? "—" : nextRaid ? formatRaidDateTime(nextRaid.date,nextRaid.time) : "Немає"}]} />
    {canManage && !discordEnabled ? <Notice title="Публікація в Discord недоступна" tone="warning">Чернетки можна підготувати й опублікувати після відновлення підключення.</Notice> : null}
    <FilterNavigationForm key={`${query}:${state}`} action="/raids"><FilterToolbar label="Пошук і фільтри рейдів" search={<FormField label="Пошук рейду" name="q" type="search" maxLength={160} defaultValue={query} placeholder="Назва, дата або ID" />}
      filters={<label>Стан<select name="state" defaultValue={state}><option value="all">Усі</option><option value="active">Активні</option>{canManage ? <option value="draft">Чернетки</option> : null}<option value="closed">Архів</option></select></label>}
      actions={<><Button tone="primary" type="submit">Застосувати</Button><Link className="btn subtle" href="/raids?view=all" data-list-reset-position>Скинути</Link></>} /></FilterNavigationForm>
    <ListViewMemory key={listNavigationScope(user)} kind="raids" scope={listNavigationScope(user)} currentUrl={currentUrl} clientLocation restorePosition={!unavailable} />
    {unavailable ? <ErrorState title="Рейди тимчасово недоступні" description="Не вдалося отримати список рейдів. Фільтри збережено." actions={<PageRefreshButton />} /> : <>
      {state !== "closed" ? <PageSection id="raids-current-title" title="Поточні рейди" description={canManage ? "Опубліковані рейди та чернетки." : "Опубліковані рейди для перегляду."}>{visibleCurrent.length ? <DataGrid label="Поточні рейди" columns="two">{visibleCurrent.map(raid => <RaidDirectoryCard key={raid.id} raid={raid} canManage={canManage} />)}</DataGrid> : empty}</PageSection> : null}
      {state === "all" || state === "closed" ? <PageSection id="raids-archive-title" title="Минулі рейди" description={`Знайдено: ${visibleArchive.length}. Склад і записи зберігаються в архіві.`}>{visibleArchive.length ? <RaidArchiveLoadMore step={6} total={visibleArchive.length}>{visibleArchive.map(raid => <RaidDirectoryCard key={raid.id} raid={raid} canManage={canManage} />)}</RaidArchiveLoadMore> : empty}</PageSection> : null}
    </>}
  </PageContainer>;
}
```

## src/components/raids/RaidManageActions.tsx

```tsx
import Link from "next/link";
import {isRaidClosed, raidTitle, type RaidItem} from "@/lib/raids";
import DropdownMenu from "@/components/ui/DropdownMenu";
import Button from "@/components/ui/Button";
export default function RaidManageActions({raid}: {raid: RaidItem}) {
  return <DropdownMenu label={`Керування: ${raidTitle(raid)}`}>
    <Link className="btn subtle" href={`/raids/${encodeURIComponent(raid.id)}/edit`} prefetch={false}>Редагувати</Link>
    {!isRaidClosed(raid) && raid.status !== "draft" ? <form action={`/api/raids/${encodeURIComponent(raid.id)}/close`} method="post"><Button tone="warning" type="submit">Закрити рейд</Button></form> : null}
    <form action={`/api/raids/${encodeURIComponent(raid.id)}/delete`} method="post" data-confirm-message={raid.status === "draft" ? "Видалити чернетку рейду?" : "Видалити рейд і повʼязане оголошення та подію Discord?"}>
      <Button tone="danger" type="submit">{raid.status === "draft" ? "Видалити чернетку" : "Видалити рейд"}</Button>
    </form>
  </DropdownMenu>;
}
```

## src/components/raids/RaidOverview.tsx

```tsx
import type {ReactNode} from "react";
import {buildRaidGroupLayout, raidGroupLayoutSlotCounts, raidDisplayCapacity, raidAverageItemLevel, raidRegistrationLimit, raidRegistrationLockSummary, raidAutoCompositionLabel, raidConsumablesLabel, raidLootLabel, raidTitle, isRaidClosed, resolveRaidThumbnailUrl, type RaidItem} from "@/lib/raids";
import {DiscordMarkdown} from "@/components/DiscordMarkdown";
import {formatRaidDateTime} from "@/components/RaidSignupPresentation";
import {raidStatusLabel} from "@/lib/raidPresentation";
import PageSection from "@/components/page/PageSection";
import DataCard from "@/components/page/DataCard";
import DataGrid from "@/components/page/DataGrid";
import Notice from "@/components/page/Notice";
import StatusBadge from "@/components/page/StatusBadge";
import Progress from "@/components/page/Progress";
import {PartyCard, BenchCard} from "./RaidRoster";
import styles from "./raid-workspace.module.css";
export default function RaidOverview({raid, actions, manageActions, showRosterDetails = true, showMemberItemLevels = true, showBenchPriorityMarkers = showMemberItemLevels}: {
  raid: RaidItem; actions?: ReactNode; manageActions?: ReactNode; showRosterDetails?: boolean; showMemberItemLevels?: boolean; showBenchPriorityMarkers?: boolean;
}) {
  const layout = buildRaidGroupLayout(raid), counts = raidGroupLayoutSlotCounts(layout), capacity = layout.targetSize || raidDisplayCapacity(raid);
  const lock = raidRegistrationLockSummary(raid), closed = isRaidClosed(raid), average = raidAverageItemLevel(raid);
  return <div className={styles.stack}>
    <DataCard title={raidTitle(raid)} description={formatRaidDateTime(raid.date,raid.time)} badge={<StatusBadge tone={closed ? "neutral" : raid.status === "draft" ? "warning" : "success"}>{raidStatusLabel(raid)}</StatusBadge>} actions={manageActions}>
      <div className={styles.identity}><img className={styles.thumbnail} src={resolveRaidThumbnailUrl(raid)} alt="" width={64} height={64} /><span>{raid.raidLeaderName ? `РЛ: ${raid.raidLeaderName}` : "Рейд-лідер не вказаний"}</span></div>
      <div className={styles.description}><DiscordMarkdown value={raid.description} /></div>
      <dl className={styles.facts}><div><dt>Запис</dt><dd>{closed ? "Закрито" : lock.enabled ? lock.label : "Відкрито"}<small>{lock.enabled ? lock.detail : "До початку рейду через Discord"}</small></dd></div>
        <div><dt>Основний склад</dt><dd>{counts.roster} / {capacity}<Progress value={counts.roster} max={capacity} label={`Основа: ${counts.roster} з ${capacity}`} /></dd></div>
        <div><dt>Ролі</dt><dd>Танки {counts.tanks} · хіли {counts.healers} · ДД {counts.dps}<small>Ціль: {raidAutoCompositionLabel(raid)}</small></dd></div>
        <div><dt>Готовність</dt><dd>{average ? `${average} ilvl` : "—"}<small>Лава: {layout.bench.members.length}</small></dd></div>
        {raid.minItemLevel ? <div><dt>Мінімальний ilvl</dt><dd>{raid.minItemLevel} · {raid.minItemLevelRequired ? "Обовʼязково" : "Попередження"}</dd></div> : null}
        <div><dt>Розхідники</dt><dd>{raidConsumablesLabel(raid.consumables)}</dd></div><div><dt>Лут</dt><dd>{raidLootLabel(raid.lootMode)}</dd></div><div><dt>Створив</dt><dd>{raid.createdByName}{raid.createdByMain ? ` · ${raid.createdByMain}` : ""}</dd></div>
      </dl>
      {raid.discordEventUrl ? <a className="btn subtle" href={raid.discordEventUrl} target="_blank" rel="noreferrer">Подія в Discord ↗</a> : null}
    </DataCard>
    {closed ? <Notice title="Запис закрито">Склад зафіксовано. Доступний перегляд рейду та його учасників.</Notice> : raidRegistrationLimit(raid) && counts.roster >= capacity ? <Notice title="Основний склад заповнений">Нові активні записи потрапляють на лаву запасних до звільнення місця.</Notice> : null}
    {showRosterDetails && layout.warnings.length ? <Notice title="Перевір склад" tone="warning">{layout.warnings.join(" · ")}</Notice> : null}
    <PageSection id={`raid-${raid.id}-signup-title`} title="Участь через Discord" description={closed ? "Рейд закрито — доступний лише перегляд." : "Обери персонажа, спеціалізацію та статус участі в оголошенні Discord."}>
      {actions || (raid.messageUrl ? <a className="btn primary" href={raid.messageUrl} target="_blank" rel="noopener noreferrer">Відкрити оголошення в Discord ↗</a> : <Notice title="Оголошення очікується">Рейд-лідер ще не опублікував повідомлення для запису.</Notice>)}
    </PageSection>
    {showRosterDetails ? <PageSection id={`raid-${raid.id}-parties-title`} title="Паті рейду" description={`Паті: ${layout.parties.length} · основа: ${counts.roster}/${capacity} · лава: ${layout.bench.members.length}. Розподіл враховує ролі та критичні бафи.`}>
      <DataGrid label="Паті рейду" columns="two">{layout.parties.map(party => <PartyCard key={party.index} party={party} minItemLevel={raid.minItemLevel} minItemLevelRequired={raid.minItemLevelRequired} showItemLevel={showMemberItemLevels} benchPriority={raid.benchPriority || null} showBenchPriorityMarkers={showBenchPriorityMarkers} />)}</DataGrid>
      <BenchCard members={layout.bench.members} minItemLevel={raid.minItemLevel} minItemLevelRequired={raid.minItemLevelRequired} showItemLevel={showMemberItemLevels} benchPriority={raid.benchPriority || null} showBenchPriorityMarkers={showBenchPriorityMarkers} />
    </PageSection> : null}
  </div>;
}
```

## src/components/raids/RaidRoster.tsx

```tsx
import { pickWowAvatarImageUrl } from "@/lib/wowCharacters";

import { buildRaidGroupLayout, raidGroupLayoutSlotCounts, raidAutoComposition, raidDisplayCapacity, raidMinItemLevelWarning, raidMinItemLevelBlockMessage, raidBenchPriorityMatch, type RaidBenchPrioritySettings, type RaidCharacterRole, type RaidItem, type RaidParty, type RaidSignup } from "@/lib/raids";
import { RoleMarkerStack, raidPartyRoleLabel, signupSpecLabel } from "@/components/RaidSignupPresentation";

import Progress from "@/components/page/Progress";
import styles from "./raid-workspace.module.css";
function signupMarkers(
  item?: RaidSignup | null,
  options?: { hasItemLevelIssue?: boolean; isBenchPriority?: boolean },
) {
  if (!item) return "";
  return [
    options?.isBenchPriority ? "❌" : null,
    options?.hasItemLevelIssue ? "⚠️" : null,
    item.status === "tentative" ? "❓" : null,
    item.status === "late" ? "🕒" : null,
    item.verifiedGuild === false ? "🤝" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function signupDisplayName(
  item?: RaidSignup | null,
  options?: {
    showItemLevel?: boolean;
    hasItemLevelIssue?: boolean;
    isBenchPriority?: boolean;
  },
) {
  if (!item) return "—";
  const name = item.characterName || item.discordName || "Гравець";
  const showItemLevel = options?.showItemLevel !== false;
  const markers = signupMarkers(item, {
    hasItemLevelIssue: options?.hasItemLevelIssue,
    isBenchPriority: options?.isBenchPriority,
  });
  const value =
    showItemLevel && item.itemLevel ? `${name} • ${item.itemLevel}` : name;
  return markers ? `${markers} ${value}` : value;
}

function shouldShowBenchPriorityMarker(
  item: RaidSignup | null | undefined,
  benchPriority: RaidBenchPrioritySettings | null | undefined,
  enabled: boolean,
) {
  return Boolean(
    enabled && item && raidBenchPriorityMatch(item, benchPriority).matched,
  );
}

function signupExtraLabel(item?: RaidSignup | null) {
  if (!item) return "";
  // Ручний запис не має ані рівня, ані раси — офіцеру важливо бачити,
  // що клас і спек вказані вручну, а не підтягнуті з Battle.net.
  const manualNote = isManualSignup(item) ? "Ручний запис" : null;
  return [
    typeof item.level === "number" ? `Lvl ${item.level}` : null,
    item.raceName || null,
    item.faction || null,
    item.guildName || null,
    manualNote,
  ]
    .filter(Boolean)
    .join(" • ");
}

/** Запис без персонажа Battle.net: клас і спек обрані вручну. */
function isManualSignup(item?: RaidSignup | null) {
  return Boolean(item && !item.characterKey && item.manualClassKey && item.manualSpecKey);
}

function signupAvatarUrl(item?: RaidSignup | null) {
  if (!item) return null;
  return pickWowAvatarImageUrl(item.avatarUrl, item.renderUrl, item.mediaUrl);
}

function SignupAvatar({ item }: { item?: RaidSignup | null }) {
  if (!item)
    return (
      <span
        className={styles.avatarFallback}
        aria-hidden="true"
      >
        —
      </span>
    );
  const image = signupAvatarUrl(item);
  if (image) {
    return (
      <img
        className={styles.avatar}
        src={image}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer" decoding="async" />
    );
  }
  return (
    <span
      className={styles.avatarFallback}
      aria-hidden="true"
    >
      {(item.characterName || item.discordName || "A").charAt(0)}
    </span>
  );
}

function RoleRow({
  label,
  item,
  role,
  minItemLevel,
  minItemLevelRequired,
  showItemLevel = true,
  isBenchPriority = false,
}: {
  label: string;
  item?: RaidSignup | null;
  role: RaidCharacterRole;
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  showItemLevel?: boolean;
  isBenchPriority?: boolean;
}) {
  const block =
    showItemLevel && item
      ? raidMinItemLevelBlockMessage(
          { minItemLevel, minItemLevelRequired },
          item,
        )
      : null;
  const warning =
    showItemLevel && item
      ? raidMinItemLevelWarning({ minItemLevel, minItemLevelRequired }, item)
      : null;
  const issue = block || warning;
  return (
    <div
      className={styles.memberRow} data-role={role} data-warning={Boolean(issue)} data-blocked={Boolean(block)}
      aria-label={`${label}: ${signupDisplayName(item, { showItemLevel, hasItemLevelIssue: Boolean(issue), isBenchPriority })}`}
    >
      <RoleMarkerStack item={item} role={role} />
      <SignupAvatar item={item} />
      <span className={styles.memberCopy}>
        <strong>
          {signupDisplayName(item, {
            showItemLevel,
            hasItemLevelIssue: Boolean(issue),
            isBenchPriority,
          })}
        </strong>
        {item ? <small>{signupSpecLabel(item)}</small> : null}
        {item ? <small>{signupExtraLabel(item)}</small> : null}
        {issue ? <small className={styles.warning}>{issue}</small> : null}
      </span>
    </div>
  );
}

export function PartyCard({
  party,
  minItemLevel,
  minItemLevelRequired,
  showItemLevel = true,
  benchPriority = null,
  showBenchPriorityMarkers = false,
}: {
  party: RaidParty;
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  showItemLevel?: boolean;
  benchPriority?: RaidBenchPrioritySettings | null;
  showBenchPriorityMarkers?: boolean;
}) {
  const hasMembers = party.members.length > 0;
  return (
    <article className={styles.party}>
      <h3>Паті {party.index}</h3>
      {party.tank ? (
        <RoleRow
          label="Танк"
          role="tank"
          item={party.tank}
          minItemLevel={minItemLevel}
          minItemLevelRequired={minItemLevelRequired}
          showItemLevel={showItemLevel}
          isBenchPriority={shouldShowBenchPriorityMarker(
            party.tank,
            benchPriority,
            showBenchPriorityMarkers,
          )}
        />
      ) : null}
      {party.healer ? (
        <RoleRow
          label="Хіл"
          role="healer"
          item={party.healer}
          minItemLevel={minItemLevel}
          minItemLevelRequired={minItemLevelRequired}
          showItemLevel={showItemLevel}
          isBenchPriority={shouldShowBenchPriorityMarker(
            party.healer,
            benchPriority,
            showBenchPriorityMarkers,
          )}
        />
      ) : null}
      {party.dps.length ? (
        party.dps.map((member, index) => (
          <RoleRow
            key={`${party.index}-${member.discordId}-${member.characterName || member.discordName}-${index}`}
            label={raidPartyRoleLabel(member.role)}
            role={member.role}
            item={member}
            minItemLevel={minItemLevel}
            minItemLevelRequired={minItemLevelRequired}
            showItemLevel={showItemLevel}
            isBenchPriority={shouldShowBenchPriorityMarker(
              member,
              benchPriority,
              showBenchPriorityMarkers,
            )}
          />
        ))
      ) : !hasMembers ? (
        <RoleRow
          label="ДД"
          role="dps"
          item={null}
          minItemLevel={minItemLevel}
          minItemLevelRequired={minItemLevelRequired}
          showItemLevel={showItemLevel}
        />
      ) : null}
    </article>
  );
}

export function BenchCard({
  members,
  minItemLevel,
  minItemLevelRequired,
  showItemLevel = true,
  benchPriority = null,
  showBenchPriorityMarkers = false,
}: {
  members: RaidSignup[];
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  showItemLevel?: boolean;
  benchPriority?: RaidBenchPrioritySettings | null;
  showBenchPriorityMarkers?: boolean;
}) {
  if (!members.length) return null;
  return (
    <article className={styles.bench}>
      <h3>🪑 Лава запасних</h3>
      <div className={styles.benchMembers}>
        {members.map((member, index) => (
          <RoleRow
            key={`bench-${member.discordId}-${member.characterName || member.discordName}-${index}`}
            label={raidPartyRoleLabel(member.role)}
            role={member.role}
            item={member}
            minItemLevel={minItemLevel}
            minItemLevelRequired={minItemLevelRequired}
            showItemLevel={showItemLevel}
            isBenchPriority={shouldShowBenchPriorityMarker(
              member,
              benchPriority,
              showBenchPriorityMarkers,
            )}
          />
        ))}
      </div>
    </article>
  );
}

function RosterBlock({
  title,
  items,
  empty = "Поки порожньо",
  showItemLevel = true,
  minItemLevel,
  minItemLevelRequired,
  benchPriority = null,
  showBenchPriorityMarkers = false,
}: {
  title: string;
  items: RaidSignup[];
  empty?: string;
  showItemLevel?: boolean;
  minItemLevel?: number | null;
  minItemLevelRequired?: boolean | null;
  benchPriority?: RaidBenchPrioritySettings | null;
  showBenchPriorityMarkers?: boolean;
}) {
  return (
    <div className={styles.rosterBlock}>
      <h4>{title}</h4>
      {items.length ? (
        items.map((item) => {
          const issue = showItemLevel
            ? raidMinItemLevelBlockMessage(
                { minItemLevel, minItemLevelRequired },
                item,
              ) ||
              raidMinItemLevelWarning(
                { minItemLevel, minItemLevelRequired },
                item,
              )
            : null;
          const isBenchPriority = shouldShowBenchPriorityMarker(
            item,
            benchPriority,
            showBenchPriorityMarkers,
          );
          return (
            <div
              className={styles.memberRow} data-warning={Boolean(issue)} data-bench-priority={isBenchPriority}
              key={`${title}-${item.discordId}`}
            >
              <RoleMarkerStack
                item={item}
                role={item.role}
                iconClassName="raid-roster-role-icon"
              />
              <SignupAvatar item={item} />
              <span className={styles.memberCopy}>
                <strong>
                  {signupDisplayName(item, {
                    showItemLevel,
                    hasItemLevelIssue: Boolean(issue),
                    isBenchPriority,
                  })}
                </strong>
                <small>{signupSpecLabel(item) || item.discordName}</small>
                {signupExtraLabel(item) ? (
                  <small>{signupExtraLabel(item)}</small>
                ) : null}
              </span>
            </div>
          );
        })
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}

export function RosterSideList({
  raid,
  showItemLevel = true,
  showBenchPriorityMarkers = true,
}: {
  raid: RaidItem;
  showItemLevel?: boolean;
  showBenchPriorityMarkers?: boolean;
}) {
  const composition = raidAutoComposition(raid);
  const grouped = {
    tanks: raid.signups.filter(
      (item) => item.status !== "skipped" && item.role === "tank",
    ),
    healers: raid.signups.filter(
      (item) => item.status !== "skipped" && item.role === "healer",
    ),
    dps: raid.signups.filter(
      (item) => item.status !== "skipped" && item.role === "dps",
    ),
    tentative: raid.signups.filter((item) => item.status === "tentative"),
    late: raid.signups.filter((item) => item.status === "late"),
    skipped: raid.signups.filter((item) => item.status === "skipped"),
  };
  const layout = buildRaidGroupLayout(raid);
  const layoutCounts = raidGroupLayoutSlotCounts(layout);
  const layoutCapacity = layout.targetSize || raidDisplayCapacity(raid);
  const fillPercent = Math.min(
    100,
    Math.round((layoutCounts.roster / Math.max(1, layoutCapacity)) * 100),
  );
  const benchCount = layout.bench.members.length;
  return (
    <aside className={styles.rosterPanel}>
      <div className={styles.rosterHeading}>
        <div>
          <strong>Склад рейду</strong>
          <small>{fillPercent}% основи заповнено</small>
        </div>
        <span>
          {layoutCounts.roster} / {layoutCapacity}
        </span>
      </div>
      <Progress value={layoutCounts.roster} max={layoutCapacity} label={`Заповнення складу ${layoutCounts.roster} з ${layoutCapacity}`} />
      <div className={styles.roles} aria-label="Ролі у складі">
        <span className={styles.tank}>🛡 {layoutCounts.tanks}/{composition.tanks}</span>
        <span className={styles.healer}>✚ {layoutCounts.healers}/{composition.healers}</span>
        <span className={styles.dps}>⚔ {layoutCounts.dps}/{composition.dps}</span>
        {benchCount ? <span className={styles.metadata}>Лава {benchCount}</span> : null}
      </div>
      <RosterBlock
        title={`Танки (${grouped.tanks.length}/${composition.tanks})`}
        items={grouped.tanks}
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
      <RosterBlock
        title={`Хіли (${grouped.healers.length}/${composition.healers})`}
        items={grouped.healers}
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
      <RosterBlock
        title={`ДД (${grouped.dps.length}/${composition.dps})`}
        items={grouped.dps}
        showItemLevel={showItemLevel}
        minItemLevel={raid.minItemLevel}
        minItemLevelRequired={raid.minItemLevelRequired}
        benchPriority={raid.benchPriority || null}
        showBenchPriorityMarkers={showBenchPriorityMarkers}
      />
      {grouped.tentative.length ? (
        <RosterBlock
          title={`50/50 (${grouped.tentative.length})`}
          items={grouped.tentative}
          showItemLevel={showItemLevel}
          minItemLevel={raid.minItemLevel}
          minItemLevelRequired={raid.minItemLevelRequired}
          benchPriority={raid.benchPriority || null}
          showBenchPriorityMarkers={showBenchPriorityMarkers}
        />
      ) : null}
      {grouped.late.length ? (
        <RosterBlock
          title={`Затримаюсь (${grouped.late.length})`}
          items={grouped.late}
          showItemLevel={showItemLevel}
          minItemLevel={raid.minItemLevel}
          minItemLevelRequired={raid.minItemLevelRequired}
          benchPriority={raid.benchPriority || null}
          showBenchPriorityMarkers={showBenchPriorityMarkers}
        />
      ) : null}
      {grouped.skipped.length ? (
        <RosterBlock
          title={`Пропускають (${grouped.skipped.length})`}
          items={grouped.skipped}
          showItemLevel={showItemLevel}
          minItemLevel={raid.minItemLevel}
          minItemLevelRequired={raid.minItemLevelRequired}
          benchPriority={raid.benchPriority || null}
          showBenchPriorityMarkers={showBenchPriorityMarkers}
        />
      ) : null}
    </aside>
  );
}
```

## src/components/raids/raid-workspace.module.css

```css
.stack, .rosterPanel { display: grid; gap: var(--section-gap); min-width: 0; }
.identity { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; color: var(--text-body); font-size: var(--font-size-body-sm); }
.identity > span { display: grid; gap: var(--space-2xs); overflow-wrap: anywhere; }
.thumbnail { border-radius: var(--control-radius); object-fit: cover; flex: none; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--dropdown-min)), 1fr)); gap: var(--space-sm); margin: var(--space-md) 0; min-width: 0; }
.facts > div { display: grid; gap: var(--space-2xs); min-width: 0; }
.facts dt, .metadata, .identity small { color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-copy); }
.facts dd { margin: 0; color: var(--text-body); font-size: var(--font-size-body-sm); overflow-wrap: anywhere; }
.facts small { display: block; margin-top: var(--space-xs); color: var(--text-muted); font-size: var(--font-size-meta); }
.description { color: var(--text-soft); font-size: var(--font-size-body); line-height: var(--line-height-copy); overflow-wrap: anywhere; }
.party, .bench, .rosterBlock { display: grid; align-content: start; gap: var(--space-xs); padding: var(--panel-padding); border: var(--stroke-width) solid var(--border); border-radius: var(--card-radius); background: var(--surface); min-width: 0; }
.party h3, .bench h3, .rosterBlock h4 { margin: 0; color: var(--text-strong); font-size: var(--heading-card-size); }
.benchMembers { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--data-grid-min)), 1fr)); gap: var(--space-xs); }
.memberRow { display: flex; align-items: start; gap: var(--space-xs); padding: var(--space-xs); border-bottom: var(--stroke-width) solid var(--border-subtle); min-width: 0; }
.memberRow[data-warning="true"] { background: var(--tint-warning-bg); border-color: var(--tint-warning-border); }
.memberRow[data-blocked="true"] { background: var(--tint-danger-bg); border-color: var(--tint-danger-border); }
.memberCopy { display: grid; gap: var(--space-2xs); min-width: 0; overflow-wrap: anywhere; }
.memberCopy strong { color: var(--text-body); font-size: var(--font-size-body-sm); font-weight: var(--font-weight-semibold); }
.memberCopy small { color: var(--text-muted); font-size: var(--font-size-meta); line-height: var(--line-height-copy); }
.avatar, .avatarFallback { width: var(--control-height-sm); height: var(--control-height-sm); border-radius: var(--control-radius); flex: none; object-fit: cover; }
.avatarFallback { display: grid; place-items: center; background: var(--surface-raised); color: var(--text-muted); }
.rosterHeading, .roles { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-sm); }
.rosterHeading > div { display: grid; gap: var(--space-2xs); }
.rosterHeading strong { color: var(--text-strong); font-size: var(--heading-card-size); }
.rosterHeading small { color: var(--text-muted); font-size: var(--font-size-meta); }
.tank { color: var(--c-role-tank); }
.healer { color: var(--c-role-healer); }
.dps { color: var(--c-role-dps); }
.warning { color: var(--text-on-warning); }
.archive { display: grid; gap: var(--space-md); min-width: 0; }
.archiveFooter { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-sm); color: var(--text-muted); font-size: var(--font-size-meta); }
```

## src/components/ui/DropdownMenu.tsx

```tsx
"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Link from "next/link";
import Button from "./Button";
import styles from "../page/page-system.module.css";

type MenuBase = { id: string; label: string; disabled?: boolean; danger?: boolean };
export type DropdownMenuItem = MenuBase & (
  | { href: string; onSelect?: never }
  | { href?: never; onSelect: () => void }
);

/** Native disclosure, normal Tab order; no incomplete ARIA menu implementation. */
export default function DropdownMenu({ label = "Інші дії", items = [], children, closeOnAction = true }: { label?: string; items?: readonly DropdownMenuItem[]; children?: ReactNode; closeOnAction?: boolean }) {
  const root = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const panelId = useId();
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) root.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  if (!items.length && !children) return null;
  return <details className={styles.dropdown} ref={root} onKeyDown={event => {
    if (event.key === "Escape" && root.current?.open) {
      event.preventDefault(); root.current.open = false; trigger.current?.focus();
    }
  }}>
    <summary className={`btn subtle ${styles.dropdownTrigger}`} ref={trigger} aria-controls={panelId}>{label}<span aria-hidden="true">⌄</span></summary>
    <div id={panelId} className={styles.dropdownPanel} aria-label={label} onClick={event => {
      if (!closeOnAction) return;
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button:not(:disabled)") : null;
      if (button) {
        root.current?.removeAttribute("open");
        // Native form submitters retain focus ownership for useActionFocus.
        // Moving focus to summary here would suppress the mutation result.
        if (button.type !== "submit") trigger.current?.focus();
      }
    }}>
      {children}
      {items.map(item => item.href !== undefined
        ? item.disabled
          ? <span key={item.id} className={styles.dropdownItem} aria-disabled="true">{item.label}</span>
          : <Link key={item.id} href={item.href} className={styles.dropdownItem} data-danger={item.danger || undefined}
              onClick={() => root.current?.removeAttribute("open")}>{item.label}</Link>
        : <Button key={item.id} disabled={item.disabled} tone={item.danger ? "danger" : "ghost"} onClick={() => {
            root.current?.removeAttribute("open"); trigger.current?.focus(); item.onSelect();
          }}>{item.label}</Button>)}
    </div>
  </details>;
}
```

## src/lib/guildRosterPresentation.ts

```ts
import type { GuildRosterMember, GuildRosterStats, GuildRaidProgress } from "@/lib/guildRoster";
import { primaryCurrentRaidProgress } from "@/lib/characterRaidProgress";
export function normalizedRaidProgress(member: GuildRosterMember) {
  return Array.isArray(member.raidProgression) ? member.raidProgression : [];
}

export function bestRaid(member: GuildRosterMember, snapshot: GuildRosterStats["raidSeasonSnapshot"], raidSlug = "all") {
  const raids = normalizedRaidProgress(member);
  if (raidSlug !== "all") {
    return raids.find((raid) => raid.slug === raidSlug) || null;
  }
  return primaryCurrentRaidProgress(raids, snapshot);
}

export function raidWeight(raid: GuildRaidProgress | null) {
  if (!raid) return 0;
  return raid.mythicKills * 1_000_000 + raid.heroicKills * 10_000 + raid.normalKills * 100 + raid.totalBosses;
}

export function raidIsClear(raid: GuildRaidProgress | null, difficulty: "normal" | "heroic" | "mythic") {
  if (!raid || raid.totalBosses <= 0) return false;
  if (difficulty === "mythic") return raid.mythicKills >= raid.totalBosses;
  if (difficulty === "heroic") return raid.heroicKills >= raid.totalBosses;
  return raid.normalKills >= raid.totalBosses;
}

export function raidHasProgress(raid: GuildRaidProgress | null) {
  return Boolean(raid && (raid.normalKills > 0 || raid.heroicKills > 0 || raid.mythicKills > 0));
}

export function raidSummary(raid: GuildRaidProgress | null) {
  if (!raid) return { main: "—", detail: "Немає даних" };
  const total = raid.totalBosses || 0;
  if (!total) return { main: raid.summary || "—", detail: raid.name };

  const highest = raid.mythicKills > 0
    ? `M ${raid.mythicKills}/${total}`
    : raid.heroicKills > 0
      ? `H ${raid.heroicKills}/${total}`
      : `N ${raid.normalKills}/${total}`;
  const detail = [
    raid.mythicKills > 0 ? `M ${raid.mythicKills}/${total}` : null,
    raid.heroicKills > 0 ? `H ${raid.heroicKills}/${total}` : null,
    raid.normalKills > 0 ? `N ${raid.normalKills}/${total}` : null,
  ].filter(Boolean).join(" · ") || raid.summary || "Без убивств";

  return { main: highest, detail };
}

export function compactRaidName(name: string) {
  return name.length > 30 ? `${name.slice(0, 29)}…` : name;
}

export function friendlySource(value: string) {
  const source = String(value || "").toLowerCase();
  if (source.includes("raider")) return "Raider.IO → PostgreSQL";
  if (source.includes("battle")) return "Battle.net → PostgreSQL";
  if (source.includes("storage") || source.includes("database") || source.includes("records")) return "PostgreSQL";
  if (source.includes("live-sync")) return "Battle.net + Raider.IO";
  return value || "PostgreSQL";
}
```

## src/lib/raidPollPresentation.ts

```ts
import "server-only";
import { type RaidPollCardModel } from "@/components/RaidPollBrowser";

import { RAID_POLL_DAYS, RAID_POLL_TIMES, pollVoteCounts, raidPollDifficultyLabel, raidPollSlotSummary, raidPollUniqueDayRecommendations, raidPollStatusLabel, raidPollRemainingLabel, raidPollStateKey, raidPollRepeatScheduleLabel, type RaidPollItem } from "@/lib/raidPolls";

export function formatDateTime(isoOrMs: string | number | null | undefined) {
  if (!isoOrMs) return "—";
  const date = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("uk-UA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: process.env.RAID_TIME_ZONE || process.env.NEXT_PUBLIC_RAID_TIME_ZONE || "Europe/Kyiv",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

export function shortPollId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

export function pollCloseLabel(poll: RaidPollItem) {
  if (poll.status === "scheduled") return formatDateTime(poll.scheduledPublishAtMs || poll.scheduledPublishAt);
  if (poll.status === "closed") return poll.closedAt ? formatDateTime(poll.closedAt) : "Завершено";
  return formatDateTime(poll.closesAtMs);
}

export function bestDaySummary(poll: RaidPollItem, relatedPolls: RaidPollItem[] = [poll]) {
  const recommendations = raidPollUniqueDayRecommendations(poll, relatedPolls, 3);
  if (!recommendations.length) return raidPollSlotSummary(null);
  return recommendations.map((slot, index) => `${index + 1}) ${index === 2 ? "Дод.: " : ""}${raidPollSlotSummary(slot)}`).join(" / ");
}

export function roleBreakdown(poll: RaidPollItem) {
  let tanks = 0;
  let healers = 0;
  let dps = 0;
  for (const vote of poll.votes) {
    if (vote.role === "tank") tanks += 1;
    else if (vote.role === "healer") healers += 1;
    else if (vote.role === "dps") dps += 1;
  }
  return { tanks, healers, dps };
}

/**
 * Серверна проєкція пулу в легку модель для клієнтського списку.
 * Важкі розрахунки (рекомендації, ролі) лишаються на сервері — у браузер
 * їде тільки готовий текст, а не весь масив голосів.
 */
export function buildRaidPollCardModel(poll: RaidPollItem, relatedPolls: RaidPollItem[] = [poll]): RaidPollCardModel {
  const counts = pollVoteCounts(poll);
  const roles = roleBreakdown(poll);
  const state = raidPollStateKey(poll);

  return {
    id: poll.id,
    shortId: shortPollId(poll.id),
    title: poll.title,
    description: poll.description,
    difficulty: poll.difficulty,
    difficultyLabel: raidPollDifficultyLabel(poll.difficulty),
    state,
    statusLabel: raidPollStatusLabel(poll),
    dayLabels: pollDays(poll).map((day) => day.label),
    votes: counts.total,
    tanks: roles.tanks,
    healers: roles.healers,
    dps: roles.dps,
    deadlineCaption: state === "scheduled" ? "Публікація" : state === "closed" ? "Завершено" : state === "paused" ? "Заморожено" : "До закриття",
    deadlineLabel: pollCloseLabel(poll),
    remainingLabel: state === "closed" ? "—" : raidPollRemainingLabel(poll),
    recommendation: state === "scheduled" ? "Зʼявиться після початку голосування" : bestDaySummary(poll, relatedPolls),
    repeatLabel: raidPollRepeatScheduleLabel(poll),
    autoRepeat: Boolean(poll.autoRepeatWeekly),
    pausedNote: poll.pausedNote || null,
    messageUrl: poll.messageUrl || null,
  };
}

export function pollDays(poll: RaidPollItem) {
  const active = poll.days?.length ? poll.days : RAID_POLL_DAYS.map((day) => day.value);
  return RAID_POLL_DAYS.filter((day) => active.includes(day.value));
}

/**
 * Приймає вже пораховані counts. Раніше функція викликала pollVoteCounts()
 * усередині й запускалась для кожного з 7 днів — сім повних перерахунків
 * матриці голосів на один рендер сторінки.
 */
export function bestTimeForDay(counts: Record<string, number>) {
  const best = RAID_POLL_TIMES
    .map((time) => ({ time, count: counts[time] || 0 }))
    .sort((a, b) => b.count - a.count || RAID_POLL_TIMES.indexOf(a.time) - RAID_POLL_TIMES.indexOf(b.time))[0];
  return best && best.count > 0 ? `${best.time} · ${best.count}` : "—";
}

/** Підпис голосу — гільдійний нік Discord. Персонажів у пулі більше немає. */
export function voteDisplayName(vote: RaidPollItem["votes"][number]) {
  return vote.discordName || "Гравець";
}
```

## src/lib/raidPresentation.ts

```ts
import "server-only";
import {isRaidClosed, type RaidItem} from "@/lib/raids";
export function raidStatusLabel(raid: RaidItem) {
  if (isRaidClosed(raid)) return "Запис закрито";
  return raid.status === "published" ? "Опубліковано" : "Чернетка";
}

export function raidStatusClass(raid: RaidItem) {
  if (isRaidClosed(raid)) return "closed";
  return raid.status;
}
```

## src/services/applicationWorkspace.ts

```ts
import "server-only";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canManageApplications, canViewApplicationBattleTag, canViewApplications } from "@/lib/permissions";
import { listApplicationFilterOptions, listApplications, sanitizeApplicationsForMentorViewer } from "@/lib/applicationsStore";
import { getOwnProfilePath } from "@/lib/profiles";
import { listViewUrl } from "@/lib/listViewState";

export async function loadApplicationWorkspace({searchParams}: {searchParams: Promise<Record<string, string | undefined>>}) {
  const user = await getSessionUser();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  const mayViewApplications = canViewApplications(user);
  const mayManageApplications = canManageApplications(user);
  const mayViewSensitiveApplications = canViewApplicationBattleTag(user);
  if (!mayViewApplications) redirect(await getOwnProfilePath(user));
  const params = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) urlParams.set(key, value);
  const currentUrl = listViewUrl("applications", `/applications?${urlParams}`) || "/applications";
  const listParams = new URLSearchParams(currentUrl.split("?")[1] || "");
  const [listResult, optionResult] = await Promise.all([
    listApplications(listParams).then(items => ({items, unavailable: false})).catch(() => ({items: [], unavailable: true})),
    listApplicationFilterOptions().then(options => ({options, unavailable: false})).catch(() => ({options: {classes: [] as string[]}, unavailable: true})),
  ]);
  const rawItems = listResult.items;
  const filterOptions = optionResult.options;
  const unavailable = listResult.unavailable;
  const filtersUnavailable = optionResult.unavailable;
  const items = mayViewSensitiveApplications ? rawItems : sanitizeApplicationsForMentorViewer(rawItems);
  const counts = {
    all: items.length,
    review: items.filter((item) => item.status_key === "review").length,
    accepted: items.filter((item) => item.status_key === "accepted").length,
    declined: items.filter((item) => item.status_key === "declined").length
  };
  const classOptions = filterOptions.classes;

  const newestReview = items.find((item) => item.status_key === "review");
  return { user, params, currentUrl, listParams, items, counts, classOptions, newestReview, mayManageApplications, mayViewSensitiveApplications, unavailable, filtersUnavailable };
}
export type ApplicationWorkspaceModel = Awaited<ReturnType<typeof loadApplicationWorkspace>>;
```

## src/services/guildWorkspace.ts

```ts
import "server-only";
import { getSessionUser } from "@/lib/auth";
import { loadGuildRosterData } from "@/lib/guildRoster";
import { getDashboardApiSettings } from "@/lib/dashboardApiSettings";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";

export async function loadGuildWorkspace() {
  const user = await getSessionUser();
  // Public, read-only roster: Discord login is not required for viewing.

  const [roster, apiSettings] = await Promise.all([
    loadGuildRosterData().catch((error) => {
      void recordDashboardSystemLog(
        "error",
        "page.guild.roster_read_failed",
        {
          summary:
            "Сторінка складу відкрилась без даних зі сховища: читання roster не спрацювало.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: true },
      );
      return {
        members: [],
        stats: {
          guildName: "Mistblossom Vanguard",
          guildRealm: "Terokkar",
          guildFaction: "Alliance",
          profileUrl: null,
          memberCount: 0,
          averageItemLevel: 0,
          averageRioAll: 0,
          maxItemLevel: 0,
          maxRioAll: 0,
          raidProgression: [],
          raidRankings: [],
          raidSeasonSnapshot: null,
          updatedAt: null,
        },
        source: "fallback",
        error:
          "Склад тимчасово недоступний. Сторінку відкрито без live-збору; синхронізація відновить записи в базі даних покроково.",
      };
    }),
    getDashboardApiSettings().catch((error) => {
      void recordDashboardSystemLog(
        "warning",
        "page.guild.settings_read_failed",
        {
          summary:
            "Налаштування синхронізації складу тимчасово недоступні, використано безпечні значення.",
          message:
            error instanceof Error ? error.message : String(error || "unknown"),
        },
        { persist: false },
      );
      return {
        guildRosterClientDrivenSyncEnabled: false,
        guildRosterClientStepDelayMs: 500,
        guildRosterClientRequestTimeoutMs: 25_000,
        guildRosterClientMaxSteps: 500,
      };
    }),
  ]);
  const members = roster.members;
  const storageLimited = roster.source === "storage-temporary-unavailable" && members.length === 0;

  return {user, roster, apiSettings, storageLimited};
}
export type GuildWorkspaceModel = Awaited<ReturnType<typeof loadGuildWorkspace>>;
```

## src/services/pollWorkspace.ts

```ts
import "server-only";
import {redirect} from "next/navigation";
import {getSession} from "@/lib/auth";
import {canManageRaids,canViewRaidDirectory} from "@/lib/permissions";
import {getOwnProfilePath} from "@/lib/profiles";
import {hasDiscordEmbedConfig} from "@/lib/discordAdmin";
import {getRaidPoll, hasRaidPollStorage,listRaidPolls,raidPollStateKey} from "@/lib/raidPolls";
async function context() {
  const user = await getSession();
  if (user && !canViewRaidDirectory(user)) redirect(await getOwnProfilePath(user));
  return {user,canManage: canManageRaids(user)};
}
export async function loadPollDirectoryWorkspace() {
  const {user,canManage} = await context();
  let unavailable = !hasRaidPollStorage();
  const polls = await listRaidPolls(120).catch(() => {unavailable = true; return [];});
  const publishedPolls = polls.filter(poll => poll.channelId && poll.messageId);
  const visiblePolls = canManage ? polls : publishedPolls;
  const counts = {scheduled: visiblePolls.filter(poll => raidPollStateKey(poll) === "scheduled").length,open: visiblePolls.filter(poll => raidPollStateKey(poll) === "open").length,paused: visiblePolls.filter(poll => raidPollStateKey(poll) === "paused").length};
  return {user,canManage,publishedPolls,visiblePolls,counts,unavailable,discordEnabled: hasDiscordEmbedConfig()};
}
export async function loadPollDetailsWorkspace({params}: {params: Promise<{pollId: string}>}) {
  const {user,canManage} = await context(), {pollId} = await params;
  let unavailable = !hasRaidPollStorage(), relatedUnavailable = false;
  const storedPoll = await getRaidPoll(pollId).catch(() => {unavailable = true; return null;});
  const poll = storedPoll && (canManage || storedPoll.channelId && storedPoll.messageId) ? storedPoll : null;
  const relatedPolls = poll ? (await listRaidPolls(120).catch(() => {relatedUnavailable = true;return [poll];})).filter(item => item.channelId && item.messageId) : [];
  return {user,canManage,poll,relatedPolls,unavailable,relatedUnavailable};
}
export type PollDirectoryWorkspaceModel = Awaited<ReturnType<typeof loadPollDirectoryWorkspace>>;
export type PollDetailsWorkspaceModel = Awaited<ReturnType<typeof loadPollDetailsWorkspace>>;
```

## src/services/raidDetailsWorkspace.ts

```ts
import "server-only";
import {getSession} from "@/lib/auth";
import {canManageRaids, canViewRaidRoster, canViewRaidDirectory} from "@/lib/permissions";
import {getRaid, hasRaidStorage} from "@/lib/raids";
export async function loadRaidDetailsWorkspace({params}: {params: Promise<{raidId: string}>}) {
  const user = await getSession(), canManage = canManageRaids(user), canSeeRoster = !user || canViewRaidRoster(user);
  const {raidId} = await params;
  let unavailable = !hasRaidStorage();
  const raid = await getRaid(raidId).catch(() => {unavailable = true; return null;});
  const visibleRaid = raid && (raid.status === "published" || raid.status === "closed" || canManage) ? raid : null;
  return {user,canManage,canSeeRoster,raid: visibleRaid,unavailable,canReturnToList: Boolean(user && canViewRaidDirectory(user))};
}
export type RaidDetailsWorkspaceModel = Awaited<ReturnType<typeof loadRaidDetailsWorkspace>>;
```

## src/services/raidDirectoryWorkspace.ts

```ts
import "server-only";
import { listViewUrl } from "@/lib/listViewState";
import { matchesRaidListSearch } from "@/lib/raidListSearch";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canManageRaids } from "@/lib/permissions";
import { hasDiscordEmbedConfig } from "@/lib/discordAdmin";
import { hasRaidStorage, isRaidClosed, listRaids } from "@/lib/raids";
import { recordDashboardSystemLog } from "@/lib/dashboardSystemLogs";

export async function loadRaidDirectoryWorkspace({searchParams}: {searchParams: Promise<Record<string, string | undefined>>}) {
  const user = await getSession();

  const canManage = canManageRaids(user);
  const params = await searchParams;
  if (params.raid) redirect(`/raids/${encodeURIComponent(params.raid)}`);

  let unavailable = !hasRaidStorage();
  const raids = await listRaids(100).catch((error) => {
    unavailable = true;
    void recordDashboardSystemLog(
      "error",
      "page.raids.list_read_failed",
      {
        summary:
          "Сторінка рейдів відкрилась без списку: читання рейдів не спрацювало.",
        message:
          error instanceof Error ? error.message : String(error || "unknown"),
      },
      { persist: true },
    );
    return [];
  });
  const activeRaids = raids.filter(
    (raid) => raid.status === "published" && !isRaidClosed(raid),
  );
  const draftRaids = canManage
    ? raids.filter((raid) => raid.status === "draft")
    : [];
  const closedRaids = raids.filter((raid) => isRaidClosed(raid) && (canManage || raid.status === "published" || raid.status === "closed"));
  const currentRaids = canManage
    ? [...activeRaids, ...draftRaids]
    : activeRaids;
  const nextRaid = activeRaids[0] || null;
  const rawQuery = new URLSearchParams();
  for (const key of ["q", "state", "archive"]) if (typeof params[key] === "string") rawQuery.set(key, params[key]!);
  const currentUrl = listViewUrl("raids", `/raids?${rawQuery}`) || "/raids";
  const filters = new URL(currentUrl, "https://list.invalid").searchParams;
  const query = filters.get("q") || "";
  const state = filters.get("state") || "all";
  const visibleCurrent = currentRaids.filter(raid => matchesRaidListSearch(raid, query) && (state === "all" || state === "active" && raid.status === "published" || state === "draft" && raid.status === "draft"));
  const visibleArchive = closedRaids.filter(raid => matchesRaidListSearch(raid, query));

  return {user, canManage, params, raids, unavailable, discordEnabled: hasDiscordEmbedConfig(), activeRaids, draftRaids, closedRaids, nextRaid, currentUrl, query, state, visibleCurrent, visibleArchive};
}
export type RaidDirectoryWorkspaceModel = Awaited<ReturnType<typeof loadRaidDirectoryWorkspace>>;
```

