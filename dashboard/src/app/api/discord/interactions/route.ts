import { NextRequest, NextResponse } from "next/server";
import {
  buildRulesDeclineCustomId,
  decodeRulesCustomId,
  getDiscordGuildId,
  kickGuildMember,
  verifyDiscordInteractionSignature,
} from "@/lib/discordAdmin";
import { getMainCharacter, getProfileByDiscordUserId } from "@/lib/profiles";
import { rulesAcceptUrlForDiscordUser } from "@/lib/rulesOnboarding";
import { dashboardProfileUrl, dashboardRaidRulesUrl, decodeRaidAttendanceCustomId, decodeRaidCharacterSelectCustomId, decodeRaidRoleSelectCustomId, decodeRaidSignupSubmitCustomId, handleRaidDiscordAction, raidActionHelpComponents, type RaidCharacterRole } from "@/lib/raids";
import { handleRaidPollDiscordVote } from "@/lib/raidPolls";
import { logDashboardEvent, noStoreHeaders, safeErrorMessage } from "@/lib/security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const runtime = "nodejs";

type InteractionResponse = {
  type: number;
  data?: Record<string, unknown>;
};

function json(payload: InteractionResponse, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: noStoreHeaders(),
  });
}

function ephemeral(content: string, components: unknown[] = []) {
  return json({
    type: 4,
    data: {
      content,
      flags: 64,
      components,
      allowed_mentions: { parse: [] },
    },
  });
}

function updateInteractionMessage(content: string, components: unknown[] = []) {
  return json({
    type: 7,
    data: {
      content,
      components,
      allowed_mentions: { parse: [] },
    },
  });
}

function isEphemeralMessageInteraction(interaction: any) {
  return Boolean(Number(interaction?.message?.flags || 0) & 64);
}

function finishDecision(interaction: any, content: string, components: unknown[] = []) {
  return isEphemeralMessageInteraction(interaction) ? updateInteractionMessage(content, components) : ephemeral(content, components);
}

function rulesConfirmationResponse(action: { action: string; roleIds: string[] }) {
  if (action.action === "confirm_raid_signup") {
    return ephemeral("🐉 Підтверди правила рейду. Система перевірить твій профіль і мейн-персонажа.", [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Підтвердити підпис",
            custom_id: "mbv1:r:s",
          },
        ],
      },
    ]);
  }

  if (action.action === "confirm_decline") {
    return ephemeral("⚠️ Підтверди відмову від правил. Після підтвердження бот видалить тебе із сервера.", [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            label: "Підтвердити відмову",
            custom_id: buildRulesDeclineCustomId(),
          },
        ],
      },
    ]);
  }

  return ephemeral("Ця дія вже застаріла. Натисни кнопку “Прийняти правила” ще раз.");
}

function getInteractionUserId(interaction: any) {
  return String(interaction?.member?.user?.id || interaction?.user?.id || "");
}

function getInteractionUserName(interaction: any) {
  return String(
    interaction?.member?.nick ||
    interaction?.member?.user?.global_name ||
    interaction?.member?.user?.username ||
    interaction?.user?.global_name ||
    interaction?.user?.username ||
    getInteractionUserId(interaction) ||
    "unknown"
  ).slice(0, 80);
}

function getInteractionRulesTokenUser(interaction: any, guildId: string) {
  // Discord URL buttons have a hard 512-character URL limit. The token must stay compact,
  // otherwise Discord rejects the interaction response and shows “Дія не вдалася”.
  // The site can fetch the fresh member snapshot by userId, so only stable identity fields
  // are embedded here; full role lists/avatar URLs are intentionally not included.
  const user = interaction?.member?.user || interaction?.user || {};
  return {
    discordGuildId: guildId,
    discordUsername: typeof user?.username === "string" ? user.username.slice(0, 32) : "",
    discordGlobalName: typeof user?.global_name === "string" ? user.global_name.slice(0, 32) : "",
    discordDisplayName: getInteractionUserName(interaction).slice(0, 32),
    discordAvatarUrl: "",
    memberRoleIds: [],
  };
}

