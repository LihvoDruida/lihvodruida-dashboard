// WoW Forever: edition model, best-effort Battle.net sync, Retail-only integrations stay Retail-only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const load = require("./lib/load-server-ts.cjs");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const edition = load("src/lib/wowEdition.ts").exports;
const battlenet = read("src/lib/battlenet.ts");
const profiles = read("src/lib/profiles.ts");
const raids = read("src/lib/raids.ts");
const card = read("src/components/ProfileCharactersLiveSection.tsx");
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log("PASS", name); };

check("edition: explicit field or reserved realm marks Forever, everything else is Retail", () => {
  assert.equal(edition.characterEdition({ edition: "forever" }), "forever");
  assert.equal(edition.characterEdition({ realmSlug: "forever" }), "forever");
  assert.equal(edition.characterEdition({ realmSlug: "terokkar" }), "retail");
  assert.equal(edition.characterEdition(null), "retail");
  assert.equal(edition.WOW_EDITION_LABEL.forever, "Forever");
});
check("sync reads Forever from its own namespace and the realm-less character path", () => {
  assert.match(battlenet, /profile-forever-\$\{region\}/);
  assert.match(battlenet, /\/profile\/wow\/character\/\$\{encodeURIComponent\(slug\)\}/);
  assert.match(battlenet, /realmSlug: FOREVER_REALM_SLUG/);
  assert.match(battlenet, /edition: "forever"/);
});
check("every Forever call is best-effort and can be switched off", () => {
  assert.match(battlenet, /namespace, retries: 0 \}\)\.catch\(\(\) => null\)/);
  assert.match(battlenet, /fetchBattleNetForeverCharacters\(accessToken, region\)\.catch\(\(\) => \[\]\)/);
  assert.match(battlenet, /envFlag\("BATTLENET_FOREVER_ENABLED", true\)/);
});
check("Forever is never treated as the Retail guild", () => {
  const block = battlenet.slice(battlenet.indexOf("function foreverCandidate"), battlenet.indexOf("async function fetchBattleNetForeverCharacters"));
  assert.match(block, /verifiedGuild: false/); assert.match(block, /guildStatus: null/);
});
check("profiles keep the edition and skip Raider.IO for Forever", () => {
  assert.match(profiles, /edition: characterEdition\(\{ edition: item\.edition, realmSlug \}\)/);
  assert.match(profiles, /isForeverCharacter\(current\) \? Promise\.resolve\(null\) : fetchRaiderIoCharacterProfile/);
});
check("Retail raid signups never offer Forever characters", () => {
  assert.match(raids, /\.filter\(\(\{ character \}\) => !isForeverCharacter\(character\)\)/);
});
check("character cards label the edition and link the Forever Armory without Raider.IO", () => {
  assert.match(card, /WOW_EDITION_LABEL\[edition\]/); assert.match(card, /"Armory Forever"/);
  assert.match(card, /const rioUrl = forever \? null/);
});
console.log(`[check-wow-forever] OK — ${passed}/${passed}`);
