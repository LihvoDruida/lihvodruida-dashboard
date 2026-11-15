import type { DashboardRole } from "@/types/auth";
import type { AccessGroup } from "@/lib/accessGroupSchema";
export const ROLE_OPTIONS: Array<{ value: DashboardRole; label: string }> = [
  { value: "member", label: "Учасник" },
  { value: "mentor", label: "Наставник" },
  { value: "moderator", label: "Модератор" },
  { value: "admin", label: "Адмін" },
];
export const roleLabel = (role: DashboardRole) =>
  ROLE_OPTIONS.find((item) => item.value === role)?.label || "Група";
export const groupIcon = (group: AccessGroup) =>
  group.icon ||
  (group.role === "admin"
    ? "👑"
    : group.role === "moderator"
      ? "🛡️"
      : group.role === "mentor"
        ? "🌿"
        : "🍃");
