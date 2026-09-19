import "server-only";

import { buildAutoroleCustomId, decodeAutoroleCustomId, validateInteractionComponents } from "@mistblossom/discord-contract";
import { addDiscordMemberRoles, removeDiscordMemberRoles } from "@/lib/discordMemberManagement";
import { assertDiscordRolesManageable } from "@/lib/discordAdmin";
import { listAccessGroups } from "@/lib/accessGroups";
import { getDiscordWelcomeCardSettings } from "@/lib/discordWelcomeCardSettings";

export type DiscordAutoroleBehavior = "add" | "remove" | "toggle";
export type DiscordAutoroleButton = {
  id: string;
  label: string;
  emoji: string;
  style: 1 | 2 | 3 | 4;
  roleId: string;
  behavior: DiscordAutoroleBehavior;
  group: string;
  disabled: boolean;
};

function cleanText(value: unknown, max: number) {
  return Array.from(String(value || "").normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("");
}

function cleanRoleId(value: unknown) {
  const roleId = String(value || "").trim();
  return /^\d{16,25}$/.test(roleId) ? roleId : "";
}

function cleanGroup(value: unknown) {
  return String(value || "").normalize("NFKD").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 16);
}

function cleanStyle(value: unknown): 1 | 2 | 3 | 4 {
  const style = Number(value);
  return style === 1 || style === 2 || style === 3 || style === 4 ? style : 2;
}

function cleanBehavior(value: unknown): DiscordAutoroleBehavior {
  const behavior = String(value || "").trim();
  return behavior === "add" || behavior === "remove" ? behavior : "toggle";
}

function cleanEmoji(value: unknown) {
  return cleanText(value, 80);
}

function emojiPayload(value: string) {
  const clean = cleanEmoji(value);
  if (!clean) return undefined;
  const custom = clean.match(/^<a?:([A-Za-z0-9_]{2,32}):(\d{16,25})>$/);
  if (custom) return { name: custom[1], id: custom[2], animated: clean.startsWith("<a:") };
  if (clean.startsWith("<") || clean.endsWith(">")) throw new Error("Custom emoji має формат <:name:id> або <a:name:id>.");
  return { name: clean };
}

export function normalizeAutoroleButtons(input: unknown): DiscordAutoroleButton[] {
  const list = Array.isArray(input) ? input : [];
  const output: DiscordAutoroleButton[] = [];
  for (let index = 0; index < Math.min(25, list.length); index += 1) {
    const raw = list[index] && typeof list[index] === "object" ? list[index] as Record<string, unknown> : {};
    const roleId = cleanRoleId(raw.roleId);
    const label = cleanText(raw.label, 80);
    if (!roleId || !label) continue;
    output.push({
      id: cleanText(raw.id, 40) || `autorole-${index + 1}`,
      label,
      emoji: cleanEmoji(raw.emoji),
      style: cleanStyle(raw.style),
      roleId,
      behavior: cleanBehavior(raw.behavior),
      group: cleanGroup(raw.group),
      disabled: Boolean(raw.disabled),
    });
  }
  return output;
}

export function parseAutoroleButtonsJson(value: unknown) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value || "[]"));
  } catch {
    throw new Error("Список кнопок авторолей має пошкоджений JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("Список кнопок авторолей має бути масивом.");
  if (parsed.length > 25) throw new Error("Discord дозволяє максимум 25 кнопок у повідомленні.");
  const normalized = normalizeAutoroleButtons(parsed);
  if (normalized.length !== parsed.length) {
    throw new Error("Кожна кнопка авторолі повинна мати текст і коректну Discord-роль.");
  }
  return normalized;
}

export async function assertAutoroleRolesAllowed(roleIdsInput: unknown[]) {
  const roleIds = await assertDiscordRolesManageable(roleIdsInput);
  const [groups, welcomeSettings] = await Promise.all([
    listAccessGroups(),
    getDiscordWelcomeCardSettings(),
  ]);
  const protectedRoleIds = new Map<string, string>();
  for (const group of groups) {
    for (const roleId of group.discordRoleIds || []) {
      protectedRoleIds.set(roleId, `роль керує доступом групи «${group.name}»`);
    }
  }
  if (welcomeSettings?.defaultRoleId) {
    protectedRoleIds.set(welcomeSettings.defaultRoleId, "це стартова onboarding-роль нових учасників");
  }
  const blocked = roleIds.filter((roleId) => protectedRoleIds.has(roleId));
  if (blocked.length) {
    throw new Error(`Авторолі не можуть змінювати системні ролі доступу: ${blocked.map((roleId) => `${roleId} (${protectedRoleIds.get(roleId)})`).join(", ")}. Створи окрему cosmetic/self-role.`);
  }
  return roleIds;
}

export function buildAutoroleComponents(buttonsInput: unknown) {
  const buttons = normalizeAutoroleButtons(buttonsInput);
  if (!buttons.length) throw new Error("Додай хоча б одну кнопку авторолі.");
  const rows: Array<{ type: 1; components: unknown[] }> = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push({
      type: 1,
      components: buttons.slice(index, index + 5).map((button) => {
        const emoji = emojiPayload(button.emoji);
        return {
          type: 2,
          style: button.style,
          label: button.label,
          custom_id: buildAutoroleCustomId(button.behavior, button.roleId, button.group),
          ...(emoji ? { emoji } : {}),
          ...(button.disabled ? { disabled: true } : {}),
        };
      }),
    });
  }
  const validation = validateInteractionComponents(rows);
  if (!validation.ok) {
    if (validation.duplicates.length) throw new Error("Дві кнопки мають однакову дію/роль/group. Зміни поведінку, роль або exclusive group.");
    throw new Error("Набір кнопок не відповідає обмеженням Discord (до 5 кнопок у рядку, до 5 рядків, custom_id до 100 символів).");
  }
  return rows;
}

