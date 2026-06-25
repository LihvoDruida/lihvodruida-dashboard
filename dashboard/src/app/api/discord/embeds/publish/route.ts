import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { canManageGeneralEmbeds, canManageRulesEmbeds, hierarchyTitle } from "@/lib/permissions";
import {
  assertRequestBodySize,
  checkRateLimit,
  forbiddenResponse,
  getClientIp,
  logDashboardEvent,
  noStoreHeaders,
  safeErrorMessage,
  verifyTrustedOrigin,
} from "@/lib/security";
import {
  createDiscordEmbedMessage,
  discordMessageUrl,
  editDiscordEmbedMessage,
  fetchDiscordEditableMessage,
  parseDiscordMessageRef,
  parseEmbedJson,
} from "@/lib/discordAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeReturnTo(value: FormDataEntryValue | string | null | undefined) {
  const path = String(value || "").trim();
  if (!path || path.startsWith("//") || path.includes("://")) return "/discord";
  return path.startsWith("/discord") ? path.slice(0, 240) : "/discord";
}

function wantsJsonResponse(request: NextRequest) {
  const action = String(request.headers.get("x-dashboard-action") || "").toLowerCase();
  const accept = String(request.headers.get("accept") || "").toLowerCase();
  return action === "live" || accept.includes("application/json");
}

function toastForParams(params: Record<string, string>) {
  if (params.error) {
    return { tone: "error" as const, title: "Discord повідомлення не збережено", message: params.error, ttl: 8600 };
  }
  if (params.updated) {
    return { tone: "success" as const, title: "Discord повідомлення оновлено", message: "Зміни передано в Discord. Перевір повідомлення у каналі.", ttl: 6800 };
  }
  if (params.published) {
    return { tone: "success" as const, title: "Discord повідомлення опубліковано", message: "Нове повідомлення створено в Discord. Перевір канал.", ttl: 6800 };
  }
  return { tone: "success" as const, title: "Готово", message: "Дію виконано.", ttl: 5200 };
}

function respondTo(request: NextRequest, params: Record<string, string>, returnTo = "/discord", status = 200) {
  if (wantsJsonResponse(request)) {
    const toast = toastForParams(params);
    return NextResponse.json({
      ok: !params.error,
      ...params,
      toast,
    }, { status: params.error ? status >= 400 ? status : 400 : status, headers: noStoreHeaders() });
  }
  return redirectTo(request, params, returnTo);
}

function formText(form: FormData, key: string, max = 4096) {
  return String(form.get(key) || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, max);
}

function urlObject(value: string) {
  const url = value.trim();
  return url ? { url } : undefined;
}

function parseFieldsJson(value: FormDataEntryValue | null) {
  if (!value) return [] as Array<{ name: string; value: string; inline?: boolean }>;
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 25).map((field) => ({
      name: String(field?.name || ""),
      value: String(field?.value || ""),
      inline: Boolean(field?.inline),
    })).filter((field) => field.name.trim() && field.value.trim());
  } catch {
    return [];
  }
}

function embedFromEditableForm(form: FormData) {
  const hasEditableKeys = ["title", "titleUrl", "description", "colorHex", "authorName", "authorUrl", "authorIconUrl", "thumbnailUrl", "imageUrl", "footerText", "footerIconUrl", "fieldsJson"].some((key) => form.has(key));
  if (!hasEditableKeys) return parseEmbedJson(form.get("embedJson"));

  const colorHex = (formText(form, "colorHex", 16).trim() || formText(form, "colorPickerHex", 16).trim());
  const color = /^#?[0-9a-fA-F]{6}$/.test(colorHex) ? Number.parseInt(colorHex.replace(/^#/, ""), 16) : undefined;
  const authorName = formText(form, "authorName", 256).trim();
  const footerText = formText(form, "footerText", 2048).trim();
  const fields = parseFieldsJson(form.get("fieldsJson"));
  const embed: Record<string, unknown> = {
    title: formText(form, "title", 256).trim() || undefined,
    url: formText(form, "titleUrl", 2048).trim() || undefined,
    description: formText(form, "description", 4096).trim() || undefined,
    color,
    thumbnail: urlObject(formText(form, "thumbnailUrl", 2048)),
    image: urlObject(formText(form, "imageUrl", 2048)),
    author: authorName ? {
      name: authorName,
      url: formText(form, "authorUrl", 2048).trim() || undefined,
      icon_url: formText(form, "authorIconUrl", 2048).trim() || undefined,
    } : undefined,
    footer: footerText ? {
      text: footerText,
      icon_url: formText(form, "footerIconUrl", 2048).trim() || undefined,
    } : undefined,
    fields: fields.length ? fields : undefined,
    timestamp: form.has("timestampEnabled") ? true : undefined,
  };
  return parseEmbedJson(JSON.stringify(Object.fromEntries(Object.entries(embed).filter(([, value]) => value !== undefined && value !== null))));
}

