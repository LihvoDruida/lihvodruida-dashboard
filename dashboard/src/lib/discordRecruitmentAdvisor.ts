import { createHash } from "node:crypto";
import {
  FieldValue,
  type QueryDocumentSnapshot,
  type Transaction,
} from "@/lib/db/firestoreCompat";
import {
  discordApi,
  fetchDiscordTextChannels,
  getDiscordGuildId,
  type DiscordTextChannel,
} from "@/lib/discordAdmin";
import {
  getFirebaseAdminDb,
  hasFirebaseProfileConfig,
} from "@/lib/firebaseAdmin";
import {
  loadStoredGuildRosterData,
  type GuildRosterMember,
  type GuildRosterRole,
} from "@/lib/guildRoster";
import { logDashboardEvent } from "@/lib/security";
import {
  getRecruitmentAdvisorSettings,
  type DiscordRecruitmentAdvisorSettings,
} from "@/lib/discordRecruitmentAdvisorSettings";
import { cleanSnowflake, timestampToIso } from "@/lib/values";

const REPLIES_COLLECTION = "discordRecruitmentAdviceReplies";
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_MAX_PAGES_PER_CHANNEL = 4;
const DEFAULT_MAX_REPLIES_PER_RUN = 4;
const DEFAULT_MAX_CHANNELS_PER_RUN = 100;
const AUTO_FOOTER = "_Повідомлення є автоматичним._";
const RECRUITMENT_RELAYABLE_MESSAGE_TYPES = new Set([0, 19]); // DEFAULT + REPLY; Discord replies must still be analyzable

type DiscordAuthor = {
  id?: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
};

export type DiscordMessage = {
  id: string;
  channel_id?: string;
  guild_id?: string;
  content?: string;
  timestamp?: string;
  author?: DiscordAuthor;
  webhook_id?: string;
  type?: number;
  source?: string;
  receivedAt?: string;
};

type DiscordChannelCandidate = Pick<
  DiscordTextChannel,
  "id" | "name" | "type" | "position" | "parent_id"
> & {
  source: "guild-channel" | "active-thread";
};

type DiscordThreadChannel = {
  id?: string;
  name?: string;
  type?: number;
  parent_id?: string | null;
  position?: number;
};

type ClassUtility = {
  className: string;
  utility: string;
  preferredSpecs: string;
  roleOptions: GuildRosterRole[];
  priority: number;
};

type WowExpansionMention = {
  key: string;
  label: string;
  order: number;
  matchedText: string;
};

type RecruitmentScenario =
  | "returning-player"
  | "new-player"
  | "class-choice"
  | "guild-need"
  | "role-choice"
  | "general-advice";

type MessageProfile = {
  isReturningPlayer: boolean;
  isNewPlayer: boolean;
  asksClassChoice: boolean;
  asksGuildNeed: boolean;
  asksHowToStart: boolean;
  mentionedClasses: string[];
  mentionedRoles: GuildRosterRole[];
  detectedExpansions: WowExpansionMention[];
  lastPlayedExpansion: WowExpansionMention | null;
  expansions: WowExpansionMention[];
  lastExpansion: WowExpansionMention | null;
  scenarios: RecruitmentScenario[];
  roleInterest: GuildRosterRole[];
  confidence: "low" | "medium" | "high";
};

type RecruitmentIntent = {
  matched: boolean;
  score: number;
  reasons: string[];
  mentionedClasses: string[];
  profile: MessageProfile;
};

type ClassRecommendation = ClassUtility & {
  activeCount: number;
  totalCount: number;
  score: number;
  reason: string;
};

type RecruitmentAdviceAnalysis = {
  rosterUpdatedAt: string | null;
  highRosterSize: number;
  totalRosterSize: number;
  rioThreshold: number;
  roleCounts: Record<GuildRosterRole, number>;
  missingClasses: string[];
  rareClasses: string[];
  recommendations: ClassRecommendation[];
  mentionedClasses: string[];
  fallbackUsed: boolean;
};

type RecruitmentAdviceResult = {
  ok: boolean;
  enabled: boolean;
  dryRun: boolean;
  channels: string[];
  scanned: number;
  matched: number;
  replied: number;
  skipped: number;
  errors: string[];
  samples: Array<{
    channelId: string;
    messageId: string;
    authorId: string;
    intentReasons: string[];
    response: string;
  }>;
};

export type RecruitmentAdviceMessageResult = {
  ok: boolean;
  enabled: boolean;
  dryRun: boolean;
  matched: boolean;
  score: number;
  replied: boolean;
  skipped: boolean;
  channelId: string;
  guildId: string;
  messageId: string;
  authorId: string;
  intentReasons: string[];
  decisionReasons: string[];
  mentionedClasses: string[];
  mentionedRoles: GuildRosterRole[];
  expansionsDetected: WowExpansionMention[];
  lastExpansion: WowExpansionMention | null;
  response?: string;
  responsePreview?: string;
  replyMessageId?: string | null;
  error?: string;
  skipReason?: string;
};

const CLASS_UTILITIES: ClassUtility[] = [
  {
    className: "Priest",
    utility: "Power Word: Fortitude, Mass Dispel, сильна рейдова підтримка",
    preferredSpecs: "Shadow для DPS або Discipline/Holy, якщо готовий хилити",
    roleOptions: ["dps", "healer"],
    priority: 100,
  },
  {
    className: "Mage",
    utility: "Arcane Intellect, Time Warp, контроль і стабільний ranged DPS",
    preferredSpecs:
      "будь-який комфортний DPS-спек; головне стабільність і виживання",
    roleOptions: ["dps"],
    priority: 96,
  },
  {
    className: "Warrior",
    utility: "Battle Shout, Rallying Cry, корисний фізичний баф",
    preferredSpecs: "Arms/Fury для DPS або Protection, якщо цікавить tank",
    roleOptions: ["dps", "tank"],
    priority: 94,
  },
  {
    className: "Druid",
    utility: "Mark of the Wild, battle ress, гнучкість ролей",
    preferredSpecs:
      "Balance/Resto найпростіше закрити рейдову потребу; Guardian/Feral за бажанням",
    roleOptions: ["dps", "healer", "tank"],
    priority: 92,
  },
  {
    className: "Monk",
    utility: "Mystic Touch і сильна мобільність",
    preferredSpecs:
      "Windwalker для DPS, Mistweaver якщо хочеш хилити, Brewmaster для tank",
    roleOptions: ["dps", "healer", "tank"],
    priority: 90,
  },
  {
    className: "Demon Hunter",
    utility: "Chaos Brand, мобільність, простий вхід у melee/tank",
    preferredSpecs: "Havoc для DPS або Vengeance для tank",
    roleOptions: ["dps", "tank"],
    priority: 88,
  },
  {
    className: "Paladin",
    utility: "Devotion Aura, Blessing-и, сильна командна сейв-утиліта",
    preferredSpecs:
      "Retribution для DPS, Holy/Protection якщо хочеш роль з дефіцитом",
    roleOptions: ["dps", "healer", "tank"],
    priority: 84,
  },
  {
    className: "Warlock",
    utility: "Healthstone, Soulstone, Demonic Gateway, стабільний ranged DPS",
    preferredSpecs:
      "Destruction/Demonology/Affliction — вибирай той, який краще відчувається",
    roleOptions: ["dps"],
    priority: 82,
  },
  {
    className: "Shaman",
    utility: "Bloodlust/Heroism, interrupt, raid/heal utility",
    preferredSpecs:
      "Elemental/Enhancement для DPS або Restoration, якщо хочеш хилити",
    roleOptions: ["dps", "healer"],
    priority: 80,
  },
  {
    className: "Evoker",
    utility:
      "Blessing of the Bronze, мобільні сейви, Augmentation/Preservation utility",
    preferredSpecs:
      "Devastation/Augmentation для DPS-support або Preservation для healer",
    roleOptions: ["dps", "healer"],
    priority: 78,
  },
  {
    className: "Hunter",
    utility: "ranged DPS, контроль, Bloodlust через pet у частині ситуацій",
    preferredSpecs:
      "Beast Mastery для легкого старту або Marksmanship, якщо хочеш чистий ranged DPS",
    roleOptions: ["dps"],
    priority: 70,
  },
  {
    className: "Death Knight",
    utility: "grip-и, Anti-Magic Zone, combat ress",
    preferredSpecs: "Unholy/Frost для DPS або Blood для tank",
    roleOptions: ["dps", "tank"],
    priority: 68,
  },
  {
    className: "Rogue",
    utility: "контроль, defensives, корисний M+ інструментарій",
    preferredSpecs:
      "Assassination/Outlaw/Subtlety — краще вибрати за комфортом",
    roleOptions: ["dps"],
    priority: 58,
  },
];

