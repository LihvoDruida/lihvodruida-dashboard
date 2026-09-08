import type { RaidCharacterRole, RaidSignup } from "@/lib/raids";

/**
 * Спільна презентація підписів на рейд.
 *
 * `RaidViews` і `RaidEditorLivePreview` малюють ті самі значки, номери й
 * підписи спеків — і тримали для цього однакові копії. Прев'ю має виглядати
 * рівно так, як потім виглядатиме сторінка рейду, тож розходження копій тут
 * означає, що людина бачить одне, а отримує інше.
 *
 * Типи беруться як `import type`, тому серверний `@/lib/raids` у клієнтський
 * бандл не потрапляє.
 */

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function formatRaidDateTime(date?: string | null, time?: string | null) {
  if (!date && !time) return "Дата уточнюється";
  return [date || "Дата уточнюється", time || ""].filter(Boolean).join(", ");
}

export function raidPartyRoleLabel(role: RaidCharacterRole) {
  if (role === "tank") return "Танк";
  if (role === "healer") return "Хіл";
  return "ДД";
}

export function signupSpecLabel(item?: RaidSignup | null) {
  if (!item) return "";
  const spec = item.activeSpecName
    ? `${item.activeSpecName}${item.className ? ` • ${item.className}` : ""}`
    : item.className || "";
  const guildLabel = item.verifiedGuild === false ? "Інший персонаж" : "";
  return [spec, guildLabel].filter(Boolean).join(" • ");
}

/** Порядковий номер запису. Порожній кружечок означає вільне місце. */
export function SignupNumberBadge({ item }: { item?: Pick<RaidSignup, "signupNumber"> | null }) {
  const number = Number(item?.signupNumber || 0);
  const hasNumber = Number.isFinite(number) && number > 0;
  const label = hasNumber ? `${Math.floor(number)}` : "";
  const title = hasNumber
    ? `Порядковий номер запису: ${Math.floor(number)}`
    : "Місце ще не зайняте";
  return (
    <span
      className={`raid-signup-order${label ? "" : " raid-signup-order--empty"}`}
      title={title}
    >
      {label}
    </span>
  );
}

export function RoleMarkerStack({
  item,
  role,
  iconClassName = "raid-role-icon",
}: {
  item?: Pick<RaidSignup, "signupNumber"> | null;
  role: RaidCharacterRole;
  iconClassName?: string;
}) {
  return (
    <span className="raid-signup-side" aria-hidden="true">
      <SignupNumberBadge item={item} />
      <span className={iconClassName}>
        {role === "tank" ? "🛡" : role === "healer" ? "✚" : "⚔"}
      </span>
    </span>
  );
}
