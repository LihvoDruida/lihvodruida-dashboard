import { NextRequest } from "next/server";

import { adminDiscordResponse, auditDiscordAdmin, discordAdminError, requireDiscordAdmin } from "@/lib/dashboardDiscordRoute";
import { fetchDiscordRoleControlSnapshotCachedForUi, fetchDiscordTextChannels } from "@/lib/discordAdmin";
import { ensureAuthAccessRequiredRole } from "@/lib/authAccessPolicy";
import { setDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanSnowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

export async function POST(request: NextRequest) {
  const guard = await requireDiscordAdmin(request, "welcome-card-settings", 12 * 1024);
  if ("error" in guard) return guard.error;
  if (!guard.session.isServerOwner) {
    return adminDiscordResponse(request, {
      ok: false,
      tone: "error",
      title: "Немає доступу",
      message: "Налаштування welcome-карток доступні лише власнику Discord-сервера.",
      status: 403,
    });
  }

  try {
    const form = await request.formData();
    const enabled = form.get("enabled") !== null;
    const channelId = cleanSnowflake(form.get("channelId"));
    const defaultRoleId = cleanSnowflake(form.get("defaultRoleId"));

    const [channels, roleControl] = await Promise.all([
      enabled || channelId ? fetchDiscordTextChannels() : Promise.resolve(null),
      defaultRoleId ? fetchDiscordRoleControlSnapshotCachedForUi(60_000) : Promise.resolve(null),
    ]);

    if (enabled && !channelId) throw new Error("Для увімкненої welcome-картки вибери Discord-канал.");
    if (channelId && !channels?.channels.some((channel) => channel.id === channelId)) {
      throw new Error("Вибраний welcome-канал не знайдений серед доступних текстових каналів цього Discord-сервера.");
    }
    if (defaultRoleId && !roleControl?.manageableRoles.some((role) => role.id === defaultRoleId)) {
      throw new Error("Вибрана стартова роль недоступна для бота. Перевір ієрархію Discord-ролей і право Manage Roles.");
    }

    const saved = await setDiscordWelcomeCardSettings({
      enabled,
      channelId,
      messageTemplate: form.get("messageTemplate"),
      greetings: form.get("greetings"),
      labelPrefix: form.get("labelPrefix"),
      fileName: form.get("fileName"),
      defaultRoleId,
    }, guard.session);

    const authPolicy = saved.defaultRoleId
      ? await ensureAuthAccessRequiredRole(saved.defaultRoleId, guard.session)
      : null;

    await auditDiscordAdmin("discord.welcome_card_settings.update", guard.session, {
      status: "success",
      enabled: saved.enabled,
      channelId: saved.channelId,
      greetings: saved.greetings.length,
      labelPrefix: saved.labelPrefix,
      fileName: saved.fileName,
      defaultRoleId: saved.defaultRoleId || null,
      authRoleSynced: Boolean(saved.defaultRoleId && authPolicy?.requiredRoleIds.includes(saved.defaultRoleId)),
      summary: `Welcome-картка ${saved.enabled ? `увімкнена для каналу ${saved.channelId}` : "вимкнена"}; стартова роль: ${saved.defaultRoleId || "не задано"}.`,
    });

    return adminDiscordResponse(request, {
      ok: true,
      tone: saved.enabled ? "success" : "warning",
      title: "Welcome-систему збережено",
      message: saved.enabled
        ? `Нові учасники отримуватимуть серверно згенеровану картку в каналі ${saved.channelId}${saved.defaultRoleId ? ` і стартову роль ${saved.defaultRoleId}. Цю роль також додано до дозволених ролей входу` : ""}.`
        : "Публічні welcome-картки вимкнені.",
      data: { refresh: true },
    });
  } catch (error) {
    return discordAdminError(
      request,
      "admin.discord.welcome_card_settings_failed",
      error,
      "Налаштування welcome-системи не збережено.",
      guard.session,
    );
  }
}