const CLASS_ALIASES: Record<string, string[]> = {
  Warlock: ["warlock", "лок", "варлок", "чк", "lock"],
  Hunter: ["hunter", "хант", "хантер", "мислив", "мисливець", "hunt", "bm", "мм"],
  Mage: ["mage", "маг", "аркан", "фаєр", "фаер", "фрост", "fire", "frost", "arcane"],
  Priest: ["priest", "прист", "жрець", "жрец", "шп", "shadow priest"],
  Warrior: ["warrior", "вар", "воїн", "воин"],
  Druid: ["druid", "дру", "друїд", "друид", "сова", "рдру", "рестор", "ферал", "ведмідь", "ведмедь"],
  Monk: ["monk", "монк", "монах", "вв", "міствівер", "brewmaster"],
  "Demon Hunter": [
    "demon hunter",
    "dh",
    "дх",
    "демон хантер",
    "хавок",
    "венга",
  ],
  Paladin: ["paladin", "пал", "паладин", "ретрик", "хпал"],
  Shaman: ["shaman", "шаман", "енх", "елем", "ршам"],
  Evoker: ["evoker", "евокер", "драктир", "ауг", "augmentation"],
  "Death Knight": ["death knight", "dk", "дк", "лицар смерті", "рыцарь смерти", "бдк"],
  Rogue: ["rogue", "рога", "розбійник", "ассасин", "аутло"],
};

const WOW_EXPANSIONS: Array<{
  key: string;
  label: string;
  order: number;
  aliases: string[];
}> = [
  { key: "vanilla", label: "Classic/Vanilla", order: 1, aliases: ["ваніла", "ванилла", "ванільний", "classic", "класік", "классик", "classic era", "era"] },
  { key: "tbc", label: "The Burning Crusade", order: 2, aliases: ["tbc", "бк", "тбк", "burning crusade", "the burning crusade", "бернінг крусейд", "аутленд"] },
  { key: "wrath", label: "Wrath of the Lich King", order: 3, aliases: ["wotlk", "wrath", "wrath of the lich king", "лич", "ліч", "лич кинг", "ліч кінг", "лк", "вотлк", "вотлік", "король лич", "король ліч"] },
  { key: "cata", label: "Cataclysm", order: 4, aliases: ["cataclysm", "cata", "ката", "катаклізм", "катаклизм", "катакла"] },
  { key: "mop", label: "Mists of Pandaria", order: 5, aliases: ["mop", "панда", "пандарія", "пандария", "місти", "мисти", "mists", "mists of pandaria"] },
  { key: "wod", label: "Warlords of Draenor", order: 6, aliases: ["wod", "вод", "дренор", "warlords", "warlords of draenor", "варлордс"] },
  { key: "legion", label: "Legion", order: 7, aliases: ["legion", "легіон", "легион", "легіона", "легионе"] },
  { key: "bfa", label: "Battle for Azeroth", order: 8, aliases: ["bfa", "бфа", "battle for azeroth", "батл фо азерот", "батл фор азерот", "битва за азерот", "battle for azeroth"] },
  { key: "shadowlands", label: "Shadowlands", order: 9, aliases: ["shadowlands", "шадовлендс", "шадоулендс", "шл", "sl", "темні землі", "темные земли"] },
  { key: "dragonflight", label: "Dragonflight", order: 10, aliases: ["dragonflight", "dragon flight", "драгонфлай", "драгонфлайт", "драконфлай", "дракони", "дф", "df"] },
  { key: "war-within", label: "The War Within", order: 11, aliases: ["the war within", "war within", "tww", "вар візін", "варвизин", "варвізін", "вар візин", "вар візін", "внутрішня війна", "внутренняя война"] },
  { key: "midnight", label: "Midnight", order: 12, aliases: ["midnight", "міднайт", "миднайт", "північ", "полночь"] },
  { key: "last-titan", label: "The Last Titan", order: 13, aliases: ["last titan", "the last titan", "останній титан", "последний титан"] },
];

const ROLE_ALIASES: Record<GuildRosterRole, string[]> = {
  tank: ["tank", "танк", "танчити", "танчить", "прот", "бдк", "guardian", "vengeance"],
  healer: ["heal", "healer", "хіл", "хил", "хілер", "хилер", "лікувати", "лікар", "рестор", "хпал", "рдру", "ршам", "дц"],
  dps: ["dps", "дпс", "дд", "damage", "демаг", "урон"],
  unknown: [],
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRecruitmentAdviceRuntimeClaims: Set<string> | undefined;
}

function cleanText(value: unknown, maxLength = 2000) {
  return Array.from(
    String(value || "")
      .normalize("NFC")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim(),
  )
    .slice(0, Math.max(0, maxLength))
    .join("");
}


function contentHash(value: unknown) {
  return createHash("sha256")
    .update(cleanText(value, 4000), "utf8")
    .digest("hex");
}

function shortPreview(value: unknown, maxLength = 500) {
  return cleanText(value, maxLength);
}
function envInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name] || "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}
function maxChannelsPerRun(settings?: DiscordRecruitmentAdvisorSettings) {
  return (
    settings?.maxChannels ||
    envInteger(
      "DISCORD_RECRUITMENT_ADVICE_MAX_CHANNELS",
      DEFAULT_MAX_CHANNELS_PER_RUN,
      1,
      200,
    )
  );
}

function normalizeChannelCandidate(
  channel: DiscordTextChannel,
  source: DiscordChannelCandidate["source"],
): DiscordChannelCandidate | null {
  const id = cleanSnowflake(channel.id);
  if (!id) return null;
  return {
    id,
    name: cleanText(channel.name || "channel", 100) || "channel",
    type: Number(channel.type || 0),
    position: Number(channel.position || 0),
    parent_id: channel.parent_id || null,
    source,
  };
}

