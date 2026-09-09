export declare const CUSTOM_ID_NAMESPACE: "mbv1";
export declare const CUSTOM_ID_MAX_LENGTH: 100;
export declare const RAID_POLL_ACTION_PREFIX: string;

export type RaidPollDiscordVoteKind =
  | "vote_prompt"
  | "character_prompt"
  | "schedule"
  | "schedule_page"
  | "quick"
  | "role"
  | "submit";

export declare const RAID_POLL_PROMPT_KINDS: readonly string[];

export declare function decodeRaidPollCustomId(
  customId: string,
  values?: unknown,
): { pollId: string; kind: RaidPollDiscordVoteKind; group: string; values: string[] } | null;

export declare function isRaidPollPromptKind(kind: unknown): boolean;

export declare const RAID_CUSTOM_ID_PATTERNS: Readonly<{
  attendance: RegExp;
  characterSelect: RegExp;
  characterSelectLegacy: RegExp;
  roleSelect: RegExp;
  roleSelectLegacy: RegExp;
  manualClass: RegExp;
  manualSpec: RegExp;
  signupSubmit: RegExp;
}>;

export declare const ROSTER_CUSTOM_ID_PATTERN: RegExp;
export declare const RULES_CUSTOM_ID_PATTERN: RegExp;

export declare const INTERACTION_DOMAINS: Readonly<{
  RAID_POLL: "raid-poll";
  RAID: "raid";
  ROSTER: "roster";
  RULES: "rules";
  APPLICATION: "application";
}>;

export declare function interactionDomainFor(customId: string): string | null;

export declare function validateInteractionComponents(
  rows: unknown,
): { ok: boolean; duplicates: string[]; tooLong: string[]; rows: number };
