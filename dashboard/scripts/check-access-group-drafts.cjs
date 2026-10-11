const assert = require("node:assert/strict"),
  { webcrypto } = require("node:crypto"),
  load = require("./lib/load-server-ts.cjs");
const schema = load("src/lib/accessGroupSchema.ts").exports,
  d = load(
    "src/lib/accessGroupDrafts.ts",
    { "@/lib/accessGroupSchema": schema },
    { crypto: webcrypto },
  ).exports;
const group = {
    id: "new",
    name: "Base",
    role: "member",
    rank: 20,
    permissions: ["dashboard.view"],
    discordRoleIds: [],
    revision: "a".repeat(64),
  },
  raw = (entries) =>
    JSON.stringify({ version: 1, expanded: "group:new", drafts: entries });
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("✓ " + name);
}
check("Literal new and prototype IDs have safe isolated draft keys", () => {
  assert.notEqual(d.groupDraftKey("new"), d.NEW_GROUP_DRAFT);
  const a = d.makeGroupDraft({ ...group, id: "__proto__" });
  a.values = { ...a.values, name: "Draft" };
  assert.equal(
    d.parseGroupDrafts(raw([a])).drafts.get("group:__proto__").values.name,
    "Draft",
  );
});
check("All editable fields and permissions round-trip through storage", () => {
  const a = d.makeGroupDraft(group);
  a.values = {
    id: "changed",
    name: "Ім’я",
    role: "admin",
    rank: "100",
    icon: "👑",
    discordRoleId: "123456789012345678",
    permissions: [...schema.DASHBOARD_PERMISSION_KEYS],
  };
  assert.equal(
    JSON.stringify(d.parseGroupDrafts(raw([a])).drafts.get(a.key).values),
    JSON.stringify(a.values),
  );
});
check(
  "Receipt clears only its submitted group, preserving other drafts",
  () => {
    const a = d.makeGroupDraft(group);
    a.values = { ...a.values, name: "Saved" };
    a.pending = {
      mutationId: webcrypto.randomUUID(),
      targetId: "new",
      values: a.values,
    };
    const b = d.makeGroupDraft({ ...group, id: "other" });
    b.values = { ...b.values, name: "Keep" };
    const result = d.reconcileGroupDrafts(
      new Map([
        [a.key, a],
        [b.key, b],
      ]),
      [{ ...group, lastMutationId: a.pending.mutationId }],
    );
    assert.equal(result.has(a.key), false);
    assert.equal(result.get(b.key).values.name, "Keep");
  },
);
check(
  "Late receipt preserves typing made after submission and rebases it",
  () => {
    const a = d.makeGroupDraft(group),
      submitted = { ...a.values, name: "Submitted" };
    a.values = { ...submitted, name: "Later" };
    a.pending = {
      mutationId: webcrypto.randomUUID(),
      targetId: "renamed",
      values: submitted,
    };
    const receipt = {
        ...group,
        id: "renamed",
        name: "Submitted",
        revision: "b".repeat(64),
        lastMutationId: a.pending.mutationId,
      },
      result = d
        .reconcileGroupDrafts(new Map([[a.key, a]]), [receipt])
        .get("group:renamed");
    assert.equal(result.values.name, "Later");
    assert.equal(result.base.name, "Submitted");
    assert.equal(result.baseRevision, receipt.revision);
    assert.ok(d.draftDirty(result));
    assert.equal(result.pending, undefined);
  },
);
check(
  "Another operation or group receipt never clears an unresolved draft",
  () => {
    const a = d.makeGroupDraft(group);
    a.values = { ...a.values, name: "Pending" };
    a.pending = {
      mutationId: webcrypto.randomUUID(),
      targetId: group.id,
      values: a.values,
    };
    for (const receipt of [
      { ...group, lastMutationId: webcrypto.randomUUID() },
      { ...group, id: "other", lastMutationId: a.pending.mutationId },
    ])
      assert.ok(
        d.reconcileGroupDrafts(new Map([[a.key, a]]), [receipt]).has(a.key),
      );
  },
);
check(
  "Corrupt, oversized or unknown-format storage is rejected explicitly",
  () => {
    for (const data of [
      "{bad",
      raw([{ key: "group:a" }]),
      "x".repeat(131073),
      JSON.stringify({ version: 2, drafts: [] }),
    ])
      assert.throws(() => d.parseGroupDrafts(data));
  },
);
check("New group draft restores without any mutation or authority", () => {
  const a = d.makeGroupDraft();
  a.values = {
    ...a.values,
    name: "New",
    id: "new",
    permissions: ["dashboard.view", "groups.manage"],
  };
  const restored = d.parseGroupDrafts(raw([a])).drafts.get(d.NEW_GROUP_DRAFT);
  assert.equal(restored.baseRevision, null);
  assert.equal(restored.values.permissions.length, 2);
});
console.log(
  `[check-access-group-drafts] OK — ${passed} restoration and receipt scenarios`,
);