function normalizeThreadCandidate(
  channel: DiscordThreadChannel,
): DiscordChannelCandidate | null {
  const id = cleanSnowflake(channel?.id);
  if (!id) return null;
  const type = Number(channel.type || 0);
  // Public/private/news threads. Scanning active threads lets the bot answer inside forum posts too.
  if (![10, 11, 12].includes(type)) return null;
  return {
    id,
    name: cleanText(channel.name || "thread", 100) || "thread",
    type,
    position: Number(channel.position || 0),
    parent_id: channel.parent_id ? String(channel.parent_id) : null,
    source: "active-thread",
  };
}

async function fetchActiveThreadChannels(): Promise<DiscordChannelCandidate[]> {
  const guildId = cleanSnowflake(getDiscordGuildId());
  if (!guildId) return [];
  const data = await discordApi<{ threads?: DiscordThreadChannel[] }>(
    `/guilds/${guildId}/threads/active`,
  );
  return (Array.isArray(data?.threads) ? data.threads : [])
    .map(normalizeThreadCandidate)
    .filter(Boolean) as DiscordChannelCandidate[];
}

async function recruitmentAdviceChannels(
  settings?: DiscordRecruitmentAdvisorSettings,
) {
  const snapshot = await fetchDiscordTextChannels();
  const directChannels = snapshot.channels
    .map((channel) => normalizeChannelCandidate(channel, "guild-channel"))
    .filter(Boolean) as DiscordChannelCandidate[];

  let activeThreads: DiscordChannelCandidate[] = [];
  try {
    activeThreads = await fetchActiveThreadChannels();
  } catch (error) {
    logDashboardEvent(
      "warn",
      "discord.recruitment_advice.threads_unavailable",
      undefined,
      {
        message:
          error instanceof Error ? error.message : String(error || "unknown"),
      },
    );
  }

  const byId = new Map<string, DiscordChannelCandidate>();
  for (const channel of [...directChannels, ...activeThreads]) {
    if (!byId.has(channel.id)) byId.set(channel.id, channel);
  }

  return Array.from(byId.values())
    .sort((left, right) => {
      if (left.source !== right.source)
        return left.source === "active-thread" ? -1 : 1;
      return (
        left.position - right.position ||
        left.name.localeCompare(right.name, "uk")
      );
    })
    .slice(0, maxChannelsPerRun(settings));
}

function normalizeClassName(value: unknown) {
  const raw = cleanText(value, 80).toLowerCase();
  if (!raw) return "Unknown";
  const direct = CLASS_UTILITIES.find(
    (item) => item.className.toLowerCase() === raw,
  );
  if (direct) return direct.className;
  for (const item of CLASS_UTILITIES) {
    const aliases = CLASS_ALIASES[item.className] || [];
    if (aliases.some((alias) => raw === alias.toLowerCase()))
      return item.className;
  }
  return cleanText(value, 80) || "Unknown";
}

function textForMatching(value: unknown) {
  return ` ${cleanText(value, 4000)
    .toLowerCase()
    .replace(/[’`']/g, "")
    .replace(/ё/g, "е")
    .replace(/ґ/g, "г")
    .replace(/[^a-zа-яіїє0-9+]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function containsAlias(text: string, alias: string) {
  const normalizedAlias = textForMatching(alias).trim();
  if (!normalizedAlias) return false;
  return text.includes(` ${normalizedAlias} `);
}

export function detectWowExpansionMentions(content: unknown): WowExpansionMention[] {
  const text = textForMatching(content);
  const found: WowExpansionMention[] = [];

  for (const expansion of WOW_EXPANSIONS) {
    const matched = expansion.aliases.find((alias) => containsAlias(text, alias));
    if (matched) {
      found.push({
        key: expansion.key,
        label: expansion.label,
        order: expansion.order,
        matchedText: matched,
      });
    }
  }

  // Intentional guard: "азерот" alone is not BfA, only battle/bfa context is.
  return found
    .filter((item, index, array) => array.findIndex((other) => other.key === item.key) === index)
    .sort((left, right) => left.order - right.order);
}

const detectWowExpansions = detectWowExpansionMentions;

function detectRoleInterest(content: unknown): GuildRosterRole[] {
  const text = textForMatching(content);
  const roles: GuildRosterRole[] = [];
  for (const [role, aliases] of Object.entries(ROLE_ALIASES) as Array<[GuildRosterRole, string[]]>) {
    if (role === "unknown") continue;
    if (aliases.some((alias) => containsAlias(text, alias))) roles.push(role);
  }
  return Array.from(new Set(roles));
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function buildMessageProfile(content: unknown, score: number): MessageProfile {
  const raw = cleanText(content, 4000).toLowerCase();
  const expansions = detectWowExpansions(content);
  const lastExpansion = expansions.length
    ? expansions[expansions.length - 1] || null
    : null;
  const mentionedClasses = detectMentionedClasses(cleanText(content, 4000));
  const roleInterest = detectRoleInterest(content);
  const asksHowToStart = hasAny(raw, [
    /як\s+(почати|розпочати|стартувати|повернутись|повертатись)/i,
    /з чого\s+(почати|стартувати)/i,
    /що\s+робити/i,
    /how\s+to\s+(start|return)/i,
  ]);
  const asksGuildNeed = hasAny(raw, [
    /(гільд(ії|ія|ію).{0,90}(потріб|не вистач|браку|дефіцит))/i,
    /(потріб(ен|на|ні)|не вистачає|бракує|дефіцит).{0,90}(клас|спек|роль|баф|гільд)/i,
    /(кого|що).{0,50}(треба|потрібно).{0,50}(гільд|рейд|склад)/i,
    /готов(ий|а).{0,80}(кого|клас|роль).{0,80}(не вистачає|потрібн)/i,
  ]);
  const asksClassChoice = hasAny(raw, [
    /(за який клас|який клас|кого качати|ким грати|ким краще|стартанути|обрати клас|клас краще|кого краще)/i,
    /(порад(а|ьте|ьте будь ласка).{0,90}(клас|спек|ким))/i,
  ]);
  const returning =
    hasAny(raw, [
      /(останн(ій|ього) раз|давно|не грав|повертаюсь|повернутись|вертаюсь|знову грати|returning|comeback)/i,
    ]) || Boolean(expansions.length);
  const newPlayer = hasAny(raw, [
    /(новачок|новий гравець|новий у вов|тільки починаю|перший раз|new player)/i,
  ]);
  const scenarios: RecruitmentScenario[] = [];
  if (returning) scenarios.push("returning-player");
  if (newPlayer) scenarios.push("new-player");
  if (asksClassChoice) scenarios.push("class-choice");
  if (asksGuildNeed) scenarios.push("guild-need");
  if (roleInterest.length) scenarios.push("role-choice");
  if (!scenarios.length) scenarios.push("general-advice");
  return {
    isReturningPlayer: returning,
    isNewPlayer: newPlayer,
    asksClassChoice,
    asksGuildNeed,
    asksHowToStart,
    mentionedClasses,
    mentionedRoles: roleInterest,
    detectedExpansions: expansions,
    lastPlayedExpansion: lastExpansion,
    expansions,
    lastExpansion,
    scenarios: Array.from(new Set(scenarios)),
    roleInterest,
    confidence: score >= 10 ? "high" : score >= 6 ? "medium" : "low",
  };
}

function detectMentionedClasses(content: string) {
  const normalized = textForMatching(content);
  const classes: string[] = [];
  for (const [className, aliases] of Object.entries(CLASS_ALIASES)) {
    if (aliases.some((alias) => containsAlias(normalized, alias))) {
      classes.push(className);
    }
  }
  return Array.from(new Set(classes));
}

function detectRecruitmentIntent(content: unknown): RecruitmentIntent {
  const original = cleanText(content, 4000);
  const text = original.toLowerCase();
  if (!text) {
    const emptyProfile = buildMessageProfile("", 0);
    return {
      matched: false,
      score: 0,
      reasons: [],
      mentionedClasses: [],
      profile: emptyProfile,
    };
  }

  const expansions = detectWowExpansions(original);
  const checks: Array<[RegExp, number, string]> = [
    [
      /(останн(ій|ього) раз|давно|не грав|не грав\/ла|повертаюсь|повернутись|вертаюсь|знову грати|returning|comeback)/i,
      3,
      "повернення до WoW",
    ],
    [
      /(за який клас|який клас|кого качати|ким грати|ким краще|стартанути|обрати клас|клас краще|кого краще|порад(а|ьте)|що краще)/i,
      4,
      "питання про вибір класу",
    ],
    [
      /(гільд(ії|ія|ію)|рейд|m\+|містік|міфік|mythic|ключі|склад|ростер|roster)/i,
      2,
      "контекст гільдії/рейдів",
    ],
    [
      /(не вистачає|потріб(ен|на|ні)|дефіцит|бракує|корисн(ий|а|і)|утиліті|утилита|баф|buff|корисний клас)/i,
      3,
      "питання про потреби складу",
    ],
    [
      /(як\s+(почати|розпочати|стартувати)|з чого\s+(почати|стартувати)|саме як розпочати|що\s+робити)/i,
      2,
      "питання як стартувати",
    ],
    [
      /(новачок|новий гравець|новий у вов|тільки починаю|перший раз)/i,
      2,
      "новий гравець",
    ],
    [
      /(лок|варлок|warlock|хант|хантер|hunter|мислив|маг|прист|друїд|друид|шаман|пал|дк|рога|монк|евокер|дх)/i,
      1,
      "згадані класи",
    ],
  ];

  const reasons: string[] = [];
  let score = expansions.length ? 2 : 0;
  if (expansions.length) {
    reasons.push(
      `згадана версія WoW: ${expansions
        .map((item) => `${item.label} (${item.matchedText})`)
        .join(", ")}`,
    );
  }

  for (const [regex, points, reason] of checks) {
    if (regex.test(text)) {
      score += points;
      reasons.push(reason);
    }
  }

  const mentionedClasses = detectMentionedClasses(original);
  const profile = buildMessageProfile(original, score);
  const strongClassAsk = profile.asksClassChoice || profile.asksGuildNeed;
  const context =
    profile.isReturningPlayer ||
    profile.isNewPlayer ||
    profile.asksHowToStart ||
    strongClassAsk ||
    profile.roleInterest.length > 0;

  return {
    matched: score >= 5 && (strongClassAsk || profile.asksHowToStart || profile.isNewPlayer) && context,
    score,
    reasons: Array.from(new Set(reasons)),
    mentionedClasses,
    profile,
  };
}

function percentile(values: number[], ratio: number) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)),
  );
  return sorted[index] || 0;
}

