import { FieldValue } from "firebase-admin/firestore";
import { discordApi, fetchDiscordTextChannels, getDiscordGuildId, type DiscordTextChannel } from "@/lib/discordAdmin";
import { getFirebaseAdminDb, hasFirebaseProfileConfig } from "@/lib/firebaseAdmin";
import { loadStoredGuildRosterData, type GuildRosterMember, type GuildRosterRole } from "@/lib/guildRoster";
import { logDashboardEvent } from "@/lib/security";

const REPLIES_COLLECTION = "discordRecruitmentAdviceReplies";
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_MAX_PAGES_PER_CHANNEL = 4;
const DEFAULT_MAX_REPLIES_PER_RUN = 4;
const DEFAULT_MAX_CHANNELS_PER_RUN = 100;
const AUTO_FOOTER = "_Повідомлення є автоматичним._";

type DiscordAuthor = {
  id?: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
};

type DiscordMessage = {
  id: string;
  channel_id?: string;
  content?: string;
  timestamp?: string;
  author?: DiscordAuthor;
  webhook_id?: string;
  type?: number;
};

type DiscordChannelCandidate = Pick<DiscordTextChannel, "id" | "name" | "type" | "position" | "parent_id"> & {
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

type RecruitmentIntent = {
  matched: boolean;
  score: number;
  reasons: string[];
  mentionedClasses: string[];
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

const CLASS_UTILITIES: ClassUtility[] = [
  { className: "Priest", utility: "Power Word: Fortitude, Mass Dispel, сильна рейдова підтримка", preferredSpecs: "Shadow для DPS або Discipline/Holy, якщо готовий хилити", roleOptions: ["dps", "healer"], priority: 100 },
  { className: "Mage", utility: "Arcane Intellect, Time Warp, контроль і стабільний ranged DPS", preferredSpecs: "будь-який комфортний DPS-спек; головне стабільність і виживання", roleOptions: ["dps"], priority: 96 },
  { className: "Warrior", utility: "Battle Shout, Rallying Cry, корисний фізичний баф", preferredSpecs: "Arms/Fury для DPS або Protection, якщо цікавить tank", roleOptions: ["dps", "tank"], priority: 94 },
  { className: "Druid", utility: "Mark of the Wild, battle ress, гнучкість ролей", preferredSpecs: "Balance/Resto найпростіше закрити рейдову потребу; Guardian/Feral за бажанням", roleOptions: ["dps", "healer", "tank"], priority: 92 },
  { className: "Monk", utility: "Mystic Touch і сильна мобільність", preferredSpecs: "Windwalker для DPS, Mistweaver якщо хочеш хилити, Brewmaster для tank", roleOptions: ["dps", "healer", "tank"], priority: 90 },
  { className: "Demon Hunter", utility: "Chaos Brand, мобільність, простий вхід у melee/tank", preferredSpecs: "Havoc для DPS або Vengeance для tank", roleOptions: ["dps", "tank"], priority: 88 },
  { className: "Paladin", utility: "Devotion Aura, Blessing-и, сильна командна сейв-утиліта", preferredSpecs: "Retribution для DPS, Holy/Protection якщо хочеш роль з дефіцитом", roleOptions: ["dps", "healer", "tank"], priority: 84 },
  { className: "Warlock", utility: "Healthstone, Soulstone, Demonic Gateway, стабільний ranged DPS", preferredSpecs: "Destruction/Demonology/Affliction — вибирай той, який краще відчувається", roleOptions: ["dps"], priority: 82 },
  { className: "Shaman", utility: "Bloodlust/Heroism, interrupt, raid/heal utility", preferredSpecs: "Elemental/Enhancement для DPS або Restoration, якщо хочеш хилити", roleOptions: ["dps", "healer"], priority: 80 },
  { className: "Evoker", utility: "Blessing of the Bronze, мобільні сейви, Augmentation/Preservation utility", preferredSpecs: "Devastation/Augmentation для DPS-support або Preservation для healer", roleOptions: ["dps", "healer"], priority: 78 },
  { className: "Hunter", utility: "ranged DPS, контроль, Bloodlust через pet у частині ситуацій", preferredSpecs: "Beast Mastery для легкого старту або Marksmanship, якщо хочеш чистий ranged DPS", roleOptions: ["dps"], priority: 70 },
  { className: "Death Knight", utility: "grip-и, Anti-Magic Zone, combat ress", preferredSpecs: "Unholy/Frost для DPS або Blood для tank", roleOptions: ["dps", "tank"], priority: 68 },
  { className: "Rogue", utility: "контроль, defensives, корисний M+ інструментарій", preferredSpecs: "Assassination/Outlaw/Subtlety — краще вибрати за комфортом", roleOptions: ["dps"], priority: 58 },
];

const CLASS_ALIASES: Record<string, string[]> = {
  "Warlock": ["warlock", "лок", "варлок", "чк", "lock"],
  "Hunter": ["hunter", "хант", "мислив", "hunt", "bm", "мм"],
  "Mage": ["mage", "маг", "аркан", "фаєр", "фрост"],
  "Priest": ["priest", "прист", "жрець", "шп", "shadow priest"],
  "Warrior": ["warrior", "вар", "воїн"],
  "Druid": ["druid", "дру", "друїд", "сова", "рестор", "ферал", "ведмідь"],
  "Monk": ["monk", "монк", "монах", "вв", "міствівер", "brewmaster"],
  "Demon Hunter": ["demon hunter", "dh", "дх", "демон хантер", "хавок", "венга"],
  "Paladin": ["paladin", "пал", "паладин", "ретрик", "хпал"],
  "Shaman": ["shaman", "шаман", "енх", "елем", "ршам"],
  "Evoker": ["evoker", "евокер", "драктир", "ауг", "augmentation"],
  "Death Knight": ["death knight", "dk", "дк", "лицар смерті"],
  "Rogue": ["rogue", "рога", "розбійник", "ассасин", "аутло"],
};

declare global {
  // eslint-disable-next-line no-var
  var __mistblossomRecruitmentAdviceRuntimeClaims: Set<string> | undefined;
}

function cleanText(value: unknown, maxLength = 2000) {
  return Array.from(String(value || "")
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim())
    .slice(0, Math.max(0, maxLength))
    .join("");
}

function envFlag(name: string, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function envInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name] || "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function snowflake(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{16,25}$/.test(text) ? text : "";
}

function maxChannelsPerRun() {
  return envInteger("DISCORD_RECRUITMENT_ADVICE_MAX_CHANNELS", DEFAULT_MAX_CHANNELS_PER_RUN, 1, 200);
}

function normalizeChannelCandidate(channel: DiscordTextChannel, source: DiscordChannelCandidate["source"]): DiscordChannelCandidate | null {
  const id = snowflake(channel.id);
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

function normalizeThreadCandidate(channel: DiscordThreadChannel): DiscordChannelCandidate | null {
  const id = snowflake(channel?.id);
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
  const guildId = snowflake(getDiscordGuildId());
  if (!guildId) return [];
  const data = await discordApi<{ threads?: DiscordThreadChannel[] }>(`/guilds/${guildId}/threads/active`);
  return (Array.isArray(data?.threads) ? data.threads : [])
    .map(normalizeThreadCandidate)
    .filter(Boolean) as DiscordChannelCandidate[];
}

async function recruitmentAdviceChannels() {
  const snapshot = await fetchDiscordTextChannels();
  const directChannels = snapshot.channels
    .map((channel) => normalizeChannelCandidate(channel, "guild-channel"))
    .filter(Boolean) as DiscordChannelCandidate[];

  let activeThreads: DiscordChannelCandidate[] = [];
  try {
    activeThreads = await fetchActiveThreadChannels();
  } catch (error) {
    logDashboardEvent("warn", "discord.recruitment_advice.threads_unavailable", undefined, {
      message: error instanceof Error ? error.message : String(error || "unknown"),
    });
  }

  const byId = new Map<string, DiscordChannelCandidate>();
  for (const channel of [...directChannels, ...activeThreads]) {
    if (!byId.has(channel.id)) byId.set(channel.id, channel);
  }

  return Array.from(byId.values())
    .sort((left, right) => {
      if (left.source !== right.source) return left.source === "active-thread" ? -1 : 1;
      return left.position - right.position || left.name.localeCompare(right.name, "uk");
    })
    .slice(0, maxChannelsPerRun());
}

function normalizeClassName(value: unknown) {
  const raw = cleanText(value, 80).toLowerCase();
  if (!raw) return "Unknown";
  const direct = CLASS_UTILITIES.find((item) => item.className.toLowerCase() === raw);
  if (direct) return direct.className;
  for (const item of CLASS_UTILITIES) {
    const aliases = CLASS_ALIASES[item.className] || [];
    if (aliases.some((alias) => raw === alias.toLowerCase())) return item.className;
  }
  return cleanText(value, 80) || "Unknown";
}

function detectMentionedClasses(content: string) {
  const normalized = ` ${content.toLowerCase().replace(/[\n,.;:!?()[\]{}]/g, " ")} `;
  const classes: string[] = [];
  for (const [className, aliases] of Object.entries(CLASS_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(` ${alias.toLowerCase()} `))) {
      classes.push(className);
    }
  }
  return Array.from(new Set(classes));
}

function detectRecruitmentIntent(content: unknown): RecruitmentIntent {
  const text = cleanText(content, 4000).toLowerCase();
  if (!text) return { matched: false, score: 0, reasons: [], mentionedClasses: [] };

  const checks: Array<[RegExp, number, string]> = [
    [/(останн(ій|ього) раз|давно|не грав|повертаюсь|повернутись|знову грати|returning|comeback)/i, 3, "повернення до WoW"],
    [/(battle for azeroth|bfa|батл фо азерот|бфа|легіон|shadowlands|dragonflight|war within|midnight)/i, 2, "згадана стара/попередня експансія"],
    [/(за який клас|який клас|кого качати|ким грати|обрати клас|клас краще|порад(а|ьте)|що краще)/i, 4, "питання про вибір класу"],
    [/(гільд(ії|ія|ію)|рейд|m\+|містік|rio|raider|ключі|склад)/i, 2, "контекст гільдії/рейдів/RIO"],
    [/(не вистачає|потріб(ен|на|ні)|дефіцит|бракує|корисн(ий|а|і)|utility|баф|buff)/i, 3, "питання про потреби складу"],
    [/(лок|варлок|warlock|хант|hunter|мислив)/i, 1, "згадані попередні класи"],
  ];

  const reasons: string[] = [];
  let score = 0;
  for (const [regex, points, reason] of checks) {
    if (regex.test(text)) {
      score += points;
      reasons.push(reason);
    }
  }

  const mentionedClasses = detectMentionedClasses(text);
  return {
    matched: score >= 6 && reasons.some((reason) => reason.includes("клас")) && reasons.some((reason) => reason.includes("повер") || reason.includes("потреб") || reason.includes("гільдії")),
    score,
    reasons,
    mentionedClasses,
  };
}

function numberFormat(value: number, digits = 0) {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

function percentile(values: number[], ratio: number) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] || 0;
}

