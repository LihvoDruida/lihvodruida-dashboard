"use client";

import { useState } from "react";
import { RolePicker, type DiscordRoleOption } from "@/components/DiscordEmbedEditor";

export default function RaidRoleMentionPicker({ roles, selectedRoleIds }: { roles: DiscordRoleOption[]; selectedRoleIds: string[] }) {
  const [roleIds, setRoleIds] = useState(selectedRoleIds);

  return (
    <RolePicker
      roles={roles}
      selectedRoleIds={roleIds}
      onChange={setRoleIds}
      fieldName="mentionRoleIds"
      ariaLabel="Ролі, які будуть згадані в рейдовому оголошенні"
      emptyLabel="Ролі ще не вибрані"
      helperText="Вибрані ролі будуть тегнуті над Discord embed рейду так само, як у звичайних embed."
    />
  );
}
