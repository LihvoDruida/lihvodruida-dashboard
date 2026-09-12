const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const page = read("src/app/rules/accept/page.tsx");
const complete = read("src/app/api/rules/accept/complete/route.ts");
const nickname = read("src/app/api/profile/nickname-characters/route.ts");
const enhancer = read("src/components/RulesChoiceEnhancer.tsx");
const css = read("src/app/styles/onboarding.css");
const pageState = read("src/lib/pageState.ts");

const checks = [
  ["authenticated profile remains available without a rules role token", page.includes(") : profile ? (") && page.includes("Профіль доступний, але роль правил не привʼязана")],
  ["personal Discord token cannot be completed by a different logged-in user", complete.includes("discord_identity_mismatch") && complete.includes("tokenDiscordUserId !== profile.providerUserId")],
  ["token guild is verified against configured Discord guild", complete.includes("discord_guild_mismatch") && complete.includes("parsedToken.discordGuildId !== configuredGuildId")],
  ["deleted/stale Discord roles get a preflight check", complete.includes("rules.onboarding.role_missing") && complete.includes("discord_role_missing")],
  ["Discord membership is preflighted without blocking profile editing", page.includes("lookupDiscordMember") && page.includes("targetDiscordMemberMissing") && page.includes("Профіль можна редагувати")],
  ["real Discord nickname and owner lock are bound into the profile editor", page.includes("currentServerNickname={authenticatedDiscordMember?.nick || null}") && page.includes("discordOwnerLocked={discordOwnerLocked}") && page.includes("fetchDiscordGuildSnapshot")],
  ["Discord member lookup distinguishes missing member from transient API failure", complete.includes("Discord API 404|Unknown Member|10007") && complete.includes("throw error")],
  ["nickname alt selection is rejected server-side above the limit", nickname.includes("selectedKeys.length > 2") && nickname.includes("profile_nickname_characters_too_many")],
  ["choice enhancer enforces the two-alt client limit", enhancer.includes("data-rules-nickname-form") && enhancer.includes("input.disabled = atLimit && !input.checked")],
  ["radio choices only enable save for a changed selection", enhancer.includes('submit.disabled = !value || !dirty')],
  ["mobile and desktop choice-card layouts exist", css.includes(".profile-raid-role-option") && css.includes("@media (max-width: 760px)") && css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))")],
  ["rules accept has purpose-specific loading copy instead of generic Firebase copy", pageState.includes('pathname.startsWith("/rules/accept")') && pageState.includes("звіряємо Discord і привʼязки")],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [name] of failed) console.error(`[check-rules-accept:error] ${name}`);
  process.exit(1);
}

console.log(`[check-rules-accept] OK — ${checks.length} onboarding/identity/interaction invariants checked.`);