function countBy<T extends string>(values: T[]) {
  const map = new Map<T, number>();
  for (const value of values) map.set(value, (map.get(value) || 0) + 1);
  return map;
}

function activeGuildMembers(
  members: GuildRosterMember[],
  settings?: DiscordRecruitmentAdvisorSettings,
) {
  const configuredRio =
    settings?.minRio ??
    envInteger("DISCORD_RECRUITMENT_ADVICE_MIN_RIO", 0, 0, 6000);
  const configuredIlvl =
    settings?.minIlvl ??
    envInteger("DISCORD_RECRUITMENT_ADVICE_MIN_ILVL", 0, 0, 2000);
  const withRio = members.filter(
    (member) => Number(member.scores?.all || 0) > 0,
  );
  const rioThreshold =
    configuredRio ||
    Math.max(
      1000,
      Math.round(
        percentile(
          withRio.map((member) => member.scores.all),
          0.55,
        ),
      ),
    );
  const active = members.filter((member) => {
    const rio = Number(member.scores?.all || 0);
    const ilvl = Number(member.itemLevel || 0);
    return (
      (rio > 0 && rio >= rioThreshold) ||
      (configuredIlvl > 0 && ilvl >= configuredIlvl)
    );
  });

  if (active.length >= 8)
    return { members: active, rioThreshold, fallbackUsed: false };
  const fallback = withRio
    .sort(
      (left, right) =>
        Number(right.scores?.all || 0) - Number(left.scores?.all || 0),
    )
    .slice(0, Math.max(8, Math.min(40, withRio.length)));
  return {
    members: fallback.length ? fallback : members.slice(0, 40),
    rioThreshold,
    fallbackUsed: true,
  };
}

function analyzeRosterForAdvice(
  rosterMembers: GuildRosterMember[],
  mentionedClasses: string[],
  settings?: DiscordRecruitmentAdvisorSettings,
): RecruitmentAdviceAnalysis {
  const {
    members: highMembers,
    rioThreshold,
    fallbackUsed,
  } = activeGuildMembers(rosterMembers, settings);
  const normalizedMembers = highMembers.map((member) => ({
    ...member,
    className: normalizeClassName(member.className),
  }));

  const activeClassCounts = countBy(
    normalizedMembers.map((member) => member.className).filter(Boolean),
  );
  const totalClassCounts = countBy(
    rosterMembers
      .map((member) => normalizeClassName(member.className))
      .filter(Boolean),
  );
  const roleCounts: Record<GuildRosterRole, number> = {
    tank: 0,
    healer: 0,
    dps: 0,
    unknown: 0,
  };
  for (const member of normalizedMembers) {
    const role = member.role || "unknown";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }

  const classNames = CLASS_UTILITIES.map((item) => item.className);
  const missingClasses = classNames.filter(
    (className) => (activeClassCounts.get(className) || 0) === 0,
  );
  const rareClasses = classNames
    .filter(
      (className) =>
        (activeClassCounts.get(className) || 0) > 0 &&
        (activeClassCounts.get(className) || 0) <= 1,
    )
    .slice(0, 6);

  const roleDeficitBonus = (item: ClassUtility) => {
    let bonus = 0;
    const totalKnown = roleCounts.tank + roleCounts.healer + roleCounts.dps;
    const healerShare = totalKnown ? roleCounts.healer / totalKnown : 0;
    const tankShare = totalKnown ? roleCounts.tank / totalKnown : 0;
    if (item.roleOptions.includes("healer") && healerShare < 0.22) bonus += 8;
    if (item.roleOptions.includes("tank") && tankShare < 0.12) bonus += 6;
    return bonus;
  };

  const recommendations = CLASS_UTILITIES.map((item): ClassRecommendation => {
    const activeCount = activeClassCounts.get(item.className) || 0;
    const totalCount = totalClassCounts.get(item.className) || 0;
    const familiar = mentionedClasses.includes(item.className) ? 16 : 0;
    const scarcity =
      activeCount === 0
        ? 34
        : activeCount === 1
          ? 20
          : activeCount === 2
            ? 8
            : -Math.min(10, activeCount);
    const score = item.priority + scarcity + familiar + roleDeficitBonus(item);
    const reason =
      activeCount === 0
        ? `у високорівневому складі з RIO зараз немає активного ${item.className}`
        : activeCount === 1
          ? `у високорівневому складі з RIO лише 1 активний ${item.className}`
          : `клас уже є у складі, але дає корисну утиліту`;
    return { ...item, activeCount, totalCount, score, reason };
  })
    .sort(
      (left, right) =>
        right.score - left.score || left.activeCount - right.activeCount,
    )
    .slice(0, 4);

  return {
    rosterUpdatedAt: null,
    highRosterSize: normalizedMembers.length,
    totalRosterSize: rosterMembers.length,
    rioThreshold,
    roleCounts,
    missingClasses: missingClasses.slice(0, 8),
    rareClasses,
    recommendations,
    mentionedClasses,
    fallbackUsed,
  };
}

