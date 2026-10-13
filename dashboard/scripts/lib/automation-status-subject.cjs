const load = require('./load-server-ts.cjs');
const values = load('src/lib/values.ts').exports;
const base = {
  '@/lib/automationLease': {}, '@/lib/firebaseAccess': {}, '@/lib/firebaseAdmin': {},
  '@/lib/runtimeResilience': {}, '@/lib/values': values,
};
const policy = load('src/lib/guildNicknamePolicy.ts', { ...base, '@/lib/db/firestoreCompat': {} }).exports;
const accounts = load('src/lib/accountCleanupAutomation.ts', base).exports;
const nicknames = load('src/lib/discordNicknameWarnings.ts', { ...base,
  '@/lib/concurrency': {}, '@/lib/discordAdmin': {}, '@/lib/guildNicknamePolicy': policy,
  '@/lib/profiles': {}, '@/lib/security': {}, '@/lib/discordNewcomerState': {},
  '@/lib/discordMemberManagement': {}, '@mistblossom/discord-contract': {},
}).exports;
const cleanupPolicy = load('src/lib/discordCleanupPolicy.ts').exports;
const status = load('src/lib/automationStatus.ts', { '@/lib/values': values, '@/lib/discordCleanupPolicy': cleanupPolicy }).exports;
module.exports = { policy, accounts, nicknames, status, loadOverview(db, guild, globals = {}, configured = true) {
  return load('src/lib/automationOverview.ts', {
    '@/lib/firebaseAdmin': { getFirebaseAdminDb: () => db, hasFirebaseProfileConfig: () => configured },
    '@/lib/discordAdmin': { getDiscordGuildId: () => guild },
    '@/lib/guildNicknamePolicy': policy, '@/lib/accountCleanupAutomation': accounts,
    '@/lib/discordNicknameWarnings': nicknames, '@/lib/automationStatus': status,
  }, globals).exports.getAutomationOverview;
} };