function interactionMemberHasAllRoles(interaction: any, roleIds: string[]) {
  const wanted = Array.from(new Set(roleIds.map((roleId) => String(roleId || "").trim()).filter((roleId) => /^\d{16,25}$/.test(roleId))));
  const roles = Array.isArray(interaction?.member?.roles)
    ? interaction.member.roles.map((roleId: unknown) => String(roleId || ""))
    : [];
  return wanted.length > 0 && wanted.every((roleId) => roles.includes(roleId));
}

function rulesPublicLinkComponents(acceptUrl: string) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 5,
          label: "Відкрити сайт і прийняти правила",
          url: acceptUrl,
        },
      ],
    },
  ];
}


function getInteractionMessageRef(interaction: any) {
  // Ephemeral interaction messages are private follow-ups/select menus, not the public raid embed.
  // Never use them as the target for raid embed synchronization.
  if (isEphemeralMessageInteraction(interaction)) return null;

  const channelId = String(interaction?.channel_id || interaction?.message?.channel_id || "").trim();
  const messageId = String(interaction?.message?.id || "").trim();
  return channelId && messageId ? { channelId, messageId } : null;
}


function cleanRaidSignupRole(value: unknown): RaidCharacterRole | null {
  const role = String(value || "").trim().toLowerCase();
  if (role === "tank") return "tank";
  if (role === "healer") return "healer";
  if (role === "dps") return "dps";
  return null;
}

type RaidPollDiscordKind = "days" | "time" | "schedule" | "schedule_page" | "character" | "character_prompt" | "role" | "submit";

function decodeRaidPollCustomId(customId: string, values: unknown): { pollId: string; kind: RaidPollDiscordKind; group?: string | null; values: string[] } | null {
  const value = String(customId || "").trim();
  const legacyMatch = value.match(/^mbv1:poll_(days|time):([A-Za-z0-9_-]{8,80})$/);
  const smartMatch = value.match(/^mbv1:poll_(schedule_(?:[abc]|mon|tue|wed|thu|fri|sat|sun)|schedule_page_\d{1,2}|character|character_prompt|role|submit):([A-Za-z0-9_-]{8,80})$/);
  const match = legacyMatch || smartMatch;
  if (!match) return null;
  const rawKind = match[1];
  const selected = Array.isArray(values) ? values.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 10) : [];
  if (!selected.length && rawKind !== "character_prompt" && rawKind !== "submit" && !rawKind.startsWith("schedule_page_")) return null;
  const group = rawKind.startsWith("schedule_page_")
    ? rawKind.replace("schedule_page_", "page_")
    : rawKind.startsWith("schedule_")
      ? rawKind.replace("schedule_", "")
      : null;
  return {
    pollId: match[2],
    kind: rawKind.startsWith("schedule_page_") ? "schedule_page" : rawKind.startsWith("schedule_") ? "schedule" : (rawKind as RaidPollDiscordKind),
    group,
    values: selected,
  };
}