const CLASS_LABELS_UA: Record<string, string> = {
  Priest: "Прист",
  Mage: "Маг",
  Warrior: "Воїн",
  Druid: "Друїд",
  Monk: "Монк",
  "Demon Hunter": "Демон-хантер",
  Paladin: "Паладин",
  Warlock: "Лок",
  Shaman: "Шаман",
  Evoker: "Евокер",
  Hunter: "Хант",
  "Death Knight": "ДК",
  Rogue: "Рога",
};

function classLabel(className: string) {
  return CLASS_LABELS_UA[className] || className;
}

function mentionUser(authorId: string) {
  return authorId ? `<@${authorId}>` : "Привіт";
}

function roleInterestText(roles: GuildRosterRole[]) {
  const labels: Record<GuildRosterRole, string> = {
    tank: "танком",
    healer: "хілом",
    dps: "DPS",
    unknown: "будь-якою роллю",
  };
  const clean = roles.filter((role) => role !== "unknown");
  if (!clean.length) return "DPS, хіл чи танк";
  return clean.map((role) => labels[role]).join(" / ");
}

function expansionDistanceText(expansion: WowExpansionMention | null) {
  if (!expansion) return "";
  if (expansion.order <= 8) {
    return `Якщо останній раз грав у **${expansion.label}**, краще не намагатися за вечір згадати все одразу: класи, таланти й темп гри вже сильно інші.`;
  }
  if (expansion.order <= 10) {
    return `Досвід із **${expansion.label}** ще допоможе, але перед вибором мейна все одно варто спокійно перевірити таланти й роль.`;
  }
  return `Після **${expansion.label}** буде легше втягнутися, тож головне — вибрати роль і стабільного мейна.`;
}

function pickScenarioIntro(profile: MessageProfile, authorId: string) {
  const hello = `${mentionUser(authorId)}, привіт!`;
  const distance = expansionDistanceText(profile.lastExpansion);
  if (profile.isReturningPlayer) {
    return `${hello} Раді бачити повернення у WoW. ${distance || "Після перерви я б не радив одразу гнатися за найгучнішим класом тижня."} Найкращий вибір — той, на якому буде комфортно знову втягнутися, але при цьому він дасть користь гільдії.`;
  }
  if (profile.isNewPlayer) {
    return `${hello} Для нового гравця важливіше взяти зрозумілий клас і роль, а не сліпо бігти за метою. Сильний персонаж не допоможе, якщо його неприємно грати кожен день.`;
  }
  if (profile.asksGuildNeed) {
    return `${hello} Якщо дивитися саме з боку потреб гільдії, я б обирав не просто “рідкісний” клас, а той, який тобі буде реально зручно грати стабільно.`;
  }
  return `${hello} По вибору класу нормальна логіка проста: комфорт гри, користь для групи й готовність не кидати мейна через кілька днів.`;
}

function recommendationReason(item: ClassRecommendation) {
  if (item.activeCount === 0) {
    return "такий клас у нас зараз особливо корисний, бо він закриває важливу групову користь";
  }
  if (item.activeCount === 1) {
    return "таких персонажів серед активних небагато, тому ще один стабільний гравець був би корисним";
  }
  return "клас уже є у складі, але все одно дає сильну користь групі";
}

function buildStartPlan(profile: MessageProfile) {
  const parts = [
    "обери одного мейна й не розпилюйся на альтів перші тижні",
    "спокійно переглянь таланти, основні кнопки, сейви й простий opener",
  ];
  if (profile.lastExpansion && profile.lastExpansion.order <= 9) {
    parts.push("не соромся питати по базових змінах, бо після старих доповнень частина звичок уже не працює");
  }
  if (profile.roleInterest.length) {
    parts.push(`одразу напиши, що хочеш грати ${roleInterestText(profile.roleInterest)}, тоді пораду можна звузити`);
  } else {
    parts.push("уточни, чи хочеш DPS, хіла або танка, бо від цього вибір сильно змінюється");
  }
  parts.push("після прокачки підтягни екіпіровку й уже тоді дивись, куди комфортніше йти: рейди, ключі або спокійний прогрес");
  return parts;
}

function buildRecruitmentAdviceMessage(params: {
  originalMessage: DiscordMessage;
  intent: RecruitmentIntent;
  analysis: RecruitmentAdviceAnalysis;
  guildName: string;
  rosterUpdatedAt: string | null;
}) {
  const authorId = cleanSnowflake(params.originalMessage.author?.id);
  const mentioned = params.intent.mentionedClasses;
  const profile = params.intent.profile;
  const recommendations = params.analysis.recommendations.slice(0, 4);
  const familiarRecommendations = recommendations.filter((item) =>
    mentioned.includes(item.className),
  );
  const guildRecommendations = recommendations.filter(
    (item) => !mentioned.includes(item.className),
  );

  const lines = [pickScenarioIntro(profile, authorId), ""];

  if (mentioned.length) {
    const familiar = mentioned.map(classLabel).join(" і ");
    const familiarLine = familiarRecommendations.length
      ? familiarRecommendations
          .map(
            (item) =>
              `**${classLabel(item.className)}** — нормальний варіант: ${item.utility.toLowerCase()}. ${recommendationReason(item)}.`,
          )
          .join(" ")
      : `Якщо раніше тобі заходили **${familiar}**, це вже сильний аргумент: знайомий стиль гри зазвичай краще за випадковий “топ” із чужого списку.`;
    lines.push(familiarLine, "");
  }

  const mainChoices = (guildRecommendations.length
    ? guildRecommendations
    : recommendations
  ).slice(0, mentioned.length ? 3 : 4);

  if (mainChoices.length) {
    lines.push(
      `Якщо орієнтуватися на користь для **${params.guildName}**, я б подивився в бік:`,
      ...mainChoices.map(
        (item) =>
          `• **${classLabel(item.className)}** — ${item.utility.toLowerCase()}; ${item.preferredSpecs}.`,
      ),
    );
  } else {
    lines.push(
      "Якщо чесно, зараз краще обрати клас, який тобі подобається, а не намагатися вгадати ідеальний дефіцит. Стабільний гравець майже завжди цінніший за випадковий рідкісний клас.",
    );
  }

  const easyChoices = [
    mentioned.includes("Hunter") ? "Хант" : null,
    mentioned.includes("Warlock") ? "Лок" : null,
  ].filter(Boolean);
  if (easyChoices.length) {
    lines.push(
      "",
      `Для максимально спокійного повернення ${easyChoices.join(" або ")} — нормальний вибір. Хант простіший для старту, Лок дуже корисний у рейдах через камені, портал і стабільний ranged DPS.`,
    );
  }

  if (profile.roleInterest.length) {
    lines.push(
      "",
      `Ти згадав роль **${roleInterestText(profile.roleInterest)}** — це важливо. Під цю роль краще підбирати клас точніше, бо поради для DPS, хіла й танка різні.`,
    );
  }

  const startPlan = buildStartPlan(profile);
  lines.push(
    "",
    `Найкращий старт: ${startPlan
      .map((item, index) => `${index + 1}) ${item}`)
      .join("; ")}.`,
    "",
    profile.asksGuildNeed
      ? "Якщо хочеш закрити саме потребу гільдії — напиши, яка роль тобі цікава, і тоді можна буде порадити вже без гадання."
      : "Напиши, яка роль тобі цікава — DPS, хіл чи танк — і підкажемо точніше.",
    "",
    AUTO_FOOTER,
  );

  return cleanText(lines.filter(Boolean).join("\n"), 1950);
}

