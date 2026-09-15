"use client";

import { useEffect, useState } from "react";
import { RolePicker, type DiscordRoleOption } from "@/components/DiscordEmbedEditor";

type RaidRoleMentionPickerProps = {
  roles: DiscordRoleOption[];
  selectedRoleIds: string[];
  ariaLabel?: string;
  emptyLabel?: string;
  helperText?: string;
};

export default function RaidRoleMentionPicker({
  roles,
  selectedRoleIds,
  ariaLabel = "Ролі, які будуть згадані в рейдовому оголошенні",
  emptyLabel = "Ролі ще не вибрані",
  helperText = "Вибрані ролі будуть тегнуті над Discord embed рейду так само, як у звичайних embed.",
}: RaidRoleMentionPickerProps) {
  const selectedKey = selectedRoleIds.join("|");
  const [roleIds, setRoleIds] = useState(selectedRoleIds);

  useEffect(() => {
    setRoleIds(selectedRoleIds);
  }, [selectedKey]);

  return (
    <RolePicker
      roles={roles}
      selectedRoleIds={roleIds}
      onChange={setRoleIds}
      fieldName="mentionRoleIds"
      ariaLabel={ariaLabel}
      emptyLabel={emptyLabel}
      helperText={helperText}
    />
  );
}
