import "server-only";

import type { DiscordGuildMemberModerationItem } from "@/lib/discordAdmin";
import { renderDiscordWelcomeCard, type DiscordWelcomeCardRenderResult } from "@/lib/discordWelcomeCard";
import { renderDiscordWelcomeMessageTemplate, type DiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";

export type DiscordWelcomeArtifactOptions = {
  greetingOverride?: string | null;
  numberOverride?: string | null;
  messageTemplateOverride?: string | null;
  mentionOverride?: string | null;
};

export type DiscordWelcomeArtifact = DiscordWelcomeCardRenderResult & {
  content: string;
  username: string;
  displayName: string;
  mention: string;
};

function cleanText(value: unknown, max: number) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, Math.max(0, max))
    .join("");
}

export function buildDiscordWelcomeContent(input: {
  member: DiscordGuildMemberModerationItem;
  settings: DiscordWelcomeCardSettings;
  greeting: string;
  label: string;
  messageTemplateOverride?: string | null;
  mentionOverride?: string | null;
}) {
  const username = cleanText(input.member.username || input.member.displayName, 32) || "mistblossom.recruit";
  const displayName = cleanText(input.member.displayName || input.member.globalName || username, 40) || "Новий мандрівник";
  const mention = String(input.mentionOverride || "").trim() || `<@${input.member.userId}>`;
  const content = renderDiscordWelcomeMessageTemplate(
    input.messageTemplateOverride || input.settings.messageTemplate,
    {
      mention,
      username,
      displayName,
      greeting: input.greeting,
      label: input.label,
    },
  );
  return { content, username, displayName, mention };
}

export async function createDiscordWelcomeArtifact(
  member: DiscordGuildMemberModerationItem,
  settings: DiscordWelcomeCardSettings,
  options: DiscordWelcomeArtifactOptions = {},
): Promise<DiscordWelcomeArtifact> {
  const rendered = await renderDiscordWelcomeCard(member, settings, {
    greetingOverride: options.greetingOverride,
    numberOverride: options.numberOverride,
  });
  const text = buildDiscordWelcomeContent({
    member,
    settings,
    greeting: rendered.greeting,
    label: rendered.label,
    messageTemplateOverride: options.messageTemplateOverride,
    mentionOverride: options.mentionOverride,
  });
  return { ...rendered, ...text };
}