async function loadRosterAnalysis(
  mentionedClasses: string[],
  settings?: DiscordRecruitmentAdvisorSettings,
) {
  const roster = await loadStoredGuildRosterData({ bypassCache: false });
  const analysis = analyzeRosterForAdvice(
    roster.members || [],
    mentionedClasses,
    settings,
  );
  return {
    guildName: roster.stats.guildName || "Mistblossom Vanguard",
    rosterUpdatedAt: roster.stats.updatedAt || null,
    analysis: {
      ...analysis,
      rosterUpdatedAt: roster.stats.updatedAt || null,
    },
  };
}

async function fetchRecentChannelMessages(
  channelId: string,
  cutoffMs: number,
  maxPages: number,
) {
  const messages: DiscordMessage[] = [];
  let before = "";

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const pageMessages = await discordApi<DiscordMessage[]>(
      `/channels/${channelId}/messages?${query.toString()}`,
    );
    if (!Array.isArray(pageMessages) || !pageMessages.length) break;

    messages.push(...pageMessages);
    before = String(pageMessages[pageMessages.length - 1]?.id || "");

    const oldestTimestamp = Date.parse(
      String(pageMessages[pageMessages.length - 1]?.timestamp || ""),
    );
    if (Number.isFinite(oldestTimestamp) && oldestTimestamp < cutoffMs) break;
  }

  return messages.filter((message) => {
    const createdAt = Date.parse(String(message.timestamp || ""));
    return Number.isFinite(createdAt) && createdAt >= cutoffMs;
  });
}

function runtimeClaims() {
  const set =
    globalThis.__mistblossomRecruitmentAdviceRuntimeClaims || new Set<string>();
  globalThis.__mistblossomRecruitmentAdviceRuntimeClaims = set;
  return set;
}

function isAlreadyExistsError(error: unknown) {
  const message = String(
    (error as Error)?.message || error || "",
  ).toLowerCase();
  const code = String((error as { code?: unknown })?.code || "").toLowerCase();
  return (
    code === "6" ||
    code === "already-exists" ||
    message.includes("already exists") ||
    message.includes("already_exists")
  );
}

type RecruitmentClaimResult = {
  claimed: boolean;
  reason: string;
  existingStatus?: string | null;
};

async function tryClaimMessage(
  message: DiscordMessage,
  channelId: string,
  options: { force?: boolean } = {},
): Promise<RecruitmentClaimResult> {
  const messageId = cleanSnowflake(message.id);
  if (!messageId) return { claimed: false, reason: "missing_message_id" };

  if (!hasFirebaseProfileConfig()) {
    const set = runtimeClaims();
    if (set.has(messageId) && !options.force)
      return { claimed: false, reason: "runtime_already_claimed" };
    set.add(messageId);
    return {
      claimed: true,
      reason: options.force ? "runtime_forced" : "runtime_created",
    };
  }

  const ref = getFirebaseAdminDb()
    .collection(REPLIES_COLLECTION)
    .doc(messageId);
  try {
    return await getFirebaseAdminDb().runTransaction(async (transaction: Transaction) => {
      const snapshot = await transaction.get(ref);
      const basePatch = {
        messageId,
        channelId,
        guildId: cleanSnowflake(message.guild_id) || null,
        authorId: cleanSnowflake(message.author?.id) || null,
        contentHash: contentHash(message.content),
        status: "processing",
        source: message.source || "gateway-message-create",
        updatedAtIso: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
        sourceTimestamp: cleanText(message.timestamp, 80) || null,
        receivedAt: cleanText(message.receivedAt, 80) || null,
      };

      if (!snapshot.exists) {
        transaction.create(ref, {
          ...basePatch,
          createdAtIso: new Date().toISOString(),
          createdAt: FieldValue.serverTimestamp(),
          retryCount: 0,
        });
        return { claimed: true, reason: "created" };
      }

      const data = snapshot.data() || {};
      const status = typeof data.status === "string" ? data.status : null;
      const hasReply = Boolean(data.replyMessageId || status === "replied");
      if (hasReply) {
        return {
          claimed: false,
          reason: "already_replied",
          existingStatus: status,
        };
      }
      if (!options.force && status === "processing") {
        return {
          claimed: false,
          reason: "existing_processing",
          existingStatus: status,
        };
      }
      if (!options.force && status && !["failed", "skipped", "no_content", "dashboard_error", "discord_send_error"].includes(status)) {
        return {
          claimed: false,
          reason: `existing_${status}`,
          existingStatus: status,
        };
      }

      transaction.set(
        ref,
        {
          ...basePatch,
          previousStatus: status,
          retryCount: FieldValue.increment(status ? 1 : 0),
          forcedAtIso: options.force ? new Date().toISOString() : null,
          forcedAt: options.force ? FieldValue.serverTimestamp() : null,
        },
        { merge: true },
      );
      return {
        claimed: true,
        reason: options.force ? "forced_retry" : "retryable_status",
        existingStatus: status,
      };
    });
  } catch (error) {
    if (isAlreadyExistsError(error))
      return { claimed: false, reason: "already_exists" };
    logDashboardEvent(
      "warn",
      "discord.recruitment_advice.claim_failed",
      undefined,
      {
        channelId,
        messageId,
        error:
          error instanceof Error ? error.message : String(error || "unknown"),
      },
    );
    const set = runtimeClaims();
    if (set.has(messageId) && !options.force)
      return { claimed: false, reason: "runtime_after_claim_failed" };
    set.add(messageId);
    return { claimed: true, reason: "runtime_after_claim_failed" };
  }
}

