"use client";

import { useMemo, useState } from "react";
import type { DashboardRole } from "@/lib/auth";
import type { AccessGroup, DashboardPermissionKey } from "@/lib/accessGroupSchema";
import {
  DASHBOARD_PERMISSION_KEYS,
  DEFAULT_ADMIN_GROUP_ID,
  DEFAULT_MEMBER_GROUP_ID,
  DEFAULT_MENTOR_GROUP_ID,
  DEFAULT_MODERATOR_GROUP_ID,
  PERMISSION_META,
} from "@/lib/accessGroupSchema";

const ROLE_OPTIONS: Array<{ value: DashboardRole; label: string; hint: string }> = [
  { value: "member", label: "Учасник", hint: "Базовий доступ до профілю та рейдів" },
  { value: "mentor", label: "Наставник", hint: "Перегляд заявок без чутливих даних" },
  { value: "moderator", label: "Модератор", hint: "Офіцерські дії без керування адмінами" },
  { value: "admin", label: "Адмін", hint: "Адміністративний рівень" },
];

type Props = {
  groups: AccessGroup[];
  isServerOwner: boolean;
  currentGroupId?: string;
  saveGroupAction: (formData: FormData) => Promise<void>;
  deleteGroupAction: (formData: FormData) => Promise<void>;
  impersonateAction: (formData: FormData) => Promise<void>;
};

function permissionsByCategory() {
  return DASHBOARD_PERMISSION_KEYS.reduce<Record<string, DashboardPermissionKey[]>>((acc, key) => {
    const category = PERMISSION_META[key].category;
    acc[category] = acc[category] || [];
    acc[category].push(key);
    return acc;
  }, {});
}

function fixedLabel(group: AccessGroup) {
  if (group.id === DEFAULT_ADMIN_GROUP_ID) return "Системна група · ID 1";
  if (group.id === DEFAULT_MODERATOR_GROUP_ID) return "Системна група · ID 2";
  if (group.id === DEFAULT_MEMBER_GROUP_ID) return "Системна група · ID 99";
  if (group.id === DEFAULT_MENTOR_GROUP_ID) return "Системна група · наставники";
  return "Користувацька група";
}

function roleLabel(role: DashboardRole) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.label || "Група";
}

function roleHint(role: DashboardRole) {
  return ROLE_OPTIONS.find((item) => item.value === role)?.hint || "Налаштовується правами нижче";
}

function primaryDiscordRoleId(group: AccessGroup) {
  return group.discordRoleIds[0] || "";
}

function groupIcon(group: AccessGroup) {
  return group.icon || (group.role === "admin" ? "👑" : group.role === "moderator" ? "🛡️" : group.role === "mentor" ? "🌿" : "🍃");
}

function cannotEditReason(group: AccessGroup, currentGroupId: string | undefined, isServerOwner: boolean) {
  if (isServerOwner) return "";
  if (group.id === currentGroupId) return "Це твоя поточна група. Самому собі права не змінюємо.";
  if (group.id === DEFAULT_ADMIN_GROUP_ID || group.role === "admin" || group.rank >= 100 || group.permissions.includes("groups.manage")) {
    return "Адмінські групи та право керування групами змінює тільки власник Discord-сервера.";
  }
  return "";
}

function PermissionCheckbox({ permissionKey, checked, disabled }: { permissionKey: DashboardPermissionKey; checked: boolean; disabled: boolean }) {
  return (
    <label className="permission-check">
      <input type="checkbox" name="permissions" value={permissionKey} defaultChecked={checked} disabled={disabled} />
      <span>
        <strong>{PERMISSION_META[permissionKey].title}</strong>
        <small>{PERMISSION_META[permissionKey].description}</small>
      </span>
    </label>
  );
}

