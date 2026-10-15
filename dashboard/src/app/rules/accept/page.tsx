import LoginBackground from "@/components/LoginBackground";
import GuildRulesAcceptForm from "@/components/GuildRulesAcceptForm";
import { StaticMarkdown } from "@/components/static/StaticMarkdown";
import { fetchDiscordGuildMemberSnapshot, getDiscordGuildId } from "@/lib/discordAdmin";
import { getGuildRulesDocument } from "@/lib/guildRulesDocument";
import { parseRulesRoleTokenDetails } from "@/lib/rulesOnboarding";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = {
  ...buildPageMetadata({ title: "Прийняття правил", description: "Правила гільдії та їх прийняття через персональне посилання Discord.", path: "/rules/accept" }),
  robots: { index: false, follow: false },
  referrer: "strict-origin" as const,
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NOTICES: Record<string, string> = {
  agreement_required: "Познач згоду з правилами перед підтвердженням.",
  rules_changed: "Правила оновлено. Прочитай актуальну версію та підтвердь згоду ще раз.",
  rules_unavailable: "Не вдалося завантажити правила. Спробуй оновити сторінку пізніше.",
  missing_role_token: "Посилання застаріло або недійсне. Відкрий нове через кнопку правил у Discord.",
  discord_user_missing: "Для прийняття відкрий персональне посилання через кнопку правил у Discord.",
  discord_member_missing: "Твій акаунт не знайдено на сервері гільдії. Перевір членство й відкрий посилання знову.",
  discord_guild_mismatch: "Це посилання створене для іншого сервера. Відкрий актуальну кнопку правил у Discord.",
  discord_role_not_allowed: "Налаштування ролі змінилися. Відкрий нове посилання через кнопку правил у Discord.",
  discord_role_missing: "Роль більше не доступна. Звернися до адміністрації гільдії.",
  discord_not_configured: "Видача ролі тимчасово недоступна. Звернися до адміністрації гільдії.",
  geo_blocked: "Дія недоступна для цього регіону.",
  rate_limit: "Забагато спроб. Зачекай кілька хвилин і повтори дію.",
  request_too_large: "Не вдалося обробити форму. Онови сторінку та спробуй ще раз.",
  failed: "Не вдалося видати роль. Спробуй ще раз або звернися до адміністрації гільдії.",
};

export default async function RulesAcceptPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const token = String(params.rt || "").trim();
  const parsed = parseRulesRoleTokenDetails(token);
  const guildId = getDiscordGuildId();
  const validGuild = Boolean(guildId && (!parsed.discordGuildId || parsed.discordGuildId === guildId));
  const [document, member] = await Promise.all([
    parsed.roleIds.length && validGuild ? getGuildRulesDocument(parsed.roleIds).catch(() => null) : null,
    parsed.discordUserId && validGuild ? fetchDiscordGuildMemberSnapshot(parsed.discordUserId, guildId).catch(() => null) : null,
  ]);
  const acceptanceCompleted = params.status === "completed_public" && Boolean(member && parsed.roleIds.length && parsed.roleIds.every(id => member.roleIds.includes(id)));
  const notice = params.status && NOTICES[params.status];
  const canAccept = Boolean(document && parsed.discordUserId && validGuild);
  return <main className="guild-agreement-screen">
    <LoginBackground />
    <article className="guild-agreement-card" aria-labelledby="guild-agreement-title">
      <header className="guild-agreement-heading">
        <span className="guild-agreement-kicker">Mistblossom Vanguard</span>
        <h1 id="guild-agreement-title">{document?.title || "Правила гільдії"}</h1>
        <p>Спільні правила — основа нашої гри разом.</p>
        {member ? <span className="guild-agreement-account">Discord · {member.displayName}</span> : null}
      </header>
      {notice && !acceptanceCompleted ? <p className="guild-agreement-notice" role="alert">{notice}</p> : null}
      {document ? <div className="guild-agreement-text"><StaticMarkdown value={document.markdown} /></div> : <p className="guild-agreement-notice" role="status">{parsed.roleIds.length ? "Правила зараз недоступні. Онови сторінку пізніше або звернися до адміністрації гільдії." : NOTICES.missing_role_token}</p>}
      {acceptanceCompleted ? <div className="guild-agreement-success" role="status"><span aria-hidden="true">✓</span><h2>Правила прийнято</h2><p>Discord-роль видано. До зустрічі у грі!</p><a className="guild-agreement-login" href="/login">Авторизація</a></div> : canAccept && document ? <GuildRulesAcceptForm token={token} revision={document.revision} /> : <div className="guild-agreement-unavailable"><p>{!parsed.discordUserId && parsed.roleIds.length ? NOTICES.discord_user_missing : "Прийняття стане доступним за актуальним персональним посиланням із Discord."}</p><a className="guild-agreement-login" href="/login">Авторизація</a></div>}
    </article>
  </main>;
}
