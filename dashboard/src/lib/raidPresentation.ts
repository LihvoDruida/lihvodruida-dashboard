import "server-only";
import {isRaidClosed, type RaidItem} from "@/lib/raids";
export function raidStatusLabel(raid: RaidItem) {
  if (isRaidClosed(raid)) return "Запис закрито";
  return raid.status === "published" ? "Опубліковано" : "Чернетка";
}

export function raidStatusClass(raid: RaidItem) {
  if (isRaidClosed(raid)) return "closed";
  return raid.status;
}