function countBy<T extends string>(values: T[]) {
  const map = new Map<T, number>();
  for (const value of values) map.set(value, (map.get(value) || 0) + 1);
  return map;
}

function topMapEntries(map: Map<string, number>, limit: number) {
  return Array.from(map.entries())
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], "uk"))
    .slice(0, limit)
    .map(([name, count]) => `${name} (${count})`);
}

function activeGuildMembers(members: GuildRosterMember[]) {
  const configuredRio = envInteger("DISCORD_RECRUITMENT_ADVICE_MIN_RIO", 0, 0, 6000);
  const configuredIlvl = envInteger("DISCORD_RECRUITMENT_ADVICE_MIN_ILVL", 0, 0, 2000);
  const withRio = members.filter((member) => Number(member.scores?.all || 0) > 0);
  const rioThreshold = configuredRio || Math.max(1000, Math.round(percentile(withRio.map((member) => member.scores.all), 0.55)));
  const active = members.filter((member) => {
    const rio = Number(member.scores?.all || 0);
    const ilvl = Number(member.itemLevel || 0);
    return (rio > 0 && rio >= rioThreshold) || (configuredIlvl > 0 && ilvl >= configuredIlvl);
  });

  if (active.length >= 8) return { members: active, rioThreshold, fallbackUsed: false };
  const fallback = withRio
    .sort((left, right) => Number(right.scores?.all || 0) - Number(left.scores?.all || 0))
    .slice(0, Math.max(8, Math.min(40, withRio.length)));
  return { members: fallback.length ? fallback : members.slice(0, 40), rioThreshold, fallbackUsed: true };
}

