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
