import { redirect } from "next/navigation";

import DashboardIdentity from "@/components/DashboardIdentity";
import DiscordEmbedEditor, { type DiscordAutoroleButtonOption } from "@/components/DiscordEmbedEditor";
import { getSession } from "@/lib/auth";
import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { canManageDiscordMembers } from "@/lib/permissions";
import { getOwnProfilePath } from "@/lib/profiles";
import { prettyDiscordJson } from "@/lib/discordEmbedDefaults";
import {
  fetchDiscordEditableMessage,
  fetchDiscordRoleControlSnapshotCachedForUi,
  fetchDiscordTextChannels,
  hasDiscordEmbedConfig,
  parseDiscordMessageRef,
} from "@/lib/discordAdmin";
import { extractAutoroleButtonsFromMessage } from "@/lib/discordAutoroles";
import { buildPageMetadata } from "@/lib/seo";
import { safeDiscordMessageUrl } from "@/lib/discordGuildLinks";

export const metadata = buildPageMetadata({
  title: "Discord авторолі",
  description: "Створення Discord embed-повідомлень із керованими кнопками видачі та зняття ролей Mistblossom Vanguard.",
  path: "/discord/autoroles",
  keywords: ["Discord autoroles", "Discord ролі", "role buttons"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;

const defaultAutoroleEmbed = {
  title: "🌿 Обери свої ролі",
  description: "Натисни потрібні кнопки нижче. Ролі застосовуються одразу через Mistblossom Guild System.",
  color: 4289797,
  footer: { text: "Mistblossom Vanguard • Авторолі" },
};

function StatusNotice({ params }: { params: Record<string, string | undefined> }) {
  const published = safeDiscordMessageUrl(params.published);
  const updated = safeDiscordMessageUrl(params.updated);
  if (published) return <div className="notice panel success discord-notice">Авторолі опубліковано: <a href={published} target="_blank" rel="noreferrer">відкрити повідомлення</a></div>;
  if (updated) return <div className="notice panel success discord-notice">Авторолі оновлено: <a href={updated} target="_blank" rel="noreferrer">відкрити повідомлення</a></div>;
  if (params.error) return <div className="notice panel error-note discord-notice">{params.error}</div>;
  return null;
}

export default async function DiscordAutorolesPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canManageDiscordMembers(user)) redirect(await getOwnProfilePath(user));

  const params = await searchParams;
  const authorIdentity = await resolveAuthorIdentity(user);
  const messageParam = String(params.message || params.url || "").trim();
  const editMode = Boolean(messageParam);
  let configError = "";
  let channels: Array<{ id: string; name: string; type: number }> = [];
  let roles: Array<{ id: string; name: string; color: number; position: number; managed?: boolean; manageable?: boolean; blockedReason?: string | null }> = [];
  let suggestedChannelId = "";
  let embedJson = prettyDiscordJson({ ...defaultAutoroleEmbed, author: { name: authorIdentity.primaryName } });
  let content = "";
  let messageLink = messageParam;
  let autoroleButtons: DiscordAutoroleButtonOption[] = [];
  let selectedMentionRoleIds: string[] = [];

  if (hasDiscordEmbedConfig()) {
    try {
      const [channelData, roleControl] = await Promise.all([
        fetchDiscordTextChannels(),
        fetchDiscordRoleControlSnapshotCachedForUi(),
      ]);
      channels = channelData.channels;
      roles = roleControl.roles.map((role) => ({ id: role.id, name: role.name, color: role.color, position: role.position, managed: role.managed, manageable: role.manageable, blockedReason: role.blockedReason }));
      suggestedChannelId = channels[0]?.id || channelData.suggestedRulesChannelId || "";

      const ref = parseDiscordMessageRef(messageParam);
      if (ref) {
        const message = await fetchDiscordEditableMessage(ref);
        embedJson = message.embedJson || embedJson;
        content = message.content;
        messageLink = message.url || messageParam;
        suggestedChannelId = message.channelId || suggestedChannelId;
        autoroleButtons = extractAutoroleButtonsFromMessage({ components: message.components });
        selectedMentionRoleIds = message.roleIds || [];
        for (const button of autoroleButtons) {
          if (!roles.some((role) => role.id === button.roleId)) {
            roles.push({ id: button.roleId, name: `Видалена роль ${button.roleId.slice(-6)}`, color: 0, position: 0, managed: true, manageable: false, blockedReason: "Роль більше не існує або недоступна боту." });
          }
        }
      } else if (messageParam) {
        configError = "Посилання на Discord-повідомлення невалідне.";
      }
    } catch (error) {
      configError = error instanceof Error ? error.message : String(error || "Discord API error");
    }
  }

  return (
    <main className="container app-page">
      <section className="dashboard-shell content-shell discord-shell app-page-stack" aria-label="Discord авторолі Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="discord" />
        <header className="discord-editor-header panel">
          <div>
            <span className="eyebrow">Discord • Авторолі • {editMode ? "Редагування" : "Створення"}</span>
            <h1>{editMode ? "Редагування авторолей" : "Авторолі Discord"}</h1>
            <p>Той самий спільний Embed-редактор, але з Discord-кнопками ролей. Кожна кнопка має власний текст, emoji, стиль, роль, поведінку та optional exclusive-group.</p>
          </div>
          <a className="btn subtle" href="/discord">Назад</a>
        </header>

        <StatusNotice params={params} />
        {!hasDiscordEmbedConfig() ? (
          <div className="notice panel error-note">Discord API тимчасово недоступний.</div>
        ) : configError && !messageParam ? (
          <div className="notice panel error-note">Не вдалося завантажити Discord-конфігурацію.</div>
        ) : channels.length === 0 ? (
          <div className="notice panel error-note">Не знайдено текстових Discord-каналів.</div>
        ) : !roles.some((role) => role.manageable !== false) ? (
          <div className="notice panel error-note">Немає ролей, якими бот може керувати. Перевір Manage Roles та ієрархію ролей бота.</div>
        ) : (
          <>
            {configError ? <div className="notice panel error-note">{configError}</div> : null}
            <DiscordEmbedEditor
              mode="autoroles"
              editorMode={editMode ? "edit" : "create"}
              channels={channels}
              roles={roles}
              suggestedChannelId={suggestedChannelId}
              defaultEmbedJson={embedJson}
              defaultContent={content}
              defaultMessageLink={messageLink}
              defaultAutoroleButtons={autoroleButtons}
              selectedRoleIds={selectedMentionRoleIds}
              authorSuggestions={authorIdentity.suggestions}
              defaultAuthorName={authorIdentity.primaryName}
              returnTo="/discord/autoroles"
            />
          </>
        )}
      </section>
    </main>
  );
}