function mainCharacterLabel(character: any) {
  const name = String(character?.name || "").trim();
  const realm = String(character?.realmName || character?.realmSlug || "").trim();
  return name ? `${name}${realm ? ` • ${realm}` : ""}` : "мейн-персонаж не знайдений";
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  try {
    const verified = await verifyDiscordInteractionSignature(request, rawBody);
    if (!verified) return new NextResponse("invalid request signature", { status: 401, headers: noStoreHeaders() });
  } catch (error) {
    logDashboardEvent("error", "discord.interaction.signature_failed", request, { message: safeErrorMessage(error) });
    return new NextResponse("invalid request signature", { status: 401, headers: noStoreHeaders() });
  }

  let interaction: any;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    logDashboardEvent("warn", "discord.interaction.bad_json", request);
    return new NextResponse("bad request", { status: 400, headers: noStoreHeaders() });
  }

  if (interaction?.type === 1) {
    logDashboardEvent("debug", "discord.interaction.ping", request);
    return json({ type: 1 });
  }

  if (interaction?.type !== 3) {
    logDashboardEvent("warn", "discord.interaction.unsupported_type", request, { interactionType: interaction?.type });
    return ephemeral("Цей тип Discord interaction не підтримується цією панеллю.");
  }

  const customId = String(interaction?.data?.custom_id || "");
  const raidSubmitAction = decodeRaidSignupSubmitCustomId(customId);
  const raidRoleAction = decodeRaidRoleSelectCustomId(customId, interaction?.data?.values);
  const raidSelectAction = decodeRaidCharacterSelectCustomId(customId, interaction?.data?.values);
  const raidAction = raidSubmitAction || raidRoleAction || raidSelectAction || decodeRaidAttendanceCustomId(customId);
  const pollAction = raidAction ? null : decodeRaidPollCustomId(customId, interaction?.data?.values);
  const parsed = raidAction || pollAction ? null : decodeRulesCustomId(customId);
  if (!raidAction && !pollAction && !parsed) {
    logDashboardEvent("warn", "discord.rules.unknown_custom_id", request, { customId: customId.slice(0, 24) });
    return ephemeral("Ця кнопка не належить панелі Mistblossom або вже застаріла.");
  }

  const guildId = String(interaction?.guild_id || getDiscordGuildId() || "");
  const userId = getInteractionUserId(interaction);
  const userName = getInteractionUserName(interaction);

  if (pollAction) {
    try {
      const messageRef = getInteractionMessageRef(interaction);
      const result = await handleRaidPollDiscordVote({
        pollId: pollAction.pollId,
        kind: pollAction.kind,
        group: pollAction.group,
        values: pollAction.values,
        userId,
        userName,
        guildId,
        guildName: String(interaction?.guild?.name || "Discord server"),
        messageRef,
      });
      logDashboardEvent(result.ok ? "info" : "warn", "discord.raid_poll.action", request, { pollId: pollAction.pollId, kind: pollAction.kind, userId, ok: result.ok });
      return finishDecision(interaction, result.content, result.components || []);
    } catch (error) {
      logDashboardEvent("error", "discord.raid_poll.action_failed", request, { message: safeErrorMessage(error), pollId: pollAction.pollId, kind: pollAction.kind, userId });
      return ephemeral("❌ Не вдалося зберегти голос. Спробуй пізніше або звернись до офіцера.");
    }
  }

  if (raidAction) {
    try {
      const result = await handleRaidDiscordAction({
        raidId: raidAction.raidId,
        action: raidAction.action,
        userId,
        userName,
        characterKey: "characterKey" in raidAction ? String(raidAction.characterKey || "") : null,
        signupRole: "signupRole" in raidAction ? cleanRaidSignupRole(raidAction.signupRole) : null,
        commit: Boolean((raidAction as { commit?: boolean }).commit),
        messageRef: getInteractionMessageRef(interaction),
      });
      logDashboardEvent(result.ok ? "info" : "warn", "discord.raid.action", request, { raidId: raidAction.raidId, action: raidAction.action, userId, ok: result.ok });

      // Запис на рейд має оновлювати тільки саме рейдове повідомлення через handleRaidDiscordAction().
      // Персональну відповідь із вибором персонажа редагуємо на місці, щоб не плодити приватні повідомлення.
      return finishDecision(interaction, result.content, "components" in result ? result.components || [] : []);
    } catch (error) {
      logDashboardEvent("error", "discord.raid.action_failed", request, { message: safeErrorMessage(error), raidId: raidAction.raidId, action: raidAction.action, userId });
      return ephemeral("❌ Не вдалося оновити запис на рейд. Спробуй ще раз пізніше або звернись до офіцера.");
    }
  }

  if (!parsed) {
    return ephemeral("Ця кнопка вже застаріла.");
  }

  const effectiveParsed = parsed.action === "confirm_accept"
    ? { ...parsed, action: "accept" as const }
    : parsed;

  if (effectiveParsed.action === "confirm_decline" || effectiveParsed.action === "confirm_raid_signup") {
    logDashboardEvent("info", "discord.rules.confirmation_requested", request, {
      action: effectiveParsed.action,
      guildId,
      userId,
      roles: effectiveParsed.roleIds.length,
    });
    return rulesConfirmationResponse(effectiveParsed);
  }

  if (effectiveParsed.action === "raid_signup") {
    try {
      const profile = await getProfileByDiscordUserId(userId);
      const mainCharacter = profile ? getMainCharacter(profile) : null;
      if (!profile || !mainCharacter) {
        logDashboardEvent("warn", "discord.raid_rules.profile_missing", request, { guildId, userId });
        return finishDecision(interaction, `❌ Підпис не зараховано: спочатку увійди через Discord у панелі, додай персонажа Battle.net і вибери мейна.
Профіль: ${dashboardProfileUrl()}
Правила рейду: ${dashboardRaidRulesUrl()}`, raidActionHelpComponents());
      }

      logDashboardEvent("info", "discord.raid_rules.signed", request, { guildId, userId, profileId: profile.profileId, character: mainCharacter.name });
      return finishDecision(interaction, `✅ Підпис на правила рейду підтверджено. Мейн: ${mainCharacterLabel(mainCharacter)}.`);
    } catch (error) {
      logDashboardEvent("error", "discord.raid_rules.failed", request, { message: safeErrorMessage(error), guildId, userId });
      return finishDecision(interaction, `❌ Не вдалося підтвердити підпис. Спробуй ще раз пізніше або перевір, що в профілі вибрано мейн-персонажа.
Профіль: ${dashboardProfileUrl()}
Правила рейду: ${dashboardRaidRulesUrl()}`, raidActionHelpComponents());
    }
  }

  try {
    if (effectiveParsed.action === "accept") {
      if (!/^\d{16,25}$/.test(userId)) {
        logDashboardEvent("warn", "discord.rules.user_missing", request, { guildId, roles: effectiveParsed.roleIds.length });
        return finishDecision(interaction, "❌ Discord не передав підтверджений userId для цієї кнопки. Натисни актуальну кнопку правил ще раз або звернись до офіцера.");
      }

      const acceptUrl = rulesAcceptUrlForDiscordUser(
        effectiveParsed.roleIds,
        userId,
        getInteractionRulesTokenUser(interaction, guildId),
      );
      const alreadyAccepted = interactionMemberHasAllRoles(interaction, effectiveParsed.roleIds);

      logDashboardEvent("info", "discord.rules.accept_site_link_created", request, {
        guildId,
        userId,
        roles: effectiveParsed.roleIds.length,
        alreadyAccepted,
      });

      return finishDecision(
        interaction,
        alreadyAccepted
          ? "✅ Discord підтвердив твою особу. Потрібна роль уже є, але сторінку правил можна відкрити для перевірки кнопки й профілю без повторної авторизації."
          : "✅ Discord підтвердив твою особу. Натисни кнопку нижче — сайт відкриється з персональним підписаним посиланням і зможе видати роль без Discord OAuth. У публічному повідомленні ці дані не показуються.",
        rulesPublicLinkComponents(acceptUrl),
      );
    }

    await kickGuildMember({
      guildId,
      userId,
      reason: `Rules declined by ${userName}`,
    });

    logDashboardEvent("info", "discord.rules.declined", request, { guildId, userId });
    return finishDecision(interaction, "🚪 Відмову від правил прийнято, тому бот видалив тебе із сервера.");
  } catch (error) {
    logDashboardEvent("error", "discord.rules.action_failed", request, { message: safeErrorMessage(error), guildId, userId, action: effectiveParsed.action });
    return finishDecision(interaction, "❌ Не вдалося виконати дію. Спробуй ще раз пізніше або звернись до гільдмайстра.");
  }
}
