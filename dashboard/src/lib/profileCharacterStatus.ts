export type ProfileCharacterStatus =
  | "character_add_failed"
  | "character_add_duplicate"
  | "character_add_invalid"
  | "character_add_not_guild"
  | "character_add_conflict"
  | "character_add_profile_missing"
  | "character_add_firebase_unconfigured"
  | "character_add_firebase_failed"
  | "characters_bulk_no_verified"
  | "characters_bulk_all_duplicates"
  | "character_remove_failed"
  | "character_remove_invalid"
  | "character_remove_profile_missing"
  | "character_remove_firebase_unconfigured"
  | "main_character_failed"
  | "main_character_invalid"
  | "main_character_missing"
  | "main_character_profile_missing"
  | "main_character_firebase_unconfigured";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

export function characterAddStatusFromError(error: unknown): ProfileCharacterStatus {
  const message = errorText(error).toLowerCase();
  if (message.includes("firebase профілі не налаштовані")) return "character_add_firebase_unconfigured";
  if (message.includes("профіль не знайдено")) return "character_add_profile_missing";
  if (message.includes("некорект") || message.includes("invalid")) return "character_add_invalid";
  if (message.includes("не підтвердж") || message.includes("mistblossom") || message.includes("немає підтверджених")) return "character_add_not_guild";
  if (message.includes("іншого профілю") || message.includes("іншому профілі") || message.includes("another profile")) return "character_add_conflict";
  if (message.includes("already") || message.includes("вже дод")) return "character_add_duplicate";
  if (message.includes("firestore") || message.includes("firebase") || message.includes("permission")) return "character_add_firebase_failed";
  return "character_add_failed";
}

export function characterRemoveStatusFromError(error: unknown): ProfileCharacterStatus {
  const message = errorText(error).toLowerCase();
  if (message.includes("firebase профілі не налаштовані")) return "character_remove_firebase_unconfigured";
  if (message.includes("профіль не знайдено")) return "character_remove_profile_missing";
  if (message.includes("некорект") || message.includes("invalid")) return "character_remove_invalid";
  return "character_remove_failed";
}

export function mainCharacterStatusFromError(error: unknown): ProfileCharacterStatus {
  const message = errorText(error).toLowerCase();
  if (message.includes("firebase профілі не налаштовані")) return "main_character_firebase_unconfigured";
  if (message.includes("профіль не знайдено")) return "main_character_profile_missing";
  if (message.includes("не доданий") || message.includes("not added")) return "main_character_missing";
  if (message.includes("некорект") || message.includes("invalid")) return "main_character_invalid";
  return "main_character_failed";
}