function redirectTo(request: NextRequest, params: Record<string, string>, returnTo = "/discord") {
  const url = new URL(returnTo, request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url, 303);
  for (const [key, value] of Object.entries(noStoreHeaders())) response.headers.set(key, value);
  return response;
}

function selectedRoleIds(form: FormData) {
  return Array.from(new Set(
    form
      .getAll("roleIds")
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function sameOriginRefererMessageLink(request: NextRequest) {
  const referer = request.headers.get("referer") || "";
  if (!referer) return "";

  try {
    const refererUrl = new URL(referer);
    const requestUrl = new URL(request.url);
    if (refererUrl.origin !== requestUrl.origin) return "";
    return String(refererUrl.searchParams.get("message") || refererUrl.searchParams.get("url") || "").trim();
  } catch {
    return "";
  }
}

function messageLinkFromForm(form: FormData, request: NextRequest, action: string) {
  const explicit = String(form.get("messageLink") || "").trim();
  if (explicit) return explicit;

  const channelId = String(form.get("editChannelId") || "").trim();
  const messageId = String(form.get("editMessageId") || "").trim();
  if (channelId && messageId) return `${channelId}/${messageId}`;

  return action === "edit" ? sameOriginRefererMessageLink(request) : "";
}

export async function POST(request: NextRequest) {
  if (!verifyTrustedOrigin(request)) return forbiddenResponse("Недовірене джерело запиту.");

  const tooLarge = assertRequestBodySize(request, 64 * 1024);
  if (tooLarge) return tooLarge;

  const session = await getSession();
  if (!session || !canManageGeneralEmbeds(session)) {
    return respondTo(request, { error: "Ця дія доступна тільки гільдмайстеру або офіцеру." }, "/discord", 403);
  }

  const ip = getClientIp(request);
  const limit = checkRateLimit(`discord-embed:${session.id}:${ip}`, 20, 10 * 60 * 1000);
  if (!limit.ok) return respondTo(request, { error: "Забагато Discord-операцій. Спробуй пізніше." }, "/discord", 429);

  let returnTo = "/discord";

  try {
    const form = await request.formData();
    returnTo = safeReturnTo(form.get("returnTo"));
    const mode = String(form.get("mode") || "general") === "rules" ? "rules" : "general";
    const ruleType = mode === "rules" && String(form.get("ruleType") || "guild") === "raid" ? "raid" : "guild";
    const action = String(form.get("action") || "publish");
    const channelId = String(form.get("channelId") || "").trim();
    const messageLink = messageLinkFromForm(form, request, action);
    const content = String(form.get("content") || "").trim();
    const embed = embedFromEditableForm(form);
    const isRules = mode === "rules";
    const selectedRoles = selectedRoleIds(form);
    const roleIds = isRules && ruleType === "guild" ? selectedRoles : [];
    const mentionRoleIds = isRules ? [] : selectedRoles;
    const editRef = parseDiscordMessageRef(messageLink);
    const shouldEdit = action === "edit" || Boolean(editRef);
    const effectiveAction = shouldEdit ? "edit" : "publish";
    const actor = (await resolveAuthorIdentity(session)).primaryName || session.name || session.login || session.id;
    const auditReason = `Mistblossom panel: ${isRules ? ruleType === "raid" ? "raid rules" : "rules" : "embed"} ${effectiveAction} by ${actor} (${hierarchyTitle(session.role)})`;

    logDashboardEvent("info", "discord.embed.submit", request, {
      mode,
      ruleType: isRules ? ruleType : "general",
      action,
      effectiveAction,
      channelId,
      hasMessageLink: Boolean(messageLink),
      editTarget: editRef ? `${editRef.channelId}/${editRef.messageId}` : "",
      contentLength: content.length,
      roleCount: roleIds.length,
      mentionRoleCount: mentionRoleIds.length,
      actorId: session.id,
      actorRole: session.role,
    });

    if (isRules && !canManageRulesEmbeds(session)) {
      logDashboardEvent("warn", "discord.embed.validation_failed", request, { reason: "rules_forbidden", actorId: session.id, actorRole: session.role });
      return respondTo(request, { error: "Створення й редагування правил доступне тільки гільдмайстеру." }, returnTo, 403);
    }

    if (isRules && ruleType === "guild" && roleIds.length === 0) {
      logDashboardEvent("warn", "discord.embed.validation_failed", request, { reason: "missing_rules_role", actorId: session.id });
      return respondTo(request, { error: "Для правил потрібно вибрати роль, яка буде видана після завершення реєстрації." }, returnTo, 400);
    }

    if (messageLink && !editRef) {
      logDashboardEvent("warn", "discord.embed.validation_failed", request, { reason: "invalid_edit_link", actorId: session.id });
      return respondTo(request, { error: "Посилання на Discord-повідомлення невалідне. Прибери його або встав повне посилання на повідомлення." }, returnTo, 400);
    }

    if (shouldEdit) {
      if (!editRef) {
        logDashboardEvent("warn", "discord.embed.validation_failed", request, { reason: "missing_edit_link", actorId: session.id });
        return respondTo(request, { error: "Для редагування встав посилання на Discord-повідомлення." }, returnTo, 400);
      }

      if (!canManageRulesEmbeds(session)) {
        const currentMessage = await fetchDiscordEditableMessage(editRef);
        if (currentMessage.isRules) {
          logDashboardEvent("warn", "discord.embed.validation_failed", request, {
            reason: "officer_tried_to_edit_rules_embed",
            actorId: session.id,
            actorRole: session.role,
            channelId: editRef.channelId,
            messageId: editRef.messageId,
          });
          return respondTo(request, { error: "Це повідомлення правил. Офіцер може редагувати тільки звичайні Discord-повідомлення." }, returnTo, 403);
        }
      }

      await editDiscordEmbedMessage({
        ref: editRef,
        content,
        embed,
        roleIds,
        mentionRoleIds,
        withRulesButtons: isRules,
        rulesType: ruleType,
        auditReason,
      });

      logDashboardEvent("info", "discord.embed.updated", request, {
        mode,
        channelId: editRef.channelId,
        messageId: editRef.messageId,
        actorId: session.id,
        actorRole: session.role,
      });

      return respondTo(request, {
        updated: discordMessageUrl(editRef.channelId, editRef.messageId),
        tab: mode,
      }, returnTo);
    }

    const created = await createDiscordEmbedMessage({
      channelId,
      content,
      embed,
      roleIds,
      mentionRoleIds,
      withRulesButtons: isRules,
      rulesType: ruleType,
      auditReason,
    });

    logDashboardEvent("info", "discord.embed.published", request, {
      mode,
      channelId,
      messageId: created?.id,
      actorId: session.id,
      actorRole: session.role,
    });

    return respondTo(request, {
      published: created?.id ? discordMessageUrl(channelId, String(created.id)) : "Discord-повідомлення",
      tab: mode,
    }, returnTo);
  } catch (error) {
    logDashboardEvent("error", "discord.embed.failed", request, { actorId: session.id, message: safeErrorMessage(error) });
    return respondTo(request, { error: "Не вдалося виконати дію з Discord-повідомленням. Спробуй ще раз або перевір доступ до каналу." }, returnTo, 500);
  }
}
