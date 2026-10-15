import type { StructuredLogSettings } from "@/lib/logSettings";

export type LogSettingsSnapshot = { settings: StructuredLogSettings; configured: boolean; canEdit: boolean; canTuneStorage: boolean };
export type LogSettingsDraft = {
  securityDiscordEnabled: boolean; securityDiscordChannelId: string;
  securityDiscordMinLevel: "info" | "warning" | "error";
  maxStorageMb: string; maxRows: string; queryLimit: string;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
export function isLogSettings(value: unknown): value is StructuredLogSettings {
  return object(value) && value.retentionDays === 3 && integer(value.maxStorageMb, 32, 1024) && integer(value.maxRows, 5000, 250000) && integer(value.queryLimit, 50, 500) &&
    typeof value.securityDiscordEnabled === "boolean" && typeof value.securityDiscordChannelId === "string" && /^(?:\d{16,25})?$/.test(value.securityDiscordChannelId) &&
    (!value.securityDiscordEnabled || Boolean(value.securityDiscordChannelId)) && ["info", "warning", "error"].includes(String(value.securityDiscordMinLevel)) &&
    ["env", "database"].includes(String(value.source)) && (value.updatedAt === null || typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))) &&
    (value.updatedBy === null || typeof value.updatedBy === "string");
}
export function parseLogSettingsSnapshot(value: unknown): LogSettingsSnapshot {
  if (!object(value) || value.ok !== true || !isLogSettings(value.settings) || typeof value.configured !== "boolean" || typeof value.canEdit !== "boolean" || typeof value.canTuneStorage !== "boolean") throw new Error("Сервер не підтвердив поточні налаштування журналу.");
  return value as LogSettingsSnapshot;
}
export function logSettingsDraft(settings: StructuredLogSettings): LogSettingsDraft {
  return { securityDiscordEnabled: settings.securityDiscordEnabled, securityDiscordChannelId: settings.securityDiscordChannelId, securityDiscordMinLevel: settings.securityDiscordMinLevel, maxStorageMb: String(settings.maxStorageMb), maxRows: String(settings.maxRows), queryLimit: String(settings.queryLimit) };
}
export function sameLogSettingsChoice(left: LogSettingsDraft, right: LogSettingsDraft, tuneStorage: boolean) {
  return left.securityDiscordEnabled === right.securityDiscordEnabled && left.securityDiscordChannelId === right.securityDiscordChannelId && left.securityDiscordMinLevel === right.securityDiscordMinLevel &&
    (!tuneStorage || ["maxStorageMb", "maxRows", "queryLimit"].every(key => { const field = key as "maxStorageMb" | "maxRows" | "queryLimit"; return /^\d+$/.test(left[field]) && /^\d+$/.test(right[field]) ? Number(left[field]) === Number(right[field]) : left[field] === right[field]; }));
}
export function validLogSettingsDraft(draft: LogSettingsDraft, tuneStorage: boolean) {
  return typeof draft.securityDiscordEnabled === "boolean" && /^(?:\d{16,25})?$/.test(draft.securityDiscordChannelId) && (!draft.securityDiscordEnabled || Boolean(draft.securityDiscordChannelId)) && ["info", "warning", "error"].includes(draft.securityDiscordMinLevel) &&
    (!tuneStorage || [[draft.maxStorageMb,32,1024],[draft.maxRows,5000,250000],[draft.queryLimit,50,500]].every(([value,min,max]) => /^\d+$/.test(String(value)) && integer(Number(value), Number(min), Number(max))));
}
export function confirmLogSettingsSave(value: unknown, attempted: LogSettingsDraft, tuneStorage: boolean) {
  if (!object(value) || value.ok !== true || !isLogSettings(value.settings) || value.settings.source !== "database" || !sameLogSettingsChoice(logSettingsDraft(value.settings), attempted, tuneStorage)) throw new Error("Сервер не підтвердив збереження вибраних налаштувань.");
  return value.settings;
}
export function confirmSecurityMirrorTest(value: unknown, channelId: string) {
  return object(value) && value.ok === true && value.channelId === channelId && typeof value.messageId === "string" && /^\d{16,25}$/.test(value.messageId);
}
