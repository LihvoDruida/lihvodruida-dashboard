import type { ReactNode } from "react";

export type DashboardNavSection =
  | "home"
  | "admin"
  | "applications"
  | "content"
  | "discord"
  | "guild"
  | "polls"
  | "profile"
  | "profiles"
  | "raids"
  | "roster"
  | "rules";

/**
 * Лінійні іконки навігації. Тримаємо їх інлайном (а не iconfont/бібліотекою),
 * щоб не тягнути клієнтський бандл і не мати FOUC на першому рендері.
 */
const PATHS: Record<DashboardNavSection, ReactNode> = {
  home: <path d="M3 10.2 12 3.5l9 6.7V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  applications: (
    <>
      <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h4M8.5 13h7M8.5 17h5" />
    </>
  ),
  raids: (
    <>
      <path d="m14.5 3.5 6 6-9.5 9.5-6-6z" />
      <path d="M4 20.5 7.5 17M17.5 3.5h3v3" />
    </>
  ),
  polls: (
    <>
      <path d="M5 20V11M12 20V4M19 20v-6" />
      <path d="M3 20h18" />
    </>
  ),
  roster: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.6 5.6 0 0 0-2.2-4.4" />
    </>
  ),
  guild: (
    <>
      <path d="M12 3 5 6v6.2c0 4 2.9 7.5 7 8.8 4.1-1.3 7-4.8 7-8.8V6z" />
      <path d="M9.5 12.2l1.8 1.9 3.4-3.7" />
    </>
  ),
  discord: (
    <>
      <path d="M8.2 6.4A14 14 0 0 1 12 6a14 14 0 0 1 3.8.4c2.6.7 3.7 2 3.7 2 1 2 1.5 4.3 1.4 6.7a11 11 0 0 1-3.6 2.6l-1.1-1.8" />
      <path d="M8.2 6.4S7.1 7.7 6.1 9.7a13 13 0 0 0-1.4 6.7 11 11 0 0 0 3.6 2.6l1.1-1.8" />
      <path d="M8.5 16.2a11 11 0 0 0 7 0" />
      <circle cx="9.3" cy="12.4" r="1.2" />
      <circle cx="14.7" cy="12.4" r="1.2" />
    </>
  ),
  profiles: (
    <>
      <circle cx="8.5" cy="8.5" r="3.2" />
      <path d="M3 20a5.5 5.5 0 0 1 11 0" />
      <path d="M15 4.5h6M15 8h6M15 11.5h4" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  content: (
    <>
      <path d="M4 5.5h11a2 2 0 0 1 2 2V20H6a2 2 0 0 1-2-2z" />
      <path d="M17 9h2a1 1 0 0 1 1 1v8.5a1.5 1.5 0 0 1-3 0z" />
      <path d="M7.5 9.5h6M7.5 13h6M7.5 16.5h4" />
    </>
  ),
  admin: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.5l2 1.2M17.5 15.3l2 1.2M4.5 16.5l2-1.2M17.5 8.7l2-1.2" />
    </>
  ),
  rules: (
    <>
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.2L5 21V4a1 1 0 0 1 1-1z" />
      <path d="M9 8h6M9 11.5h4" />
    </>
  ),
};

export default function DashboardNavIcon({ section }: { section: string }) {
  const icon = PATHS[section as DashboardNavSection] || PATHS.home;
  return (
    <svg
      className="dashboard-nav__icon"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icon}
    </svg>
  );
}
