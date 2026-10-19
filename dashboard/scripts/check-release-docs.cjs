const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(p,'utf8');
function duplicateEnv(text){const seen=new Set(),duplicates=[];for(const line of text.split(/\r?\n/)){const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);if(!m)continue;if(seen.has(m[1]))duplicates.push(m[1]);seen.add(m[1]);}return duplicates;}
function unknownScripts(text,scripts){return [...text.matchAll(/npm\s+run\s+([a-zA-Z0-9:_-]+)/g)].map(m=>m[1]).filter(name=>!scripts.has(name));}
const manifest=JSON.parse(read(path.join(root,'release-manifest.json')));
const dashboard=JSON.parse(read(path.join(root,'dashboard/package.json'))),bot=JSON.parse(read(path.join(root,'bot/package.json')));
assert.equal(dashboard.version,manifest.dashboard);assert.equal(bot.version,manifest.bot);
const scripts=new Set([...Object.keys(dashboard.scripts),...Object.keys(bot.scripts),...manifest.siteScripts]);
for(const file of ['.env.example','dashboard/.env.example','bot/.env.example']){assert.deepEqual(duplicateEnv(read(path.join(root,file))),[],file+' has duplicate keys');assert.ok(!/FIREBASE_|Firebase/i.test(read(path.join(root,file))),file+' has obsolete storage configuration');}
for(const file of ['README.md','dashboard/README.md','docs/DEPLOYMENT.md','docs/CONFIGURATION.md','docs/DATABASE.md','docs/OPERATIONS.md','docs/RELEASE_INSTALL_2026-10-19_UA.md']){const text=read(path.join(root,file));assert.deepEqual(unknownScripts(text,scripts),[],file+' references an unknown npm command');}
const install=read(path.join(root,'docs/RELEASE_INSTALL_2026-10-19_UA.md'));
for(const version of [manifest.dashboard,manifest.site,manifest.bot])assert.ok(install.includes(version),'missing release version '+version);
const site=path.resolve(root,'../lihvodruida-site');if(fs.existsSync(path.join(site,'package.json'))){const pkg=JSON.parse(read(path.join(site,'package.json')));assert.equal(pkg.version,manifest.site);assert.deepEqual(Object.keys(pkg.scripts).sort(),manifest.siteScripts.slice().sort());assert.equal(read(path.join(site,'RELEASE_INSTALL_2026-10-19_UA.md')),install);assert.deepEqual(duplicateEnv(read(path.join(site,'.env.example'))),[]);assert.deepEqual(unknownScripts(read(path.join(site,'README.md')),scripts),[]);}
// Verify both error detectors, so an accidental always-green check cannot pass.
assert.deepEqual(duplicateEnv('TOKEN=one\n# TOKEN=ignored\nTOKEN=two'),['TOKEN']);
assert.deepEqual(unknownScripts('npm run missing:command',scripts),['missing:command']);
console.log('[check-release-docs] PASS: versions, env duplicates, current npm commands and canonical paired instructions');
