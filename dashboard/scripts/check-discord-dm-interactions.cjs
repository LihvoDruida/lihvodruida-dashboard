const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const route = fs.readFileSync(path.join(root, "src/app/api/discord/interactions/route.ts"), "utf8");
const onboarding = fs.readFileSync(path.join(root, "src/lib/discordNewcomerOnboarding.ts"), "utf8");

const checks = [
  [route.includes("const rulesAction = nicknameFixAction ? null : decodeRulesCustomId(customId);"), "rules action is decoded before guild gate"],
  [route.includes("const dmSafePersonalAction = Boolean(nicknameFixAction || rulesAction);"), "only personal nickname/rules domains are DM-safe"],
  [route.includes("!interactionGuildId || interactionGuildId === configuredGuildId"), "DM may omit guild_id while channel interaction must match configured guild"],
  [route.includes("const guildId = interactionGuildId || configuredGuildId;"), "DM rules resolve the configured guild explicitly"],
  [route.includes("rulesDmAction: Boolean(rulesAction)"), "guild rejection log records DM-safe rules classification"],
  [onboarding.includes("sendDiscordDirectMessage") && onboarding.includes("buildRulesAcceptCustomId"), "newcomer rules button is intentionally delivered via DM"],
  [route.includes("const raidAction =") && route.includes("const pollAction =") && route.includes("const rosterAction ="), "server-bound interaction domains remain separately decoded"],
  [route.includes("return ephemeral(\"⛔ Ця взаємодія не належить Discord-серверу Mistblossom Vanguard.\")"), "guild mismatch remains rejected"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`✓ ${label}`);
  else { failed += 1; console.error(`✗ ${label}`); }
}
if (failed) {
  console.error(`[check-discord-dm-interactions] FAILED — ${failed}/${checks.length}`);
  process.exit(1);
}
console.log(`[check-discord-dm-interactions] OK — ${checks.length}/${checks.length} DM interaction safety invariants checked.`);
