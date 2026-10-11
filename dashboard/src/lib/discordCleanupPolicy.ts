/** Pure policy shared with the UI and independent tests. Months are calendar months in UTC. */
export const DISCORD_CLEANUP_PERIODS = [
  { value: "week", label: "1 тиждень", months: 0 },
  { value: "month", label: "1 місяць", months: 1 },
  { value: "quarter", label: "3 місяці", months: 3 },
  { value: "halfYear", label: "Пів року", months: 6 },
  { value: "year", label: "1 рік", months: 12 },
] as const;
export type DiscordCleanupPeriod = typeof DISCORD_CLEANUP_PERIODS[number]["value"];
export type CleanupRole = { id: string; name: string; position: number; permissions: string; managed: boolean };
export type CleanupControl = {
  guildId: string; ownerId: string; botId: string; botTopRole: CleanupRole | null;
  canKick: boolean; roles: CleanupRole[];
};
export type CleanupMember = { userId: string; displayName: string; roleIds: string[]; joinedAt?: string | null; bot?: boolean };
export function isCleanupPeriod(value: unknown): value is DiscordCleanupPeriod {
  return DISCORD_CLEANUP_PERIODS.some((period) => period.value === value);
}
export function cleanupDeadline(joinedAt: string | null | undefined, period: DiscordCleanupPeriod): string | null {
  if (!joinedAt) return null;
  const date = new Date(joinedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const option = DISCORD_CLEANUP_PERIODS.find((item) => item.value === period);
  if (!option) return null;
  if (period === "week") date.setUTCDate(date.getUTCDate() + 7);
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + option.months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString();
}
export function hasOnlyCleanupRole(member: CleanupMember, selectedRoleId: string, guildId: string) {
  if (!selectedRoleId || selectedRoleId === guildId || member.bot) return false;
  const roles = member.roleIds.filter((id) => id !== guildId);
  return roles.length === 0 || (roles.length === 1 && roles[0] === selectedRoleId);
}
function permissions(value: string) { try { return BigInt(value); } catch { return 0n; } }
export function cleanupRoleBlockedReason(role: CleanupRole, control: CleanupControl): string | null {
  if (role.id === control.guildId) return "Вибери роль, крім @everyone.";
  if (role.managed) return "Роль керується Discord або інтеграцією.";
  if (permissions(role.permissions) & 8n) return "Роль адміністратора захищена від очищення.";
  if (!control.botTopRole || role.position >= control.botTopRole.position) return "Роль має бути нижче найвищої ролі бота.";
  return null;
}
export function evaluateCleanupMember(member: CleanupMember, roleId: string, period: DiscordCleanupPeriod, control: CleanupControl, now = Date.now()) {
  const matches = hasOnlyCleanupRole(member, roleId, control.guildId);
  const dueAt = cleanupDeadline(member.joinedAt, period);
  let blockedReason: string | null = null;
  if (member.userId === control.ownerId || member.userId === control.botId) blockedReason = "Власник сервера та бот захищені.";
  else if (!dueAt || Date.parse(member.joinedAt || "") > now) blockedReason = "Немає коректної дати вступу. Виключення заблоковано.";
  else if (!control.canKick) blockedReason = "Боту потрібен дозвіл «Виключати учасників» (Kick Members).";
  else if (!control.botTopRole || control.botTopRole.position <= 0) blockedReason = "Боту потрібна окрема роль вище ролей учасників.";
  else {
    for (const id of member.roleIds.filter((id) => id !== control.guildId)) {
      const role = control.roles.find((item) => item.id === id);
      if (!role) { blockedReason = "Не вдалося перевірити роль учасника."; break; }
      const reason = cleanupRoleBlockedReason(role, control);
      if (reason) { blockedReason = reason; break; }
    }
    const everyone = control.roles.find((item) => item.id === control.guildId);
    if (everyone && (permissions(everyone.permissions) & 8n)) blockedReason = "@everyone має права адміністратора. Очищення заблоковано.";
  }
  return { matches, dueAt, blockedReason, overdue: Boolean(dueAt && now > Date.parse(dueAt)), eligible: matches && !blockedReason && Boolean(dueAt && now > Date.parse(dueAt)) };
}
