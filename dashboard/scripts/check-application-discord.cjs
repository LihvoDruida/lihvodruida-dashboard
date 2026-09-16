const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const shared = read("../shared/index.mjs");
const discord = read("src/lib/discord.ts");
const interactions = read("src/app/api/discord/interactions/route.ts");
const moderation = read("src/lib/moderation.ts");

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(shared.includes("decodeApplicationCustomId"), "shared contract must decode application custom_id");
check(shared.includes('`${CUSTOM_ID_NAMESPACE}:application:`'), "application domain prefix must be registered");
check(shared.includes("guild_application:(accepted|declined)"), "legacy application custom_id must stay supported");
check(discord.includes('label: "Прийняти"'), "new application must include accept button");
check(discord.includes('label: "Відхилити"'), "new application must include decline button");
check(discord.includes("buildApplicationModerationComponents(params.issueNumber)"), "new application payload must attach moderation components");
check(interactions.includes("decodeApplicationCustomId"), "interaction route must decode application buttons");
check(interactions.includes('permissions.includes("applications.manage")'), "Discord moderation must enforce applications.manage permission");
check(interactions.includes("requireReview: true"), "Discord moderation must reject re-moderating completed applications");
check(moderation.includes('params.requireReview && previousStatus !== "review"'), "moderation core must protect finalized applications");
check(discord.includes("components: []"), "finalized Discord application message must remove buttons");
check(discord.includes("Модератор:"), "finalized Discord application message must show moderator");

if (failures.length) {
  console.error("Application Discord regression checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Application Discord regression checks passed (12/12).");