export default function AccessGroupsManager({ groups, isServerOwner, currentGroupId, saveGroupAction, deleteGroupAction, impersonateAction }: Props) {
  const [expanded, setExpanded] = useState<string>(groups[0]?.id || "new");
  const categories = useMemo(() => Object.entries(permissionsByCategory()) as Array<[string, DashboardPermissionKey[]]>, []);

  return (
    <div className="access-groups-layout">
      <aside className="access-groups-list panel" aria-label="Список груп доступу">
        <div className="access-groups-list__header">
          <span className="section-title">Групи</span>
          <small>{groups.length} груп</small>
        </div>
        {groups.map((group) => (
          <button key={group.id} type="button" className={`btn subtle access-group-tab${expanded === group.id ? " is-active" : ""}`} onClick={() => setExpanded(group.id)}>
            <strong><span className="access-group-tab__icon" aria-hidden="true">{groupIcon(group)}</span>{group.name}</strong>
            <span>ID {group.id} · {roleLabel(group.role)} · {group.permissions.length} прав</span>
          </button>
        ))}
        <button type="button" className={`btn subtle access-group-tab${expanded === "new" ? " is-active" : ""}`} onClick={() => setExpanded("new")}>
          <strong><span className="access-group-tab__icon" aria-hidden="true">＋</span>Нова група</strong>
          <span>ID, назва, іконка, Discord роль і права</span>
        </button>
      </aside>

      <div className="access-groups-editor">
        {groups.map((group) => {
          const reason = cannotEditReason(group, currentGroupId, isServerOwner);
          const canEdit = !reason;
          const canDelete = canEdit && !group.protectedGroup;
          const isFixedSystemGroup = group.id === DEFAULT_ADMIN_GROUP_ID || group.id === DEFAULT_MODERATOR_GROUP_ID || group.id === DEFAULT_MEMBER_GROUP_ID;
          const canEditRole = canEdit && !isFixedSystemGroup;
          const canEditRank = canEdit && !isFixedSystemGroup;

          return expanded === group.id ? (
            <form key={group.id} className="panel access-group-card" action={saveGroupAction} data-dashboard-action-form="true" data-dashboard-action="access-groups-save">
              <input type="hidden" name="currentId" value={group.id} />
              <div className="access-group-card__head">
                <div>
                  <span className="eyebrow">{fixedLabel(group)}</span>
                  <h2><span className="access-group-title-icon" aria-hidden="true">{groupIcon(group)}</span>{group.name}</h2>
                  <p>{reason || "Зміни збережуться у Firebase. Користувачі отримають нові права автоматично після оновлення сесії або повторного входу."}</p>
                </div>
                {isServerOwner ? (
                  <button className="btn subtle" formAction={impersonateAction} name="groupId" value={group.id} type="submit" formNoValidate data-dashboard-action="access-groups-impersonate" data-loading-label="Вмикаємо перегляд...">
                    Переглянути як
                  </button>
                ) : null}
              </div>

              <div className="access-group-summary" aria-label="Коротко про групу">
                <span><strong>{groupIcon(group)} {roleLabel(group.role)}</strong><small>{roleHint(group.role)}</small></span>
                <span><strong>Ранг {group.rank}</strong><small>Вищий ранг має пріоритет, якщо в Discord є кілька ролей</small></span>
                <span><strong>{primaryDiscordRoleId(group) || "Discord role ID не заданий"}</strong><small>Для однієї групи дозволена тільки одна Discord-роль</small></span>
              </div>

              <div className="form-grid compact-form-grid access-form-grid">
                <label>
                  <span>ID групи</span>
                  <input className="input" name="id" defaultValue={group.id} readOnly={group.lockedId || !canEdit} inputMode="text" autoComplete="off" />
                  <small>{group.lockedId ? "Системний ID не змінюється." : "Лише латиниця, цифри, _ або -."}</small>
                </label>
                <label>
                  <span>Назва групи</span>
                  <input className="input" name="name" defaultValue={group.name} readOnly={!canEdit} maxLength={80} autoComplete="off" />
                  <small>Коротка назва, яка буде показана в панелі.</small>
                </label>
                <label>
                  <span>Роль у системі</span>
                  <select className="select" name="role" defaultValue={group.role} disabled={!canEditRole}>
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value} disabled={role.value === "admin" && !isServerOwner}>{role.label}</option>
                    ))}
                  </select>
                  <small>{isFixedSystemGroup ? "Для системних груп роль зафіксована." : "Впливає на рівень доступу та службові підписи в панелі."}</small>
                </label>
                <label>
                  <span>Ранг</span>
                  <input className="input" name="rank" type="number" min="1" max="100" defaultValue={group.rank} readOnly={!canEditRank} />
                  <small>Пріоритет групи. Якщо ролей кілька — перемагає більший ранг.</small>
                </label>
                <label>
                  <span>Іконка групи <em>необов’язково</em></span>
                  <input className="input" name="icon" defaultValue={group.icon || ""} placeholder="👑" readOnly={!canEdit} maxLength={24} autoComplete="off" />
                  <small>Короткий emoji або символ для швидкого впізнавання групи.</small>
                </label>
                <label>
                  <span>Discord role ID</span>
                  <input className="input" name="discordRoleId" defaultValue={primaryDiscordRoleId(group)} placeholder="123456789012345678" readOnly={!canEdit} inputMode="numeric" pattern="[0-9]{16,25}" autoComplete="off" />
                  <small>Тільки одна Discord-роль на групу. Якщо поле порожнє, група не прив’язана до ролі Discord.</small>
                </label>
              </div>

              {!canEdit ? <div className="access-warning" role="status">{reason}</div> : null}

              <div className="permissions-grid">
                {categories.map(([category, keys]) => (
                  <fieldset key={category}>
                    <legend>{category}</legend>
                    {keys.map((key) => (
                      <PermissionCheckbox key={key} permissionKey={key} checked={group.permissions.includes(key)} disabled={!canEdit || key === "dashboard.view" || (key === "groups.manage" && !isServerOwner)} />
                    ))}
                  </fieldset>
                ))}
              </div>

              <div className="form-actions access-form-actions">
                <button className="btn primary" type="submit" disabled={!canEdit} data-dashboard-action="access-groups-save" data-loading-label="Зберігаємо...">Зберегти зміни</button>
                {canDelete ? <button className="btn danger" formAction={deleteGroupAction} name="groupId" value={group.id} type="submit" data-dashboard-action="access-groups-delete" data-loading-label="Видаляємо..." data-confirm-message="Видалити цю групу доступу? Дію не можна швидко скасувати.">Видалити групу</button> : null}
              </div>
            </form>
          ) : null;
        })}

        {expanded === "new" ? (
          <form className="panel access-group-card" action={saveGroupAction} data-dashboard-action-form="true" data-dashboard-action="access-groups-create">
            <div className="access-group-card__head">
              <div>
                <span className="eyebrow">Нова група</span>
                <h2>Додати групу доступу</h2>
                <p>Створи групу, прив’яжи одну Discord-роль і вибери тільки потрібні права. Системні ID 1, 2 і 99 зайняті.</p>
              </div>
            </div>
            <div className="form-grid compact-form-grid access-form-grid">
              <label>
                <span>ID групи</span>
                <input className="input" name="id" placeholder="raid_lead" required autoComplete="off" />
                <small>Унікальний ID: латиниця, цифри, _ або -.</small>
              </label>
              <label>
                <span>Назва групи</span>
                <input className="input" name="name" placeholder="Рейд-лідер" required maxLength={80} autoComplete="off" />
                <small>Назва для списків і статусів у панелі.</small>
              </label>
              <label>
                <span>Роль у системі</span>
                <select className="select" name="role" defaultValue="member">
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role.value} value={role.value} disabled={role.value === "admin" && !isServerOwner}>{role.label}</option>
                  ))}
                </select>
                <small>Адмінську роль може створювати тільки власник сервера.</small>
              </label>
              <label>
                <span>Ранг</span>
                <input className="input" name="rank" type="number" min="1" max="100" defaultValue="20" />
                <small>Чим вищий ранг, тим пріоритетніша група.</small>
              </label>
              <label>
                <span>Іконка групи <em>необов’язково</em></span>
                <input className="input" name="icon" placeholder="🌿" maxLength={24} autoComplete="off" />
                <small>Emoji або короткий символ. Можна залишити порожнім.</small>
              </label>
              <label>
                <span>Discord role ID</span>
                <input className="input" name="discordRoleId" placeholder="123456789012345678" inputMode="numeric" pattern="[0-9]{16,25}" autoComplete="off" />
                <small>Одна група = одна Discord-роль. Додаткові ролі створюй окремими групами.</small>
              </label>
            </div>
            <div className="permissions-grid">
              {categories.map(([category, keys]) => (
                <fieldset key={category}>
                  <legend>{category}</legend>
                  {keys.map((key) => (
                    <PermissionCheckbox key={key} permissionKey={key} checked={key === "dashboard.view"} disabled={key === "dashboard.view" || (key === "groups.manage" && !isServerOwner)} />
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="form-actions access-form-actions"><button className="btn primary" type="submit" data-dashboard-action="access-groups-create" data-loading-label="Створюємо...">Створити групу</button></div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
