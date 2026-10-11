const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const load = require('./load-server-ts.cjs');

// Compile the whole production profiles/catalog modules. Auth permission,
// normalizers, canonical reads and PostgreSQL are real; external APIs throw.
module.exports = function subject(pool, store, groups, mode = 'postgres') {
  function dependencies(entry) {
    const source = ts.createSourceFile(entry, fs.readFileSync(path.resolve(__dirname, '../..', entry), 'utf8'), ts.ScriptTarget.Latest, true);
    const deps = {};
    for (const node of source.statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
      const name = node.moduleSpecifier.text;
      if (name.startsWith('node:')) continue;
      deps[name] = new Proxy({}, { get(_object, key) { return () => { throw Error('Unexpected dependency ' + name + '.' + String(key)); }; } });
    }
    return deps;
  }
  const firebase = { getFirebaseAdminDb: () => store, hasFirebaseProfileConfig: () => mode !== 'unconfigured', documentStoreMode: () => mode };
  const values = load('src/lib/values.ts').exports;
  const compat = load('src/lib/db/documentStore.ts', { '@/lib/db/pgPool': pool }).exports;
  const resilience = { resilientRead: (_key, read) => read(), resilientWrite: (_key, write) => write(), clearRuntimeCachedValue() {}, clearRuntimeCachedValuesByPrefix() {} };
  const access = { listAccessGroups: async () => typeof groups === 'function' ? groups() : groups };
  const permissions = load('src/lib/permissions.ts', { '@/lib/accessGroupSchema': { DASHBOARD_PERMISSION_KEYS: [] } }).exports;
  const guildPolicy = load('src/lib/guildNicknamePolicy.ts', { '@/lib/db/firestoreCompat': compat, '@/lib/firebaseAdmin': firebase, '@/lib/runtimeResilience': resilience, '@/lib/firebaseAccess': { firebaseWrite: (_key, _type, write) => write() }, '@/lib/values': values }).exports;
  const raidProgress = load('src/lib/characterRaidProgress.ts').exports;
  const canonical = load('src/lib/characterDataStore.ts', { '@/lib/db/firestoreCompat': compat, '@/lib/firebaseAdmin': firebase, '@/lib/runtimeResilience': resilience, '@/lib/characterRaidProgress': raidProgress }).exports;
  const deps = { ...dependencies('src/lib/profiles.ts'), crypto: require('node:crypto'), '@/lib/db/firestoreCompat': compat, '@/lib/firebaseAdmin': firebase,
    '@/lib/values': values, '@/lib/permissions': permissions, '@/lib/accessGroups': access, '@/lib/guildNicknamePolicy': guildPolicy,
    '@/lib/wowCharacters': load('src/lib/wowCharacters.ts', { crypto: require('node:crypto') }).exports,
    '@/lib/wowRoles': load('src/lib/wowRoles.ts').exports,
    '@/lib/characterDataStore': canonical, '@/lib/characterRaidProgress': raidProgress,
    '@/lib/runtimeResilience': resilience,
  };
  const profiles = load('src/lib/profiles.ts', deps).exports;
  const directory = load('src/lib/profileDirectory.ts', {
    '@/lib/profiles': profiles, '@/lib/permissions': permissions, '@/lib/accessGroups': access,
    '@/lib/firebaseAdmin': firebase, '@/lib/db/firestoreCompat': compat, '@/lib/db/pgPool': pool,
  }).exports;
  return { ...directory, normalizers: profiles };
};
