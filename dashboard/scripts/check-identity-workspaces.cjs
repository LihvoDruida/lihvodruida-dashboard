"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const load = require("./lib/load-server-ts.cjs");
const root = path.resolve(__dirname, "..");
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }
const read = file => fs.readFileSync(path.join(root, file), "utf8");
function renderer(overrides = {}) {
  const cache = new Map();
  function component(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute);
    const output = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: absolute }).outputText;
    const mod = { exports: {} }; cache.set(absolute, mod.exports);
    const resolve = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === "react" || name === "react/jsx-runtime") return require(name);
      if (name === "next/link") return { __esModule: true, default: ({ children, prefetch, ...props }) => React.createElement("a", props, children) };
      if (name === "next/navigation") return { useRouter: () => ({ refresh() {}, push() {} }) };
      if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (name === "@/components/ProfileAvatar") return { __esModule: true, default: ({ fallbackClassName, ...props }) => React.createElement("img", { ...props, alt: "" }) };
      if (name === "@/components/ClientErrorReporter") return { sendClientErrorReport() {} };
      if (name.startsWith("@/components/") || name.startsWith(".")) {
        const base = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(absolute), name);
        const target = [base, base + ".tsx", base + ".ts"].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!target) throw Error("Missing UI dependency " + name);
        return component(path.relative(root, target));
      }
      throw Error("Unexpected UI dependency " + name);
    };
    new Function("require", "module", "exports", output)(resolve, mod, mod.exports);
    cache.set(absolute, mod.exports); return mod.exports;
  }
  return { component, html: (file, props) => renderToStaticMarkup(React.createElement(component(file).default, props)) };
}
const stop = prefix => value => { throw Error(prefix + (value || "")); };
const profile = { profileId: "own", provider: "discord", providerUserId: "123456789012345678", role: "member", displayName: "Учасник", characters: [], battlenet: { linked: true } };
let viewer = { id: profile.providerUserId, provider: "discord", profileId: "own", role: "member", permissions: ["dashboard.view"] };
let profileReads = 0, raidReads = 0, raidsFail = false, viewAllowed = true;
const profileMethods = {
  getProfileById: async () => { profileReads++; return profile; },
  canViewProfile: () => viewAllowed,
  getMainCharacter: () => null,
  getProfilePublicName: value => value.displayName,
  getProfileRaidRole: () => "dps",
  profileNeedsSettingsSetup: () => false,
};
const overview = load("src/services/profileOverview.ts", {
  "@/lib/auth": { getSession: async () => viewer },
  "next/navigation": { redirect: stop("REDIRECT:"), notFound: stop("NOT_FOUND") },
  "@/lib/battlenet": { getEnabledBattleNetRegions: () => ["eu"] },
  "@/lib/wowCharacters": { normalizeCharacterKey: value => value },
  "@/lib/raids": { listProfileRaidSignups: async () => { raidReads++; if (raidsFail) throw Error("DB unavailable"); return []; } },
  "@/lib/dashboardApiSettings": { getDashboardApiSettings: async () => ({ profileViewRefreshMinSeconds: 60 }) },
  "@/lib/discordAdmin": { fetchDiscordGuildMemberSnapshot: async () => null },
  "@/lib/profiles": profileMethods,
  "@/lib/guildNicknamePolicy": { getGuildNicknamePolicy: async () => ({ template: "{name}" }) },
}).exports;
const input = query => ({ params: Promise.resolve({ profileId: "own" }), searchParams: Promise.resolve(query || {}) });
(async () => {
  await test("profile loader refuses anonymous users before profile or raid reads", async () => {
    viewer = null; await assert.rejects(overview.loadProfileOverview(input()), /REDIRECT:\/login/);
    assert.equal(profileReads, 0); assert.equal(raidReads, 0);
  });
  await test("profile loader hides unauthorized identities without reading private raid data", async () => {
    viewer = { profileId: "another", provider: "discord", id: "another", role: "member", permissions: ["dashboard.view"] }; viewAllowed = false;
    await assert.rejects(overview.loadProfileOverview(input()), /NOT_FOUND/); assert.equal(raidReads, 0); viewAllowed = true;
  });
  await test("a public profile has no character mutation privileges or private raid read", async () => {
    const model = await overview.loadProfileOverview(input());
    assert.equal(model.canManageCharacters, false); assert.equal(model.canViewPrivateProfileBlocks, false); assert.equal(raidReads, 0);
  });
  await test("rules return token survives owner profile, settings and OAuth URLs", async () => {
    viewer = { profileId: "own", provider: "discord", id: profile.providerUserId, role: "member", permissions: ["dashboard.view"] };
    const model = await overview.loadProfileOverview(input({ from: "rules", rt: "signed+token/=" }));
    assert.equal(model.canManageCharacters, true);
    assert.equal(new URL(model.settingsRulesReturnPath, "https://test.invalid").searchParams.get("rt"), "signed+token/=");
    const next = new URL(model.battleNetRefreshHref, "https://test.invalid").searchParams.get("next");
    assert.equal(new URL(next, "https://test.invalid").searchParams.get("rt"), "signed+token/=");
  });
  await test("raid storage failure is explicit and cannot masquerade as an empty list", async () => {
    raidsFail = true; const model = await overview.loadProfileOverview(input());
    assert.equal(model.raidSignupsUnavailable, true); assert.equal(model.raidSignups.length, 0); raidsFail = false;
  });
  await test("profile settings reject another user before loading their profile", async () => {
    let reads = 0;
    const settings = load("src/services/profileSettings.ts", {
      "@/lib/auth": { getSession: async () => ({ ...viewer, profileId: "another" }) },
      "@/lib/dashboardSystemLogs": { recordDashboardSystemLog() {} },
      "@/lib/runtimeResilience": { withTimeout: value => value },
      "@/lib/discordAdmin": {},
      "@/lib/guildNicknamePolicy": { getGuildNicknamePolicy: async () => ({ template: "{name}" }) },
      "@/lib/profiles": { getProfileById: async () => { reads++; return profile; } },
      "next/navigation": { redirect: stop("REDIRECT:"), notFound: stop("NOT_FOUND") },
    }).exports;
    await assert.rejects(settings.loadProfileSettings(input()), /NOT_FOUND/); assert.equal(reads, 0);
  });
  await test("directory checks fresh management rights before any catalog or Discord reads", async () => {
    let reads = 0;
    const directory = load("src/services/profileDirectory.ts", {
      "@/lib/auth": { getSession: async options => { assert.equal(options.live, true); return viewer; } },
      "next/navigation": { redirect: stop("REDIRECT:") },
      "@/lib/profileDirectory": { listDashboardProfilePage: async () => { reads++; }, profileDirectoryFilters: () => { reads++; } },
      "@/lib/discordAdmin": { fetchDiscordGuildMembersCachedForUi: async () => { reads++; } },
      "@/lib/raidDiscordPresets": { listRaidDiscordPreferences: async () => { reads++; } },
    }).exports;
    await assert.rejects(directory.loadProfileDirectory({ searchParams: Promise.resolve({}) }), /REDIRECT:\/access-denied/); assert.equal(reads, 0);
  });
  await test("public Battle.net panel emits no OAuth, setup or candidate mutation controls", () => {
    const blocked = { __esModule: true, default: () => React.createElement("div", null, "characters") };
    const render = renderer(Object.fromEntries(["ProfileCharactersLiveSection", "ProfileCharacterSetup", "ProfileCandidateBulkActions", "ProfileCandidateExpiryTimer", "ProfileCandidateCharacterRow"].map(name => ["@/components/" + name, blocked])));
    const html = render.html("src/components/profile/ProfileBattleNetPanel.tsx", { model: { profile, canManageCharacters: false, canViewPrivateProfileBlocks: false, visibleCharacters: [], mainCharacter: null, apiSettings: { profileViewRefreshMinSeconds: 60 }, availableCandidates: [], availableGuildCandidates: [], availableOtherCandidates: [], battleNetLastSyncLabel: "—", battleNetRefreshHref: "/api/auth/battlenet/start", battleNetCharacterActionHref: "/api/auth/battlenet/start", battleNetAction: { title: "Connect" } } });
    assert.doesNotMatch(html, /\/api\/auth|<form|profile-candidates|Connect/);
  });
  await test("role search hides rows but keeps every saved mapping mounted and enabled", () => {
    const render = renderer({ react: { ...React, useState: () => ["Officer", () => {}] } });
    const html = render.html("src/components/management/access/RoleMappingsEditor.tsx", { rows: [{ roleId: "1", name: "Officer", groupId: "old-admin" }, { roleId: "2", name: "Member", groupId: "member" }], groups: [{ id: "member", name: "Member" }], disabled: false });
    assert.match(html, /hidden=""/); assert.match(html, /name="roleMap:1"/); assert.match(html, /name="roleMap:2"/);
    assert.match(html, /value="old-admin" selected=""/); assert.doesNotMatch(html, /disabled/);
  });
  await test("nickname form caps selected alts at two while keeping selected choices removable", () => {
    const html = renderer().html("src/components/profile/settings/NicknameSelection.tsx", { choices: ["a", "b", "c"].map(key => ({ key, name: key, detail: "alt" })), selected: ["a", "b"], returnTo: "/profile/own/settings?rt=signed" });
    assert.equal((html.match(/checked=""/g) || []).length, 2); assert.equal((html.match(/disabled=""/g) || []).length, 1);
    assert.match(html, /name="returnTo"/); assert.match(html, /action="\/api\/profile\/nickname-characters"/);
  });
  await test("secondary group actions retain native submitters and formAction semantics", () => {
    const content = React.createElement("button", { type: "submit", name: "mode", value: "delete", formAction: "/delete", formNoValidate: true }, "Delete");
    const html = renderer().html("src/components/ui/DropdownMenu.tsx", { children: content });
    assert.match(html, /<details/); assert.match(html, /type="submit"/); assert.match(html, /formAction="\/delete"/i); assert.match(html, /name="mode"/); assert.match(html, /value="delete"/);
  });
  await test("filter submit uses Next navigation, trims values and omits empty filters", () => {
    let navigated;
    const render = renderer({ react: { ...React, useTransition: () => [false, fn => fn()] }, "next/navigation": { useRouter: () => ({ push: (...args) => { navigated = args; } }) } });
    const element = render.component("src/components/page/FilterNavigationForm.tsx").default({ action: "/profiles", children: "filters" });
    const Original = global.FormData;
    try {
      global.FormData = class { constructor(form) { this.form = form; } [Symbol.iterator]() { return this.form.values[Symbol.iterator](); } };
      let prevented = false;
      element.props.onSubmit({ preventDefault() { prevented = true; }, currentTarget: { values: [["q", " Hero "], ["link", "linked"], ["empty", " "]] } });
      assert.equal(prevented, true); assert.equal(navigated[0], "/profiles?q=Hero&link=linked"); assert.equal(navigated[1].scroll, false);
    } finally { global.FormData = Original; }
  });
  await test("all six migrated routes have shared page loading and safe local error boundaries", () => {
    for (const route of ["dashboard/access", "dashboard/groups", "dashboard/profiles", "profiles", "profile/[profileId]", "profile/[profileId]/settings"]) {
      assert.match(read(`src/app/${route}/loading.tsx`), /<PageSkeleton variant="page"/);
      assert.match(read(`src/app/${route}/error.tsx`), /PageRouteError/);
    }
    assert.doesNotMatch(read("src/components/page/PageRouteError.tsx"), /error\.message/);
  });
  await test("migrated workspace CSS uses tokens for colors and spacing with no inline styles", () => {
    for (const folder of ["src/components/profile", "src/components/management/access", "src/components/management/cleanup", "src/components/access-groups"]) {
      const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(dir + "/" + entry.name) : [dir + "/" + entry.name]);
      for (const file of walk(folder)) {
        const source = read(file);
        if (file.endsWith(".tsx")) assert.doesNotMatch(source, /\bstyle\s*=/, file);
        if (file.endsWith(".css")) {
          assert.doesNotMatch(source, /#[a-f\d]{3,8}\b|\b(?:rgb|hsl)a?\(/i, file);
          for (const match of source.matchAll(/(?:^|[;{])\s*((?:padding|margin|gap|row-gap|column-gap)[\w-]*)\s*:\s*([^;{}]+)/g)) assert.doesNotMatch(match[2], /\d+(?:px|rem|em)\b/, file);
        }
      }
    }
  });
  console.log(`[check-identity-workspaces] ${passed}/${passed}; real loaders and React SSR; controlled external boundaries`);
})().catch(error => { console.error(error); process.exit(1); });
