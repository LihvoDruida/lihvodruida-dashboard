import { redirect } from "next/navigation";
import DashboardIdentity from "@/components/DashboardIdentity";
import DiscordEmbedEditor from "@/components/DiscordEmbedEditor";
import { getSession } from "@/lib/auth";
import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { defaultRaidRulesEmbed, defaultRulesEmbed, prettyDiscordJson } from "@/lib/discordEmbedDefaults";
import {
  fetchDiscordEditableMessage,
  fetchDiscordRoles,
  fetchDiscordTextChannels,
  hasDiscordEmbedConfig,
  parseDiscordMessageRef,
} from "@/lib/discordAdmin";
import { buildPageMetadata } from "@/lib/seo";
import { getOwnProfilePath } from "@/lib/profiles";
import { canManageRulesEmbeds } from "@/lib/permissions";

export const metadata = buildPageMetadata({
  title: "Редагування правил Discord",
  description: "Оновлення чинних правил Mistblossom Vanguard, ролей і повідомлень без зайвого ручного редагування.",
  path: "/discord/rules/edit",
  keywords: ["редагування правил", "Discord правила"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EditDiscordRulesPage({
  searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }

  if (!canManageRulesEmbeds(user)) redirect(await getOwnProfilePath(user));

  const params = await searchParams;
  const authorIdentity = await resolveAuthorIdentity(user);
  const canEditRules = canManageRulesEmbeds(user);
  const messageParam = String(params.message || params.url || "").trim();
  let configError = "";
  let channels: Array<{ id: string; name: string; type: number }> = [];
  let roles: Array<{ id: string; name: string; color: number; position: number; managed: boolean }> = [];
  let suggestedRulesChannelId = "";
  let ruleType: "guild" | "raid" = String(params.type || params.ruleType || "guild") === "raid" ? "raid" : "guild";
  let embedJson = prettyDiscordJson({ ...(ruleType === "raid" ? defaultRaidRulesEmbed : defaultRulesEmbed), author: { name: authorIdentity.primaryName } });
  let content = "";
  let messageLink = messageParam;
  let selectedRoleIds: string[] = [];

  if (canEditRules && hasDiscordEmbedConfig()) {
    try {
      const [channelData, roleData] = await Promise.all([fetchDiscordTextChannels(), fetchDiscordRoles()]);
      channels = channelData.channels;
      roles = roleData;
      suggestedRulesChannelId = channelData.suggestedRulesChannelId || channels[0]?.id || "";

      const ref = parseDiscordMessageRef(messageParam);
      if (ref) {
        const message = await fetchDiscordEditableMessage(ref);
        embedJson = message.embedJson || embedJson;
        content = message.content;
        messageLink = message.url || messageParam;
        suggestedRulesChannelId = message.channelId || suggestedRulesChannelId;
        ruleType = message.rulesType === "raid" ? "raid" : "guild";
        selectedRoleIds = message.rulesType === "raid" ? [] : message.roleIds;
        if (!message.isRules) {
          configError = "Це повідомлення не схоже на правила, створені через цю панель.";
        }
      } else if (messageParam) {
        configError = "Посилання на Discord-повідомлення невалідне.";
      }
    } catch (error) {
      configError = error instanceof Error ? error.message : String(error || "Discord API error");
    }
  }

  return (
    <main className="container">
      <section className="dashboard-shell content-shell discord-shell" aria-label="Редагування Discord правил Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="discord" />
        <header className="discord-editor-header panel">
          <div>
            <span className="eyebrow">Правила • Редагування</span>
            <h1>{ruleType === "raid" ? "Редагування правил рейду" : "Редагування правил"}</h1>
            <p>{ruleType === "raid" ? "Онови рейдові правила з кнопкою підпису та списком підписантів." : "Онови повідомлення правил зі списку або через посилання на повідомлення. Канал, повідомлення і ролі розділені окремо."}</p>
          </div>
          <a className="btn subtle" href="/discord/rules">До списку</a>
        </header>
      {params.error ? <div className="notice panel error-note discord-notice">{params.error}</div> : null}

      {!canEditRules ? (
        <div className="notice panel">Ця сторінка доступна тільки гільдмайстеру.</div>
      ) : !hasDiscordEmbedConfig() ? (
        <div className="notice panel error-note">Публікація в Discord тимчасово недоступна. Спробуй пізніше або звернись до гільдмайстра.</div>
      ) : configError && !messageParam ? (
        <div className="notice panel error-note">Не вдалося отримати дані Discord. Спробуй оновити сторінку.</div>
      ) : channels.length === 0 || (ruleType === "guild" && roles.length === 0) ? (
        <div className="notice panel error-note">Не знайдено текстових каналів або ролей для вибору.</div>
      ) : (
        <>
          {configError ? <div className="notice panel error-note">Не вдалося отримати дані Discord. Спробуй оновити сторінку.</div> : null}
          <DiscordEmbedEditor
            mode="rules"
            ruleType={ruleType}
            editorMode="edit"
            channels={channels}
            roles={roles}
            suggestedChannelId={suggestedRulesChannelId}
            defaultEmbedJson={embedJson}
            defaultContent={content}
            defaultMessageLink={messageLink}
            selectedRoleIds={selectedRoleIds}
            authorSuggestions={authorIdentity.suggestions}
            defaultAuthorName={authorIdentity.primaryName}
            returnTo="/discord/rules"
          />
        </>
      )}
      </section>
    </main>
  );
}