function readButtons(components: unknown): DiscordAutoroleButton[] {
  if (!Array.isArray(components)) return [];
  const output: DiscordAutoroleButton[] = [];
  let index = 0;
  for (const row of components) {
    const items = row && typeof row === "object" && Array.isArray((row as any).components) ? (row as any).components : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const decoded = decodeAutoroleCustomId(String((item as any).custom_id || ""));
      if (!decoded) continue;
      const emoji = (item as any).emoji;
      const emojiText = emoji?.id && emoji?.name
        ? `<${emoji?.animated ? "a" : ""}:${String(emoji.name)}:${String(emoji.id)}>`
        : String(emoji?.name || "");
      index += 1;
      output.push({
        id: `autorole-${index}`,
        label: cleanText((item as any).label, 80) || `Role ${decoded.roleId.slice(-6)}`,
        emoji: cleanEmoji(emojiText),
        style: cleanStyle((item as any).style),
        roleId: decoded.roleId,
        behavior: cleanBehavior(decoded.action),
        group: cleanGroup(decoded.group),
        disabled: Boolean((item as any).disabled),
      });
    }
  }
  return output;
}

export function extractAutoroleButtonsFromMessage(message: Record<string, unknown>) {
  return readButtons(message.components);
}

export function isAutoroleMessage(message: Record<string, unknown>) {
  return extractAutoroleButtonsFromMessage(message).length > 0;
}

export async function handleAutoroleInteraction(params: {
  customId: string;
  userId: string;
  userName: string;
  memberRoleIds?: string[];
  messageComponents?: unknown;
}) {
  const action = decodeAutoroleCustomId(params.customId);
  if (!action) return { ok: false, content: "⚠️ Ця кнопка авторолі застаріла або пошкоджена." };
  if (!/^\d{16,25}$/.test(params.userId)) return { ok: false, content: "❌ Discord не передав коректний user ID." };

  await assertAutoroleRolesAllowed([action.roleId]);
  const currentRoleIds = Array.from(new Set((params.memberRoleIds || []).map(String)));
  const hasRole = currentRoleIds.includes(action.roleId);
  const shouldAdd = action.action === "add" || (action.action === "toggle" && !hasRole);
  const shouldRemove = action.action === "remove" || (action.action === "toggle" && hasRole);
  const reason = `Mistblossom autorole button by ${params.userName}`.slice(0, 480);

  if (shouldRemove) {
    if (!hasRole) return { ok: true, content: "ℹ️ Цієї ролі у тебе вже немає." };
    await removeDiscordMemberRoles({ userId: params.userId, roleIds: [action.roleId], reason });
    return { ok: true, content: "✅ Роль знято." };
  }

  if (shouldAdd) {
    if (action.group) {
      const groupRoleIds = extractAutoroleButtonsFromMessage({ components: params.messageComponents })
        .filter((button) => button.group === action.group && button.roleId !== action.roleId)
        .map((button) => button.roleId)
        .filter((roleId) => currentRoleIds.includes(roleId));
      if (groupRoleIds.length) {
        await removeDiscordMemberRoles({ userId: params.userId, roleIds: groupRoleIds, reason: `${reason}; exclusive group ${action.group}` });
      }
    }
    if (hasRole) return { ok: true, content: "ℹ️ Ця роль у тебе вже є." };
    await addDiscordMemberRoles({ userId: params.userId, roleIds: [action.roleId], reason });
    return { ok: true, content: action.group ? "✅ Роль видано. Іншу роль із цієї групи, якщо була, знято." : "✅ Роль видано." };
  }

  return { ok: false, content: "⚠️ Не вдалося визначити дію кнопки." };
}