function analyzeRosterForAdvice(rosterMembers: GuildRosterMember[], mentionedClasses: string[]): RecruitmentAdviceAnalysis {
  const { members: highMembers, rioThreshold, fallbackUsed } = activeGuildMembers(rosterMembers);
  const normalizedMembers = highMembers.map((member) => ({
    ...member,
    className: normalizeClassName(member.className),
  }));

  const activeClassCounts = countBy(normalizedMembers.map((member) => member.className).filter(Boolean));
  const totalClassCounts = countBy(rosterMembers.map((member) => normalizeClassName(member.className)).filter(Boolean));
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
  const missingClasses = classNames.filter((className) => (activeClassCounts.get(className) || 0) === 0);
  const rareClasses = classNames
    .filter((className) => (activeClassCounts.get(className) || 0) > 0 && (activeClassCounts.get(className) || 0) <= 1)
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

  const recommendations = CLASS_UTILITIES
    .map((item): ClassRecommendation => {
      const activeCount = activeClassCounts.get(item.className) || 0;
      const totalCount = totalClassCounts.get(item.className) || 0;
      const familiar = mentionedClasses.includes(item.className) ? 16 : 0;
      const scarcity = activeCount === 0 ? 34 : activeCount === 1 ? 20 : activeCount === 2 ? 8 : -Math.min(10, activeCount);
      const score = item.priority + scarcity + familiar + roleDeficitBonus(item);
      const reason = activeCount === 0
        ? `у високорівневому складі з RIO зараз немає активного ${item.className}`
        : activeCount === 1
          ? `у високорівневому складі з RIO лише 1 активний ${item.className}`
          : `клас уже є у складі, але дає корисну утиліту`;
      return { ...item, activeCount, totalCount, score, reason };
    })
    .sort((left, right) => right.score - left.score || left.activeCount - right.activeCount)
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

function mentionUser(authorId: string) {
  return authorId ? `<@${authorId}>` : "Привіт";
}

function buildRoleLine(roleCounts: Record<GuildRosterRole, number>) {
  const known = roleCounts.tank + roleCounts.healer + roleCounts.dps;
  if (!known) return "ролі в складі ще не визначені достатньо точно";
  return `tank ${roleCounts.tank}, healer ${roleCounts.healer}, DPS ${roleCounts.dps}`;
}

function buildRecruitmentAdviceMessage(params: {
  originalMessage: DiscordMessage;
  intent: RecruitmentIntent;
  analysis: RecruitmentAdviceAnalysis;
  guildName: string;
  rosterUpdatedAt: string | null;
}) {
  const authorId = snowflake(params.originalMessage.author?.id);
  const mentioned = params.intent.mentionedClasses;
  const recommendations = params.analysis.recommendations.slice(0, 3);
  const top = recommendations[0];
  const familiar = mentioned.filter((className) => ["Warlock", "Hunter"].includes(className));

  const lines = [
    `${mentionUser(authorId)}, привіт! Раді бачити повернення у WoW. Якщо останній активний досвід був ще в BfA, я б не радив одразу гнатися за “топ-метою”: краще вибрати клас, який реально зайде, і паралельно закрити корисну потребу гільдії.`,
    "",
    `**Що показує склад ${params.guildName}:** проаналізовано ${numberFormat(params.analysis.highRosterSize)} високорівневих персонажів з Raider.IO${params.analysis.rioThreshold ? ` (орієнтир RIO ≈ ${numberFormat(params.analysis.rioThreshold)}` : ""}${params.analysis.rioThreshold ? ")" : ""}. Ролі: ${buildRoleLine(params.analysis.roleCounts)}.`,
    params.analysis.missingClasses.length
      ? `**Найпомітніші прогалини по корисних бафах/утиліті:** ${params.analysis.missingClasses.slice(0, 5).join(", ")}.`
      : params.analysis.rareClasses.length
        ? `**Найрідші корисні класи серед активних:** ${params.analysis.rareClasses.join(", ")}.`
        : "**Склад виглядає рівномірно**, тому можна обирати не за дефіцитом, а за комфортом і стабільністю гри.",
    "",
    top
      ? `**Найрозумніший вибір під гільдію зараз:** **${top.className}** — ${top.reason}; дає: ${top.utility}. Рекомендований старт: ${top.preferredSpecs}.`
      : "**Найрозумніший вибір:** будь-який клас, який ти готовий стабільно грати, бо даних складу поки замало для чесного дефіциту.",
  ];

  if (recommendations.length > 1) {
    lines.push(
      `**Альтернативи:** ${recommendations.slice(1).map((item) => `**${item.className}** (${item.utility})`).join("; ")}.`,
    );
  }

  if (familiar.length) {
    const familiarText = familiar.map((className) => {
      const item = CLASS_UTILITIES.find((utility) => utility.className === className);
      const rec = params.analysis.recommendations.find((recommendation) => recommendation.className === className);
      const scarcity = rec?.activeCount === 0 ? "у нас це ще й дефіцитний клас" : rec?.activeCount === 1 ? "у нас його мало серед активних з RIO" : "клас уже є, але він усе одно корисний";
      return `**${className}** — ${scarcity}; ${item?.utility || "корисна raid/M+ utility"}`;
    });
    lines.push("", `З того, чим ти вже грав: ${familiarText.join(". ")}. Тобто **Warlock/Hunter не є поганим вибором**, але якщо хочеш максимально допомогти складу — дивись першу рекомендацію вище.`);
  }

  lines.push(
    "",
    "**Як краще стартувати:** обери 1 мейн на перші тижні, прокачай його без розпилення на альтів, зайди в профіль гільдії/сайт, привʼяжи персонажа Battle.net і після цього вже дивись по рейдах/M+. Якщо хочеш швидко потрапити в активності — пиши, яку роль готовий грати: DPS, healer чи tank.",
    "",
    "Це не жорсткий наказ по класу. Для гільдії найцінніше — стабільний гравець, який не міняє мейна кожні 3 дні й реально закриває механіки.",
    "",
    AUTO_FOOTER,
  );

  return cleanText(lines.filter(Boolean).join("\n"), 1950);
}

async function loadRosterAnalysis(mentionedClasses: string[]) {
  const roster = await loadStoredGuildRosterData({ bypassCache: false });
  const analysis = analyzeRosterForAdvice(roster.members || [], mentionedClasses);
  return {
    guildName: roster.stats.guildName || "Mistblossom Vanguard",
    rosterUpdatedAt: roster.stats.updatedAt || null,
    analysis: {
      ...analysis,
      rosterUpdatedAt: roster.stats.updatedAt || null,
    },
  };
}

async function fetchRecentChannelMessages(channelId: string, cutoffMs: number, maxPages: number) {
  const messages: DiscordMessage[] = [];
  let before = "";

  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const pageMessages = await discordApi<DiscordMessage[]>(`/channels/${channelId}/messages?${query.toString()}`);
    if (!Array.isArray(pageMessages) || !pageMessages.length) break;

    messages.push(...pageMessages);
    before = String(pageMessages[pageMessages.length - 1]?.id || "");

    const oldestTimestamp = Date.parse(String(pageMessages[pageMessages.length - 1]?.timestamp || ""));
    if (Number.isFinite(oldestTimestamp) && oldestTimestamp < cutoffMs) break;
  }

  return messages.filter((message) => {
    const createdAt = Date.parse(String(message.timestamp || ""));
    return Number.isFinite(createdAt) && createdAt >= cutoffMs;
  });
}

function runtimeClaims() {
  const set = globalThis.__mistblossomRecruitmentAdviceRuntimeClaims || new Set<string>();
  globalThis.__mistblossomRecruitmentAdviceRuntimeClaims = set;
  return set;
}

function isAlreadyExistsError(error: unknown) {
  const message = String((error as Error)?.message || error || "").toLowerCase();
  const code = String((error as { code?: unknown })?.code || "").toLowerCase();
  return code === "6" || code === "already-exists" || message.includes("already exists") || message.includes("already_exists");
}

async function tryClaimMessage(message: DiscordMessage, channelId: string) {
  const messageId = snowflake(message.id);
  if (!messageId) return false;

  if (!hasFirebaseProfileConfig()) {
    const set = runtimeClaims();
    if (set.has(messageId)) return false;
    set.add(messageId);
    return true;
  }

  const ref = getFirebaseAdminDb().collection(REPLIES_COLLECTION).doc(messageId);
  try {
    await ref.create({
      messageId,
      channelId,
      authorId: snowflake(message.author?.id) || null,
      status: "processing",
      createdAtIso: new Date().toISOString(),
      createdAt: FieldValue.serverTimestamp(),
      sourceTimestamp: cleanText(message.timestamp, 80) || null,
    });
    return true;
  } catch (error) {
    if (isAlreadyExistsError(error)) return false;
    logDashboardEvent("warn", "discord.recruitment_advice.claim_failed", undefined, {
      channelId,
      messageId,
      error: error instanceof Error ? error.message : String(error || "unknown"),
    });
    const set = runtimeClaims();
    if (set.has(messageId)) return false;
    set.add(messageId);
    return true;
  }
}

async function markClaimResult(messageId: string, patch: Record<string, unknown>) {
  if (!hasFirebaseProfileConfig() || !snowflake(messageId)) return;
  await getFirebaseAdminDb().collection(REPLIES_COLLECTION).doc(messageId).set({
    ...patch,
    updatedAtIso: new Date().toISOString(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => null);
}

async function replyToDiscordMessage(channelId: string, message: DiscordMessage, content: string) {
  const messageId = snowflake(message.id);
  const authorId = snowflake(message.author?.id);
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

function shouldIgnoreMessage(message: DiscordMessage) {
  if (!snowflake(message.id)) return true;
  if (message.author?.bot || message.webhook_id) return true;
  if (typeof message.content !== "string" || !cleanText(message.content, 4000)) return true;
  // 0 = default, 19/20/21 can also contain user-visible content, but for this helper
  // we only answer normal channel messages to avoid replying to system/crosspost noise.
  if (message.type !== undefined && Number(message.type) !== 0) return true;
  return false;
}

export async function scanDiscordRecruitmentAdvice(options: {
  dryRun?: boolean;
  force?: boolean;
  limit?: number;
} = {}): Promise<RecruitmentAdviceResult> {
  const enabled = envFlag("DISCORD_RECRUITMENT_ADVICE_ENABLED", false) || Boolean(options.force);
  const dryRun = Boolean(options.dryRun || envFlag("DISCORD_RECRUITMENT_ADVICE_DRY_RUN", false));
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
    channels = await recruitmentAdviceChannels();
    result.channels = channels.map((channel) => channel.id);
  } catch (error) {
    result.ok = false;
    result.errors.push(`Discord channels discovery failed: ${error instanceof Error ? error.message : String(error || "unknown")}`);
    return result;
  }

  if (!channels.length) {
    result.ok = false;
    result.errors.push("No readable Discord text channels found for recruitment advice scan");
    return result;
  }

  const lookbackHours = envInteger("DISCORD_RECRUITMENT_ADVICE_LOOKBACK_HOURS", DEFAULT_LOOKBACK_HOURS, 1, 168);
  const maxPages = envInteger("DISCORD_RECRUITMENT_ADVICE_MAX_PAGES", DEFAULT_MAX_PAGES_PER_CHANNEL, 1, 20);
  const maxReplies = Math.max(1, Math.min(Number(options.limit || DEFAULT_MAX_REPLIES_PER_RUN), envInteger("DISCORD_RECRUITMENT_ADVICE_MAX_REPLIES", DEFAULT_MAX_REPLIES_PER_RUN, 1, 20)));
  const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;

  for (const channel of channels) {
    const channelId = channel.id;
    let messages: DiscordMessage[] = [];
    try {
      messages = await fetchRecentChannelMessages(channelId, cutoffMs, maxPages);
    } catch (error) {
      result.errors.push(`channel ${channel.name} (${channelId}): ${error instanceof Error ? error.message : String(error || "unknown")}`);
      continue;
    }

    // Reply oldest-first so a first launch over the last 2 days feels natural.
    messages.sort((left, right) => Date.parse(String(left.timestamp || "")) - Date.parse(String(right.timestamp || "")));

    for (const message of messages) {
      result.scanned += 1;
      if (result.replied >= maxReplies) {
        result.skipped += 1;
        continue;
      }
      if (shouldIgnoreMessage(message)) {
        result.skipped += 1;
        continue;
      }

      const intent = detectRecruitmentIntent(message.content);
      if (!intent.matched) {
        result.skipped += 1;
        continue;
      }

      result.matched += 1;

      if (!dryRun) {
        const claimed = await tryClaimMessage(message, channelId);
        if (!claimed) {
          result.skipped += 1;
          continue;
        }
      }

      try {
        const roster = await loadRosterAnalysis(intent.mentionedClasses);
        const response = buildRecruitmentAdviceMessage({
          originalMessage: message,
          intent,
          analysis: roster.analysis,
          guildName: roster.guildName,
          rosterUpdatedAt: roster.rosterUpdatedAt,
        });

        result.samples.push({
          channelId,
          messageId: message.id,
          authorId: snowflake(message.author?.id),
          intentReasons: intent.reasons,
          response,
        });

        if (!dryRun) {
          const replyChannelId = snowflake(message.channel_id) || channelId;
          const reply = await replyToDiscordMessage(replyChannelId, message, response);
          await markClaimResult(message.id, {
            status: "replied",
            repliedAtIso: new Date().toISOString(),
            replyMessageId: snowflake(reply?.id) || null,
            intentReasons: intent.reasons,
            mentionedClasses: intent.mentionedClasses,
          });
          result.replied += 1;
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error || "unknown");
        result.errors.push(`message ${message.id}: ${messageText}`);
        if (!dryRun) {
          await markClaimResult(message.id, {
            status: "failed",
            error: messageText.slice(0, 500),
          });
        }
      }
    }
  }

  result.ok = result.scanned > 0 || result.replied > 0 || result.samples.length > 0 || result.errors.length === 0;
  return result;
}

export function previewRecruitmentAdviceForText(content: string, authorId = "") {
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
      const roster = await loadRosterAnalysis(intent.mentionedClasses);
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