async function markClaimResult(
  messageId: string,
  patch: Record<string, unknown>,
) {
  if (!hasFirebaseProfileConfig() || !cleanSnowflake(messageId)) return;
  await getFirebaseAdminDb()
    .collection(REPLIES_COLLECTION)
    .doc(messageId)
    .set(
      {
        ...patch,
        updatedAtIso: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => null);
}

async function replyToDiscordMessage(
  channelId: string,
  message: DiscordMessage,
  content: string,
) {
  const messageId = cleanSnowflake(message.id);
  const authorId = cleanSnowflake(message.author?.id);
  const payload: Record<string, unknown> = {
    content,
    allowed_mentions: {
      parse: [],
      users: authorId ? [authorId] : [],
      replied_user: Boolean(authorId),
    },
  };

  if (messageId) {
    payload.message_reference = {
      channel_id: channelId,
      message_id: messageId,
      fail_if_not_exists: false,
    };
  }

  return discordApi<DiscordMessage>(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

type IgnoreMessageDecision = { ignored: boolean; reason?: string };

function shouldIgnoreMessage(message: DiscordMessage): IgnoreMessageDecision {
  if (!cleanSnowflake(message.id)) return { ignored: true, reason: "missing_message_id" };
  if (message.author?.bot) return { ignored: true, reason: "author_bot" };
  if (message.webhook_id) return { ignored: true, reason: "webhook_message" };
  if (message.type !== undefined) {
    const messageType = Number(message.type);
    if (!RECRUITMENT_RELAYABLE_MESSAGE_TYPES.has(messageType)) {
      return { ignored: true, reason: `unsupported_message_type_${messageType}` };
    }
  }
  if (typeof message.content !== "string" || !cleanText(message.content, 4000)) {
    return { ignored: true, reason: "empty_content_message_content_intent_or_permission" };
  }
  return { ignored: false };
}

function baseDecisionFields(intent?: RecruitmentIntent) {
  const profile = intent?.profile;
  return {
    score: intent?.score || 0,
    intentReasons: intent?.reasons || [],
    decisionReasons: intent?.reasons || [],
    mentionedClasses: intent?.mentionedClasses || [],
    mentionedRoles: profile?.roleInterest || [],
    expansionsDetected: profile?.expansions || [],
    lastExpansion: profile?.lastExpansion || null,
  };
}

async function recordMessageDecision(
  message: DiscordMessage,
  patch: Record<string, unknown>,
) {
  const messageId = cleanSnowflake(message.id);
  if (!messageId) return;
  await markClaimResult(messageId, {
    messageId,
    channelId: cleanSnowflake(message.channel_id) || null,
    guildId: cleanSnowflake(message.guild_id) || null,
    authorId: cleanSnowflake(message.author?.id) || null,
    contentHash: contentHash(message.content),
    sourceTimestamp: cleanText(message.timestamp, 80) || null,
    receivedAt: cleanText(message.receivedAt, 80) || null,
    source: message.source || "gateway-message-create",
    ...patch,
  });
}

export async function handleDiscordRecruitmentAdviceMessage(
  message: DiscordMessage,
  options: {
    dryRun?: boolean;
    force?: boolean;
    channelId?: string;
  } = {},
): Promise<RecruitmentAdviceMessageResult> {
  const settings = await getRecruitmentAdvisorSettings({
    bypassCache: Boolean(options.force),
  });
  const enabled = settings.enabled || Boolean(options.force);
  const dryRun = Boolean(options.dryRun || settings.dryRun);
  const channelId =
    cleanSnowflake(message.channel_id) || cleanSnowflake(options.channelId);
  const guildId = cleanSnowflake(message.guild_id);
  const messageId = cleanSnowflake(message.id);
  const authorId = cleanSnowflake(message.author?.id);
  const base: RecruitmentAdviceMessageResult = {
    ok: true,
    enabled,
    dryRun,
    matched: false,
    score: 0,
    replied: false,
    skipped: false,
    channelId,
    guildId,
    messageId,
    authorId,
    intentReasons: [],
    decisionReasons: [],
    mentionedClasses: [],
    mentionedRoles: [],
    expansionsDetected: [],
    lastExpansion: null,
  };

  if (!enabled) {
    const result = {
      ...base,
      skipped: true,
      skipReason: "disabled_by_settings",
    };
    if (!dryRun) {
      await recordMessageDecision({ ...message, channel_id: channelId }, {
        status: "skipped",
        matched: false,
        score: 0,
        skipReason: result.skipReason,
        decisionReasons: ["система вимкнена в налаштуваннях"],
      });
    }
    return result;
  }

  if (!channelId) {
    return {
      ...base,
      ok: false,
      skipped: true,
      error: "Discord message channel_id is missing",
      skipReason: "missing_channel_id",
    };
  }

  const ignore = shouldIgnoreMessage(message);
  if (ignore.ignored) {
    const result = {
      ...base,
      skipped: true,
      skipReason: ignore.reason || "ignored_message",
    };
    if (!dryRun && messageId) {
      await recordMessageDecision({ ...message, channel_id: channelId }, {
        status: result.skipReason === "empty_content_message_content_intent_or_permission" ? "no_content" : "skipped",
        matched: false,
        score: 0,
        skipReason: result.skipReason,
        decisionReasons: [result.skipReason],
      });
    }
    return result;
  }

  const intent = detectRecruitmentIntent(message.content);
  const decision = baseDecisionFields(intent);
  if (!intent.matched) {
    const result = {
      ...base,
      ...decision,
      skipped: true,
      skipReason: "intent_not_matched",
    };
    if (!dryRun) {
      await recordMessageDecision({ ...message, channel_id: channelId }, {
        status: "skipped",
        matched: false,
        score: intent.score,
        skipReason: result.skipReason,
        decisionReasons: intent.reasons,
        mentionedClasses: intent.mentionedClasses,
        mentionedRoles: intent.profile.roleInterest,
        expansionsDetected: intent.profile.expansions,
        lastExpansion: intent.profile.lastExpansion,
      });
    }
    return result;
  }

  if (!dryRun) {
    const claim = await tryClaimMessage(
      { ...message, channel_id: channelId, guild_id: guildId },
      channelId,
      { force: options.force },
    );
    if (!claim.claimed) {
      return {
        ...base,
        ...decision,
        matched: true,
        skipped: true,
        skipReason: claim.reason === "already_replied" ? "already_replied" : claim.reason,
      };
    }
  }

  try {
    const roster = await loadRosterAnalysis(intent.mentionedClasses, settings);
    const response = buildRecruitmentAdviceMessage({
      originalMessage: { ...message, channel_id: channelId, guild_id: guildId },
      intent,
      analysis: roster.analysis,
      guildName: roster.guildName,
      rosterUpdatedAt: roster.rosterUpdatedAt,
    });

    if (dryRun) {
      return {
        ...base,
        ...decision,
        matched: true,
        response,
        responsePreview: shortPreview(response, 600),
      };
    }

    const reply = await replyToDiscordMessage(
      channelId,
      { ...message, channel_id: channelId, guild_id: guildId },
      response,
    );
    const replyMessageId = cleanSnowflake(reply?.id) || null;
    await recordMessageDecision(
      { ...message, channel_id: channelId, guild_id: guildId },
      {
        status: "replied",
        matched: true,
        score: intent.score,
        skipReason: null,
        decisionReasons: intent.reasons,
        mentionedClasses: intent.mentionedClasses,
        mentionedRoles: intent.profile.roleInterest,
        expansionsDetected: intent.profile.expansions,
        lastExpansion: intent.profile.lastExpansion,
        responsePreview: shortPreview(response, 600),
        repliedAtIso: new Date().toISOString(),
        replyMessageId,
      },
    );

    return {
      ...base,
      ...decision,
      matched: true,
      replied: true,
      response,
      responsePreview: shortPreview(response, 600),
      replyMessageId,
    };
  } catch (error) {
    const errorText =
      error instanceof Error ? error.message : String(error || "unknown");
    if (!dryRun) {
      await recordMessageDecision(
        { ...message, channel_id: channelId, guild_id: guildId },
        {
          status: /Discord API/i.test(errorText) ? "discord_send_error" : "failed",
          matched: true,
          score: intent.score,
          skipReason: null,
          decisionReasons: intent.reasons,
          mentionedClasses: intent.mentionedClasses,
          mentionedRoles: intent.profile.roleInterest,
          expansionsDetected: intent.profile.expansions,
          lastExpansion: intent.profile.lastExpansion,
          error: errorText.slice(0, 500),
        },
      );
    }
    return {
      ...base,
      ...decision,
      ok: false,
      matched: true,
      error: errorText,
    };
  }
}

export async function scanDiscordRecruitmentAdvice(
  options: {
    dryRun?: boolean;
    force?: boolean;
    limit?: number;
  } = {},
): Promise<RecruitmentAdviceResult> {
  const settings = await getRecruitmentAdvisorSettings({
    bypassCache: Boolean(options.force),
  });
  const enabled = settings.enabled || Boolean(options.force);
  const dryRun = Boolean(options.dryRun || settings.dryRun);
  const result: RecruitmentAdviceResult = {
    ok: true,
    enabled,
    dryRun,
    channels: [],
    scanned: 0,
    matched: 0,
    replied: 0,
    skipped: 0,
    errors: [],
    samples: [],
  };

  if (!enabled) {
    result.ok = false;
    result.errors.push("DISCORD_RECRUITMENT_ADVICE_ENABLED is not enabled");
    return result;
  }

  let channels: DiscordChannelCandidate[] = [];
  try {
    channels = await recruitmentAdviceChannels(settings);
    result.channels = channels.map((channel) => channel.id);
  } catch (error) {
    result.ok = false;
    result.errors.push(
      `Discord channels discovery failed: ${error instanceof Error ? error.message : String(error || "unknown")}`,
    );
    return result;
  }

  if (!channels.length) {
    result.ok = false;
    result.errors.push(
      "No readable Discord text channels found for recruitment advice scan",
    );
    return result;
  }

  const lookbackHours = settings.lookbackHours || DEFAULT_LOOKBACK_HOURS;
  const maxPages = settings.maxPages || DEFAULT_MAX_PAGES_PER_CHANNEL;
  const maxReplies = Math.max(
    1,
    Math.min(
      Number(
        options.limit ||
          settings.manualScanLimit ||
          DEFAULT_MAX_REPLIES_PER_RUN,
      ),
      settings.maxReplies || DEFAULT_MAX_REPLIES_PER_RUN,
    ),
  );
  const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;

  for (const channel of channels) {
    const channelId = channel.id;
    let messages: DiscordMessage[] = [];
    try {
      messages = await fetchRecentChannelMessages(
        channelId,
        cutoffMs,
        maxPages,
      );
    } catch (error) {
      result.errors.push(
        `channel ${channel.name} (${channelId}): ${error instanceof Error ? error.message : String(error || "unknown")}`,
      );
      continue;
    }

    // Reply oldest-first so a first launch over the last 2 days feels natural.
    messages.sort(
      (left, right) =>
        Date.parse(String(left.timestamp || "")) -
        Date.parse(String(right.timestamp || "")),
    );

    for (const message of messages) {
      result.scanned += 1;
      if (result.replied >= maxReplies) {
        result.skipped += 1;
        continue;
      }
      if (shouldIgnoreMessage(message).ignored) {
        result.skipped += 1;
        continue;
      }

      const handled = await handleDiscordRecruitmentAdviceMessage(
        { ...message, channel_id: cleanSnowflake(message.channel_id) || channelId },
        { dryRun, force: options.force, channelId },
      );

      if (handled.matched) result.matched += 1;
      if (handled.skipped) result.skipped += 1;
      if (handled.replied) result.replied += 1;
      if (handled.response) {
        result.samples.push({
          channelId: handled.channelId || channelId,
          messageId: handled.messageId || message.id,
          authorId: handled.authorId,
          intentReasons: handled.intentReasons,
          response: handled.response,
        });
      }
      if (!handled.ok && handled.error) {
        result.errors.push(`message ${message.id}: ${handled.error}`);
      }
    }
  }

  result.ok =
    result.scanned > 0 ||
    result.replied > 0 ||
    result.samples.length > 0 ||
    result.errors.length === 0;
  return result;
}

export type RecruitmentAdviceEntry = {
  messageId: string;
  channelId: string | null;
  guildId: string | null;
  authorId: string | null;
  status: string;
  matched: boolean;
  score: number;
  skipReason: string | null;
  decisionReasons: string[];
  responsePreview: string | null;
  replyMessageId: string | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
function stringList(value: unknown, limit = 8) {
  if (!Array.isArray(value)) return [] as string[];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

export async function listRecentRecruitmentAdviceEntries(
  limit = 20,
): Promise<RecruitmentAdviceEntry[]> {
  if (!hasFirebaseProfileConfig()) return [];
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 20)));
  const snapshot = await getFirebaseAdminDb()
    .collection(REPLIES_COLLECTION)
    .orderBy("updatedAt", "desc")
    .limit(safeLimit)
    .get()
    .catch(() => null);
  if (!snapshot) return [];
  return snapshot.docs.map((doc: QueryDocumentSnapshot) => {
    const data = doc.data() || {};
    return {
      messageId: String(data.messageId || doc.id || ""),
      channelId: typeof data.channelId === "string" ? data.channelId : null,
      guildId: typeof data.guildId === "string" ? data.guildId : null,
      authorId: typeof data.authorId === "string" ? data.authorId : null,
      status: typeof data.status === "string" ? data.status : "unknown",
      matched: Boolean(data.matched),
      score: Number.isFinite(Number(data.score)) ? Number(data.score) : 0,
      skipReason: typeof data.skipReason === "string" ? data.skipReason : null,
      decisionReasons: stringList(data.decisionReasons),
      responsePreview:
        typeof data.responsePreview === "string" ? data.responsePreview : null,
      replyMessageId:
        typeof data.replyMessageId === "string" ? data.replyMessageId : null,
      error: typeof data.error === "string" ? data.error : null,
      createdAt: timestampToIso(data.createdAt) || timestampToIso(data.createdAtIso),
      updatedAt: timestampToIso(data.updatedAt) || timestampToIso(data.updatedAtIso),
    };
  });
}

export function previewRecruitmentAdviceForText(
  content: string,
  authorId = "",
) {
  const message: DiscordMessage = {
    id: "0",
    channel_id: "0",
    content,
    timestamp: new Date().toISOString(),
    author: { id: authorId },
    type: 0,
  };
  const intent = detectRecruitmentIntent(content);
  return {
    intent,
    async build() {
      const settings = await getRecruitmentAdvisorSettings();
      const roster = await loadRosterAnalysis(
        intent.mentionedClasses,
        settings,
      );
      return buildRecruitmentAdviceMessage({
        originalMessage: message,
        intent,
        analysis: roster.analysis,
        guildName: roster.guildName,
        rosterUpdatedAt: roster.rosterUpdatedAt,
      });
    },
  };
}
