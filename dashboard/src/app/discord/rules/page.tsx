import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import { getSession } from "@/lib/auth";
import {
  fetchDiscordRaidRulesSignups,
  fetchDiscordRaidRulesStats,
  fetchDiscordRoles,
  fetchDiscordRulesStats,
  fetchDiscordTextChannels,
  hasDiscordEmbedConfig,
  listRulesEmbedMessages,
  type DiscordEditableMessage,
  type DiscordRaidRulesSignupsResponse,
  type DiscordRaidRulesStats,
  type DiscordRoleOption,
  type DiscordRulesStats,
  type DiscordTextChannel,
} from "@/lib/discordAdmin";
import { buildPageMetadata } from "@/lib/seo";
import { getOwnProfilePath } from "@/lib/profiles";
import { canManageRulesEmbeds, canViewRulesStats } from "@/lib/permissions";

export const metadata = buildPageMetadata({
  title: "Правила Discord",
  description: "Правила сервера, правила рейду, статистика прийняття та список підписантів Mistblossom Vanguard в одному зрозумілому місці.",
  path: "/discord/rules",
  keywords: ["правила гільдії", "правила рейду", "Discord правила"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

function StatusNotice({ params }: { params: Record<string, string | undefined> }) {
  if (params.published) {
    return <div className="notice panel success discord-notice">Опубліковано правила: <a href={params.published} target="_blank" rel="noreferrer">відкрити</a></div>;
  }
  if (params.updated) {
    return <div className="notice panel success discord-notice">Оновлено правила: <a href={params.updated} target="_blank" rel="noreferrer">відкрити</a></div>;
  }
  if (params.error) return <div className="notice panel error-note discord-notice">{params.error}</div>;
  return null;
}

function roleName(roleId: string, roles: DiscordRoleOption[]) {
  return roles.find((role) => role.id === roleId)?.name || "Discord роль";
}

function roleColor(roleId: string, roles: DiscordRoleOption[]) {
  const color = Number(roles.find((role) => role.id === roleId)?.color || 0);
  if (!Number.isFinite(color) || color <= 0) return "#B8E986";
  return `#${Math.max(0, Math.min(0xffffff, Math.floor(color))).toString(16).padStart(6, "0")}`;
}

function shortDiscordUrl(url: string) {
  const text = String(url || "").trim();
  const match = text.match(/discord(?:app)?\.com\/channels\/(\d{16,25}|@me)\/(\d{16,25})\/(\d{16,25})/i);
  if (!match) return text.replace(/^https?:\/\/discord(?:app)?\.com\/channels\//i, "discord / ");
  return `discord / канал ${match[2].slice(-6)} / ${match[3].slice(-6)}`;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "ще немає";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "невідома дата" : date.toLocaleString("uk-UA");
}

function sourceLabel(source: string) {
  switch (source) {
    case "kv":
      return "Дані є";
    case "worker":
      return "Дані є";
    case "missing-kv-binding":
      return "Недоступно";
    case "invalid-binding":
      return "Недоступно";
    case "unconfigured":
      return "Недоступно";
    case "error":
      return "Недоступно";
    default:
      return source ? "Дані є" : "Невідомо";
  }
}

function metricValue(value: number | string, configured = true) {
  if (!configured) return "—";
  return typeof value === "number" ? value.toLocaleString("uk-UA") : value;
}

function RulesMetric({ label, value, hint, tone = "neutral" }: { label: string; value: number | string; hint: string; tone?: "neutral" | "good" | "bad" | "warn" }) {
  return (
    <div className={`discord-rules-metric discord-rules-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function RulesDataOverview({
  stats,
  raidStats,
  raidSignups,
  guildMessagesCount,
  raidMessagesCount,
  channelLabel,
}: {
  stats: DiscordRulesStats;
  raidStats: DiscordRaidRulesStats;
  raidSignups: DiscordRaidRulesSignupsResponse;
  guildMessagesCount: number;
  raidMessagesCount: number;
  channelLabel: string;
}) {
  const raidSigned = raidStats.configured ? Math.max(raidStats.signed, raidSignups.total, raidSignups.signups.length) : 0;
  const raidUpdatedAt = raidStats.updatedAt || raidSignups.updatedAt;
  const guildStatus = stats.configured
    ? `Оновлено: ${formatUpdatedAt(stats.updatedAt)}.`
    : (stats.error || "Статистика звичайних правил тимчасово недоступна.");
  const raidStatus = raidStats.configured || raidSignups.configured
    ? `Оновлено: ${formatUpdatedAt(raidUpdatedAt)}.`
    : (raidStats.error || raidSignups.error || "Статистика правил рейду тимчасово недоступна.");

  return (
    <section className="discord-rules-data-overview" aria-label="Розділені дані правил">
      <article className="panel discord-rules-data-panel discord-rules-data-panel--guild">
        <div className="discord-rules-data-head">
          <div>
            <span className="eyebrow">Звичайні правила</span>
            <h2>Discord правила</h2>
          </div>
          <span className={`discord-rules-status-pill${stats.configured ? "" : " discord-rules-status-pill--error"}`}>{sourceLabel(stats.source)}</span>
        </div>
        <div className="discord-rules-metric-grid">
          <RulesMetric label="Прийняли" value={metricValue(stats.accepted, stats.configured)} hint="користувачів натиснули “Прийняти”" tone="good" />
          <RulesMetric label="Відмовились" value={metricValue(stats.declined, stats.configured)} hint="користувачів натиснули “Відмовитися”" tone="bad" />
          <RulesMetric label="Всього дій" value={metricValue(stats.total, stats.configured)} hint="прийняття й відмови" />
          <RulesMetric label="Повідомлень" value={guildMessagesCount} hint={`знайдено у ${channelLabel}`} tone="warn" />
        </div>
        <p className="discord-rules-data-note">{guildStatus}</p>
      </article>

      <article className="panel discord-rules-data-panel discord-rules-data-panel--raid">
        <div className="discord-rules-data-head">
          <div>
            <span className="eyebrow">Правила рейду</span>
            <h2>Рейдові правила</h2>
          </div>
          <span className={`discord-rules-status-pill${raidStats.configured || raidSignups.configured ? "" : " discord-rules-status-pill--error"}`}>{sourceLabel(raidStats.source || raidSignups.source)}</span>
        </div>
        <div className="discord-rules-metric-grid">
          <RulesMetric label="Підписались" value={metricValue(raidSigned, raidStats.configured || raidSignups.configured)} hint="унікальних Discord-користувачів" tone="good" />
          <RulesMetric label="У списку" value={metricValue(raidSignups.signups.length, raidSignups.configured)} hint="з Discord і мейн-персонажем" />
          <RulesMetric label="Повідомлень" value={raidMessagesCount} hint={`рейдових повідомлень у ${channelLabel}`} tone="warn" />
        </div>
        <p className="discord-rules-data-note">{raidStatus}</p>
      </article>
    </section>
  );
}

function characterLabel(signup: DiscordRaidRulesSignupsResponse["signups"][number]) {
  const character = signup.mainCharacter || null;
  const name = String(character?.name || "").trim();
  const realm = String(character?.realmName || character?.realmSlug || "").trim();
  if (!name) return "Мейн не знайдено";
  return realm ? `${name} • ${realm}` : name;
}

function signedAtLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "невідомо" : date.toLocaleString("uk-UA");
}

function RaidRulesSignupsPanel({ signups }: { signups: DiscordRaidRulesSignupsResponse }) {
  const updatedLabel = formatUpdatedAt(signups.updatedAt);
  const visibleCount = signups.signups.length;
  const totalLabel = signups.configured ? `${visibleCount}${signups.total > visibleCount ? ` з ${signups.total}` : ""} підписантів` : "Список недоступний";
  const hint = signups.configured
    ? `Останнє оновлення: ${updatedLabel}. Список показує тільки підписантів правил рейду.`
    : (signups.error || "Список підписантів тимчасово недоступний.");

  return (
    <section className="panel discord-raid-signups-panel" aria-label="Підписанти правил рейду">
      <div className="content-section-head content-section-head--toolbar discord-rules-section-head dashboard-list-head">
        <div>
          <span className="eyebrow">Правила рейду</span>
          <h2>Хто підписався на правила рейду</h2>
        </div>
        <div className="content-toolbar-actions">
          <small>{totalLabel}</small>
          <a className="btn subtle" href="/discord/rules">Оновити</a>
        </div>
      </div>

      <p className="discord-raid-signups-hint">{hint}</p>

      {!signups.configured ? (
        <div className="notice error-note">Список підписантів тимчасово недоступний.</div>
      ) : signups.signups.length === 0 ? (
        <div className="content-empty discord-empty-state">
          <strong>Підписантів ще немає.</strong>
          <span>Коли користувач натисне кнопку під рейдовими правилами, бот запише Discord і мейн-персонажа сюди.</span>
        </div>
      ) : (
        <div className="discord-raid-signups-table" role="table" aria-label="Список підписантів рейдових правил">
          <div className="discord-raid-signups-row discord-raid-signups-row--head" role="row">
            <span role="columnheader">Discord</span>
            <span role="columnheader">Мейн-персонаж</span>
            <span role="columnheader">Підпис</span>
          </div>
          {signups.signups.map((signup) => (
            <div className="discord-raid-signups-row" role="row" key={signup.discordId}>
              <span role="cell">
                <small className="discord-raid-mobile-label">Discord</small>
                <strong>{signup.discordName || "Discord користувач"}</strong>
                
              </span>
              <span role="cell">
                <small className="discord-raid-mobile-label">Мейн-персонаж</small>
                {signup.mainCharacter?.profileUrl ? (
                  <a href={signup.mainCharacter.profileUrl} target="_blank" rel="noreferrer">{characterLabel(signup)}</a>
                ) : (
                  <strong>{characterLabel(signup)}</strong>
                )}
                {signup.mainCharacter?.className ? <small>{signup.mainCharacter.className}</small> : null}
              </span>
              <span role="cell">
                <small className="discord-raid-mobile-label">Підпис</small>
                <time dateTime={signup.signedAt || undefined}>{signedAtLabel(signup.signedAt)}</time>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RulesRoleBadges({ roleIds, roles }: { roleIds: string[]; roles: DiscordRoleOption[] }) {
  const uniqueRoleIds = Array.from(new Set(roleIds.filter(Boolean)));

  if (uniqueRoleIds.length === 0) {
    return <span className="discord-rules-role-empty">Ролі не задані</span>;
  }

  return (
    <span className="discord-rules-role-badges" aria-label="Активні ролі, які видають правила">
      {uniqueRoleIds.map((roleId) => (
        <span className="discord-rules-role-chip" key={roleId} title={roleName(roleId, roles)}>
          <span className="discord-role-dot" style={{ backgroundColor: roleColor(roleId, roles) }} />
          {roleName(roleId, roles)}
        </span>
      ))}
    </span>
  );
}

function RulesRow({ message, roles }: { message: DiscordEditableMessage; roles: DiscordRoleOption[] }) {
  const stateLabel = message.editedAt ? "Оновлено" : "Створено";
  const isRaidRules = message.rulesType === "raid";

  return (
    <article className={`discord-rules-row dashboard-list-row${isRaidRules ? " discord-rules-row--raid" : ""}`} role="listitem">
      <div className="discord-rules-row-main">
        <span className="discord-rules-row-icon" aria-hidden="true">{isRaidRules ? "🐉" : "🌸"}</span>
        <span className="discord-rules-row-title">
          <strong>{message.title}</strong>
          <small>{shortDiscordUrl(message.url)}</small>
        </span>
        <span className="discord-rules-row-meta">
          <span className="discord-rules-row-state">
            <time dateTime={message.editedAt || message.createdAt || undefined}>{stateLabel}</time>
            <span className={`discord-rules-type-chip${isRaidRules ? " discord-rules-type-chip--raid" : ""}`}>{isRaidRules ? "Рейд" : "Звичайні"}</span>
          </span>
          <span className="discord-rules-row-roles-label">{isRaidRules ? "Дія кнопки" : "Роль після реєстрації"}</span>
          {isRaidRules ? <span className="discord-rules-role-empty">Підпис на правила рейду</span> : <RulesRoleBadges roleIds={message.roleIds} roles={roles} />}
        </span>
      </div>
      <div className="discord-rules-row-actions dashboard-list-actions">
        <a className="btn subtle" href={message.url} target="_blank" rel="noreferrer">Discord</a>
        <a className="btn primary" href={`/discord/rules/edit?message=${encodeURIComponent(message.url)}`}>Редагувати</a>
      </div>
    </article>
  );
}

function RulesMessagesPanel({ title, eyebrow, description, messages, roles, createHref, emptyText, canEditRules }: { title: string; eyebrow: string; description: string; messages: DiscordEditableMessage[]; roles: DiscordRoleOption[]; createHref: string; emptyText: string; canEditRules: boolean }) {
  return (
    <section className="panel discord-rules-list-panel dashboard-list-panel" aria-label={title}>
      <div className="content-section-head content-section-head--toolbar discord-rules-section-head dashboard-list-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="content-toolbar-actions">
          <small>{messages.length} знайдено</small>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="content-empty discord-empty-state">
          <strong>{emptyText}</strong>
          <span>Якщо повідомлення вже є у Discord, переконайся, що воно опубліковане через цю панель.</span>
          {canEditRules ? <a className="btn primary" href={createHref}>Створити повідомлення</a> : null}
        </div>
      ) : (
        <div className="discord-rules-table dashboard-list" role="list">
          {messages.map((message) => <RulesRow key={message.id} message={message} roles={roles} />)}
        </div>
      )}
    </section>
  );
}

function isLikelyRulesChannel(channel: DiscordTextChannel, suggestedRulesChannelId: string) {
  if (channel.id === suggestedRulesChannelId) return true;
  const name = channel.name.toLowerCase();
  return name.includes("rules") || name.includes("rule") || name.includes("правил") || name.includes("правила") || name.includes("raid") || name.includes("рейд");
}

function uniqueMessages(messages: DiscordEditableMessage[]) {
  const seen = new Set<string>();
  const result: DiscordEditableMessage[] = [];
  for (const message of messages) {
    const key = message.id || message.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }
  return result.sort((a, b) => Date.parse(b.editedAt || b.createdAt || "") - Date.parse(a.editedAt || a.createdAt || ""));
}

export default async function DiscordRulesPage({
  searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }

  if (!canViewRulesStats(user)) redirect(await getOwnProfilePath(user));

  const params = await searchParams;
  const canEditRules = canManageRulesEmbeds(user);
  let configError = "";
  let rulesChannelName = "#rules";
  let messages: DiscordEditableMessage[] = [];
  let guildRulesMessages: DiscordEditableMessage[] = [];
  let raidRulesMessages: DiscordEditableMessage[] = [];
  let roles: DiscordRoleOption[] = [];
  let stats: DiscordRulesStats = { rulesType: "guild", accepted: 0, declined: 0, total: 0, updatedAt: null, configured: false, source: "unconfigured" };
  let raidStats: DiscordRaidRulesStats = { rulesType: "raid", signed: 0, total: 0, updatedAt: null, configured: false, source: "unconfigured" };
  let raidSignups: DiscordRaidRulesSignupsResponse = { rulesType: "raid", configured: false, total: 0, updatedAt: null, source: "unconfigured", signups: [] };

  if (hasDiscordEmbedConfig()) {
    try {
      const [channelData, roleData, statsData, raidStatsData, raidSignupsData] = await Promise.all([
        fetchDiscordTextChannels(),
        canEditRules ? fetchDiscordRoles() : Promise.resolve([] as DiscordRoleOption[]),
        fetchDiscordRulesStats(),
        fetchDiscordRaidRulesStats(),
        fetchDiscordRaidRulesSignups(),
      ]);
      const suggestedRulesChannelId = channelData.suggestedRulesChannelId || channelData.channels[0]?.id || "";
      const rulesChannels = channelData.channels.filter((channel) => isLikelyRulesChannel(channel, suggestedRulesChannelId)).slice(0, 4);
      const fallbackChannel = channelData.channels.find((channel) => channel.id === suggestedRulesChannelId) || channelData.channels[0];
      const channelsToRead = rulesChannels.length ? rulesChannels : fallbackChannel ? [fallbackChannel] : [];

      roles = canEditRules ? roleData : [];
      stats = statsData;
      raidStats = raidStatsData;
      raidSignups = raidSignupsData;
      rulesChannelName = channelsToRead.length > 1
        ? `#${channelsToRead[0].name} +${channelsToRead.length - 1}`
        : channelsToRead[0]?.name ? `#${channelsToRead[0].name}` : "#rules";

      const messageGroups = await Promise.all(
        channelsToRead.map((channel) => listRulesEmbedMessages(channel.id, 100).catch(() => [] as DiscordEditableMessage[]))
      );
      messages = uniqueMessages(messageGroups.flat());
      guildRulesMessages = messages.filter((message) => message.rulesType === "guild");
      raidRulesMessages = messages.filter((message) => message.rulesType === "raid");
    } catch (error) {
      configError = error instanceof Error ? error.message : String(error || "Discord API error");
    }
  }

  const raidSignedCount = raidStats.configured ? Math.max(raidStats.signed, raidSignups.total, raidSignups.signups.length) : 0;

  return (
    <main className="container">
      <section className="dashboard-shell content-shell discord-shell" aria-label="Список Discord правил Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="discord" />
        <header className="hero panel dashboard-hero content-dashboard-hero discord-dashboard-hero discord-dashboard-hero--rules-list">
          <div className="hero-copy dashboard-hero__copy content-dashboard-hero__copy">
            <div className="eyebrow">Mistblossom Vanguard • Правила</div>
            <div className="content-hero-status-row">
              <span className="content-mode-pill content-mode-pill--library">Правила</span>
              <span className="content-hero-path">{rulesChannelName} • {canEditRules ? "керування й статистика" : "перегляд статистики"}</span>
            </div>
            <h1>Правила Discord</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">Правила сервера, правила рейду, статистика прийняття та список підписантів зібрані в одному зрозумілому місці.</p>
            <div className="hero-secure-note content-hero-actions">
              <span className="hero-lock" aria-hidden="true">✦</span>
              <span>Звичайні правила видають ролі. Рейдові правила записують Discord і мейн-персонажа.</span>
              <div className="content-hero-buttons">
                {canEditRules ? <a className="btn primary content-add-btn" href="/discord/rules/new">Додати звичайні</a> : null}
                {canEditRules ? <a className="btn subtle content-add-btn" href="/discord/rules/new?type=raid">Додати рейдові</a> : null}
                <a className="btn subtle content-add-btn" href="/discord">Назад</a>
              </div>
            </div>
          </div>
          <HeroSidePanel
            ariaLabel="Огляд правил Discord"
            summary={[
              { label: "КАНАЛ", value: rulesChannelName, note: canEditRules ? "Керування й статистика" : "Перегляд статистики" },
              { label: "ДОСТУП", value: canEditRules ? "Редагування" : "Перегляд", note: hasDiscordEmbedConfig() ? "Discord API налаштовано" : "Discord API недоступний" },
            ]}
            stats={[
              { label: "ПРИЙНЯЛИ", value: stats.configured ? stats.accepted.toLocaleString("uk-UA") : "—" },
              { label: "РЕЙД", value: raidSignedCount.toLocaleString("uk-UA") },
              { label: "MSG", value: messages.length.toLocaleString("uk-UA") },
            ]}
          />
        </header>
      <StatusNotice params={params} />

      {!hasDiscordEmbedConfig() ? (
        <div className="notice panel error-note">Публікація в Discord тимчасово недоступна. Спробуй пізніше або звернись до гільдмайстра.</div>
      ) : configError ? (
        <div className="notice panel error-note">Не вдалося отримати дані Discord. Спробуй оновити сторінку.</div>
      ) : (
        <>
          <RulesDataOverview
            stats={stats}
            raidStats={raidStats}
            raidSignups={raidSignups}
            guildMessagesCount={guildRulesMessages.length}
            raidMessagesCount={raidRulesMessages.length}
            channelLabel={rulesChannelName}
          />
          <RaidRulesSignupsPanel signups={raidSignups} />

          {canEditRules ? <div className="discord-rules-library-split" aria-label="Бібліотека правил">
            <RulesMessagesPanel
              title="Звичайні правила"
              eyebrow="Звичайні правила"
              description="Тільки повідомлення з кнопками прийняття/відмови. Рейдові підписи сюди не змішуються."
              messages={guildRulesMessages}
              roles={roles}
              createHref="/discord/rules/new"
              emptyText="Звичайні правила з кнопками не знайдено."
              canEditRules={canEditRules}
            />
            <RulesMessagesPanel
              title="Правила рейду"
              eyebrow="Правила рейду"
              description="Тільки повідомлення з кнопкою підпису на правила рейду."
              messages={raidRulesMessages}
              roles={roles}
              createHref="/discord/rules/new?type=raid"
              emptyText="Рейдові правила з кнопкою підпису не знайдено."
              canEditRules={canEditRules}
            />
          </div> : null}
        </>
      )}
      </section>
    </main>
  );
}
