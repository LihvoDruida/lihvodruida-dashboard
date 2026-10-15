export type StaticRoleChoice = { memberRoleId: string; managerRoleId: string };
export type StaticRoleOption = { id: string; name: string; color: number; manageable: boolean; blockedReason?: string | null; position: number };
export type StaticRoleOverview = { settings: StaticRoleChoice; roles: StaticRoleOption[]; warning: string | null; botCanManageRoles: boolean; guildName: string | null };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const roleId = (value: unknown): value is string => typeof value === "string" && (value === "" || /^[0-9]{16,25}$/.test(value));
export function isStaticRoleChoice(value: unknown): value is StaticRoleChoice {
  return record(value) && roleId(value.memberRoleId) && roleId(value.managerRoleId);
}
export function sameStaticRoleChoice(left: StaticRoleChoice, right: StaticRoleChoice) {
  return left.memberRoleId === right.memberRoleId && left.managerRoleId === right.managerRoleId;
}
export function parseStaticRoleOverview(value: unknown): StaticRoleOverview {
  if (!record(value) || value.ok !== true || !isStaticRoleChoice(value.settings) || !Array.isArray(value.roles) || typeof value.botCanManageRoles !== "boolean" ||
      !(value.warning === null || typeof value.warning === "string") || !(value.guildName === null || typeof value.guildName === "string")) throw new Error("Сервер не повернув коректний стан Discord-ролей.");
  const ids = new Set<string>();
  for (const role of value.roles) {
    if (!record(role) || !roleId(role.id) || !role.id || ids.has(role.id) || typeof role.name !== "string" || typeof role.manageable !== "boolean" || !Number.isFinite(role.color) || !Number.isFinite(role.position) ||
        !(role.blockedReason == null || typeof role.blockedReason === "string")) throw new Error("Сервер не повернув коректний список Discord-ролей.");
    ids.add(role.id);
  }
  return value as StaticRoleOverview;
}
export function confirmStaticRoleSave(value: unknown, attempted: StaticRoleChoice): StaticRoleChoice {
  if (!record(value) || value.ok !== true || !isStaticRoleChoice(value.settings) || !value.settings.memberRoleId || !value.settings.managerRoleId ||
      value.settings.memberRoleId === value.settings.managerRoleId || !sameStaticRoleChoice(value.settings, attempted)) throw new Error("Сервер не підтвердив вибрані Discord-ролі.");
  return value.settings;
}
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("uk-UA").trim();
export function indexStaticRoles(roles: StaticRoleOption[]) {
  return roles.map(role => ({ role, search: normalize(role.name) + " " + role.id }));
}
export function filterStaticRoles(index: ReturnType<typeof indexStaticRoles>, search: string, selected: StaticRoleChoice) {
  const query = normalize(search);
  let matches = 0;
  const roles = index.filter(item => {
    const matched = !query || item.search.includes(query);
    if (matched) matches++;
    return matched || item.role.id === selected.memberRoleId || item.role.id === selected.managerRoleId;
  }).map(item => item.role);
  return { roles, matches };
}
