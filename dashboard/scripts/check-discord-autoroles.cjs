const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [
  ['shared contract routes autoroles', read('shared/index.mjs').includes('AUTOROLE: "autorole"') && read('shared/index.mjs').includes('buildAutoroleCustomId')],
  ['autorole page exists', fs.existsSync(path.join(root, 'dashboard/src/app/discord/autoroles/page.tsx'))],
  ['hub links autoroles', read('dashboard/src/app/discord/page.tsx').includes('/discord/autoroles')],
  ['shared embed editor has autorole mode', read('dashboard/src/components/DiscordEmbedEditor.tsx').includes('"autoroles"') && read('dashboard/src/components/DiscordEmbedEditor.tsx').includes('AutoroleButtonEditor')],
  ['publish route builds components', read('dashboard/src/app/api/discord/embeds/publish/route.ts').includes('buildAutoroleComponents')],
  ['message loader preserves autorole buttons', read('dashboard/src/app/api/discord/embeds/message/route.ts').includes('autoroleButtons')],
  ['interaction handles autoroles', read('dashboard/src/app/api/discord/interactions/route.ts').includes('handleAutoroleInteraction')],
  ['system access roles protected', read('dashboard/src/lib/discordAutoroles.ts').includes('assertAutoroleRolesAllowed') && read('dashboard/src/lib/discordAutoroles.ts').includes('listAccessGroups')],
  ['welcome bootstrap role protected', read('dashboard/src/lib/discordAutoroles.ts').includes('defaultRoleId')],
  ['exclusive role groups supported', read('dashboard/src/lib/discordAutoroles.ts').includes('exclusive group') && read('dashboard/src/lib/discordAutoroles.ts').includes('button.group === action.group')],
  ['duplicate Discord custom ids are rejected', read('dashboard/src/lib/discordAutoroles.ts').includes('validation.duplicates.length')],
  ['generic editor cannot erase autorole components', read('dashboard/src/app/api/discord/embeds/publish/route.ts').includes('currentAutoroleButtons.length > 0 && !isAutoroles')],
  ['autorole editor cannot overwrite rules messages', read('dashboard/src/app/api/discord/embeds/publish/route.ts').includes('currentMessage.isRules && isAutoroles')],
  ['autorole interaction exposes safe actionable errors', read('dashboard/src/lib/discordAutoroles.ts').includes('explainAutoroleInteractionError') && read('dashboard/src/app/api/discord/interactions/route.ts').includes('explainAutoroleInteractionError(error)')],
  ['autorole editor blocks roles bot cannot manage', read('dashboard/src/components/DiscordEmbedEditor.tsx').includes('role?.manageable !== false') && read('dashboard/src/components/DiscordEmbedEditor.tsx').includes('blockedReason')],
  ['autoroles expose standard role mentions', read('dashboard/src/components/DiscordEmbedEditor.tsx').includes('{!isRules && roles.length > 0 ? (') && read('dashboard/src/components/DiscordEmbedEditor.tsx').includes('isAutoroles ? \"Необовʼязкові згадки ролей')],
  ['autorole page restores mention roles when editing', read('dashboard/src/app/discord/autoroles/page.tsx').includes('selectedMentionRoleIds = message.roleIds || []') && read('dashboard/src/app/discord/autoroles/page.tsx').includes('selectedRoleIds={selectedMentionRoleIds}')],
  ['non-rules editor restores role mentions from message', read('dashboard/src/components/DiscordEmbedEditor.tsx').includes('} else if (!isRules) {') && read('dashboard/src/components/DiscordEmbedEditor.tsx').includes('setRoleIds(Array.isArray(loaded.roleIds)')],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; }
if (failed) { console.error(`[check-discord-autoroles] FAILED — ${failed}/${checks.length}`); process.exit(1); }
console.log(`[check-discord-autoroles] OK — ${checks.length}/${checks.length}`);
