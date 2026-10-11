const assert = require("node:assert/strict");
const load = require("./lib/load-server-ts.cjs");
const state = load("src/lib/listViewState.ts", {}, { URL, URLSearchParams }).exports;
const { listNavigationScope } = load("src/lib/listNavigationScope.ts").exports;
let passed = 0;
function check(name, run) { run(); passed++; console.log("✓ " + name); }
const now = Date.now();
check("Only exact local list paths can be restored", () => {
  for (const url of ["https://evil.invalid/profiles", "//evil.invalid/profiles", "/api/profiles", "/profiles/../login", "/profiles/", "/profiles%2f", "/profiles\\..\\login", "javascript:alert(1)"]) assert.equal(state.listViewUrl("profiles", url), null);
});
check("Profiles normalize and allowlist filters", () => assert.equal(state.listViewUrl("profiles", "/profiles?q=%00%20Hero%20&link=linked&role=member&sort=name&returnTo=https://evil.invalid&cursor=abc_12"), "/profiles?q=Hero&link=linked&role=member&sort=name&cursor=abc_12"));
check("Applications exclude private/unknown/transient query fields", () => assert.equal(state.listViewUrl("applications", "/applications?q=Hero&status=accepted&class=Druid&sort=updated&token=secret&cursor=abc&view=all#x"), "/applications?q=Hero&status=accepted&class=Druid&sort=updated"));
check("Named views never retain page cursors", () => assert.equal(state.listViewUrl("profiles", "/profiles?q=x&cursor=abc", false), "/profiles?q=x"));
check("Invalid cursors and enum values cannot enter restored state", () => assert.equal(state.listViewUrl("profiles", "/profiles?cursor=abc%2Fdef&role=owner&sort=evil&link=none"), "/profiles"));
check("URL and text sizes are bounded", () => { assert.equal(state.listViewUrl("profiles", "/profiles?q=" + "x".repeat(5000)), null); assert.equal(new URL(state.listViewUrl("applications", "/applications?q=" + "x".repeat(300)), "https://test.invalid").searchParams.get("q").length, 160); });
check("Row identities remain distinct and safe for Unicode", () => { const a = state.listEntryId("applications", "аб/a"); const b = state.listEntryId("applications", "абa"); assert.notEqual(a, b); assert.match(a, /^applications-entry-[a-f0-9-]+$/); });
check("Account and access changes isolate browser state", () => {
  const viewer = { provider: "discord", id: "123", role: "admin", groupId: "officers", permissions: ["b", "a"] };
  assert.equal(listNavigationScope(viewer), listNavigationScope({ ...viewer, permissions: ["a", "b"] }));
  for (const change of [{ id: "124" }, { role: "member" }, { permissions: ["a"] }, { groupId: "members" }, { isServerOwner: true }, { impersonatedBy: "owner" }]) assert.notEqual(listNavigationScope(viewer), listNavigationScope({ ...viewer, ...change }));
});
check("Expired state does not silently restore old filters", () => {
  const memory = state.emptyListMemory("profiles", now - state.LIST_MEMORY_TTL - 1); memory.last = "/profiles?q=old";
  assert.equal(state.parseListMemory("profiles", JSON.stringify(memory), now).last, "/profiles");
});
check("Malformed memory and unsafe return URLs are rejected", () => {
  for (const raw of ["{bad", "null", "x".repeat(65537), JSON.stringify({ ...state.emptyListMemory("profiles"), last: "//evil.invalid" }), JSON.stringify({ ...state.emptyListMemory("profiles"), at: now + 120000 })]) assert.throws(() => state.parseListMemory("profiles", raw, now));
});
check("Position history is bounded and replacement moves it to front", () => {
  let memory = state.emptyListMemory("profiles", now);
  for (let i = 0; i < 20; i++) memory = state.rememberListPosition(memory, { url: "/profiles?q=" + i, row: state.listEntryId("profiles", i), next: "", previous: "", scroll: 100, offset: 10, at: now, opened: true });
  assert.equal(memory.positions.length, 8); assert.equal(memory.last, "/profiles?q=19");
  memory = state.rememberListPosition(memory, { ...memory.positions[2], at: now + 1 });
  assert.equal(memory.positions.length, 8); assert.equal(memory.positions[0].url, memory.last);
});
check("Restored positions sanitize anchors and clamp offsets", () => {
  const memory = state.emptyListMemory("profiles", now);
  memory.positions = [{ url: "/profiles", row: 'x\" onclick=evil', next: "", previous: "", offset: -999999, scroll: -100, at: now, opened: true }];
  const parsed = state.parseListMemory("profiles", JSON.stringify(memory), now);
  assert.equal(parsed.positions[0].row, ""); assert.equal(parsed.positions[0].scroll, 0); assert.equal(parsed.positions[0].offset, -10000); assert.equal(state.listReturnUrl("profiles", parsed), "/profiles");
});
check("Back links preserve the filtered page and validated record", () => {
  const row = state.listEntryId("profiles", "id0000000000000001");
  const memory = state.rememberListPosition(state.emptyListMemory("profiles"), { url: "/profiles?q=Hero&cursor=abc", row, next: "", previous: "", scroll: 100, offset: 10, at: now, opened: true });
  assert.equal(state.listReturnUrl("profiles", memory), "/profiles?q=Hero&cursor=abc#" + row);
});
check("Saved views exclude cursors and remain bounded", () => {
  const memory = state.emptyListMemory("profiles", now); memory.views = Array.from({ length: 10 }, (_, i) => ({ name: "View " + i, url: "/profiles?q=" + i + "&cursor=abc" }));
  const parsed = state.parseListMemory("profiles", JSON.stringify(memory), now); assert.equal(parsed.views.length, 5); assert.ok(parsed.views.every(view => !view.url.includes("cursor")));
});
console.log(`[check-list-navigation] OK — ${passed} behavioural checks`);
