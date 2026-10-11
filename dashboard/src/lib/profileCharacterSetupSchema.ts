import type { WowCharacterRole } from "@/lib/wowRoles";

export type CharacterSetupChoice = {
  key: string;
  name: string;
  realm: string;
  className: string;
  spec: string;
  role: WowCharacterRole;
  guild: boolean;
};
export type CharacterSetupRequest = {
  operationId: string;
  expectedRevision: string;
  characterKeys: string[];
  mainCharacterKey: string;
  raidRole: "auto" | WowCharacterRole;
};
export type CharacterSetupReceipt = {
  operationId: string;
  revision: string;
  addedKeys: string[];
  duplicateKeys: string[];
  mainCharacterKey: string;
  raidRole: "auto" | WowCharacterRole;
};
export type CharacterSetupState = {
  revision: string;
  characters: CharacterSetupChoice[];
  candidates: CharacterSetupChoice[];
  expiresAt: string | null;
  mainCharacterKey: string;
  raidRole: "auto" | WowCharacterRole;
  receipt: CharacterSetupReceipt | null;
};
