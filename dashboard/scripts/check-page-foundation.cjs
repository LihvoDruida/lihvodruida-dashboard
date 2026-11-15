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
const test = async (name, fn) => { await fn(); passed++; console.log("PASS " + name); };
const directory = load("src/lib/managementDirectory.ts").exports;
const permissions = load("src/lib/permissions.ts", { "@/lib/accessGroupSchema": load("src/lib/accessGroupSchema.ts").exports }).exports;
const catalog = load("src/lib/navigation/management.ts", { "@/lib/permissions": permissions }).exports;
const model = load("src/lib/managementOverviewModel.ts", { "@/lib/permissions": permissions, "@/lib/navigation/management": catalog, "@/lib/automationTaskCatalog": load("src/lib/automationTaskCatalog.ts").exports }).exports;
const fixtures = [
  { key: "groups", href: "/dashboard/groups", section: "access", label: "Групи доступу", description: "Ранги та права" },
  { key: "logs", href: "/dashboard/logs", section: "system", label: "Журнали", description: "Події та помилки" },
  { key: "discord", href: "/dashboard/discord", section: "discord", label: "Учасники", description: "Ролі й ніки" },
];
const defaults = directory.DEFAULT_DIRECTORY_FILTERS;
const cache = new Map();
function component(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file }).outputText;
  const mod = { exports: {} }; cache.set(file, mod.exports);
  const resolve = name => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "next/link") return { __esModule: true, default: ({ children, prefetch, ...props }) => React.createElement("a", props, children) };
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name === "@/lib/managementDirectory") return directory;
    if (name === "@/components/ClientErrorReporter") return { sendClientErrorReport() {} };
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : path.resolve(path.dirname(file), name);
      const target = [base, base + ".tsx", base + ".ts"].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!target) throw Error("Unresolved component test import " + name);
      return component(path.relative(root, target));
    }
    throw Error("Unexpected component test dependency " + name);
  };
  new Function("require", "module", "exports", compiled)(resolve, mod, mod.exports);
  cache.set(file, mod.exports); return mod.exports;
}
const html = (file, props) => renderToStaticMarkup(React.createElement(component(file).default, props));
(async () => {
  await test("Unicode search, category and title sort compose without mutating input", () => {
    const original = JSON.stringify(fixtures);
    assert.equal(directory.filterManagementDirectory(fixtures, { ...defaults, query: "ГРУПИ права" })[0].key, "groups");
    assert.deepEqual(directory.filterManagementDirectory(fixtures, { ...defaults, section: "system" }).map(x => x.key), ["logs"]);
    assert.equal(directory.filterManagementDirectory(fixtures, { ...defaults, query: "відсутнє" }).length, 0);
    assert.equal(directory.filterManagementDirectory(fixtures, { ...defaults, sort: "title" })[0].key, "groups");
    assert.equal(JSON.stringify(fixtures), original);
  });
  await test("URL inputs are bounded and unknown filters fall back safely", () => {
    const normalized = directory.normalizeDirectoryFilters({ query: "x".repeat(999), section: "owner", sort: "sql" });
    assert.equal(normalized.query.length, 160); assert.equal(normalized.section, "all"); assert.equal(normalized.sort, "recommended");
  });
  const reader = { provider: "discord", id: "fixture", role: "member", permissions: ["dashboard.view", "groups.view"] };
  await test("server DTO contains only permitted destinations and no session/policy functions", () => {
    const items = model.managementOverviewItems(reader);
    assert.deepEqual(JSON.parse(JSON.stringify(items)).map(x => x.href), ["/dashboard/groups"]);
    assert.ok(items.every(item => !Object.hasOwn(item, "allowed") && !Object.hasOwn(item, "permissions")));
  });
  await test("automation snapshots and actions obey their own capability including owner-only cleanup", () => {
    const manager = { ...reader, permissions: ["dashboard.view", "discord.members.manage"] };
    assert.equal(model.canViewOverviewAutomation(manager, "members"), true);
    assert.equal(model.canViewOverviewAutomation(manager, "accounts"), false);
    assert.equal(model.canViewOverviewAutomation(manager, "log-maintenance"), false);
    assert.equal(model.overviewAutomationAction(manager, { id: "accounts", action: { href: "/unsafe" } }), null);
    assert.equal(model.overviewAutomationAction({ ...manager, isServerOwner: true }, { id: "accounts" }).href, "/dashboard/profiles");
  });
  await test("header renders one h1, semantic metrics and breadcrumb current state", () => {
    const result = html("src/components/page/PageHeader.tsx", { title: "Керування", description: "Опис", breadcrumbs: [{ label: "Огляд" }], metrics: [{ label: "Група", value: "Адмін" }] });
    assert.equal((result.match(/<h1\b/g) || []).length, 1); assert.match(result, /aria-current="page"/); assert.match(result, /<dt>Група<\/dt>/);
  });
  await test("skeleton is bounded, named and hidden from duplicate spoken content", () => {
    const result = html("src/components/page/PageSkeleton.tsx", { count: 999, label: "Завантаження" });
    assert.match(result, /role="status"/); assert.match(result, /aria-busy="true"/); assert.equal((result.match(/class="skeletonCard"/g) || []).length, 12);
  });
  await test("empty search and no-access data have distinct states and reset actions", () => {
    const empty = html("src/components/management/overview/ManagementDirectory.tsx", { items: [], initialFilters: defaults });
    const search = html("src/components/management/overview/ManagementDirectory.tsx", { items: fixtures, initialFilters: { ...defaults, query: "missing" } });
    assert.match(empty, /Немає доступних розділів/); assert.match(search, /Нічого не знайдено/); assert.match(search, /Показати всі розділи/);
  });
  await test("form section uses a real disabled fieldset and disclosure preserves disabled links", () => {
    assert.match(html("src/components/page/FormSection.tsx", { title: "Параметри", disabled: true, children: "Поля" }), /<fieldset[^>]*disabled/);
    const menu = html("src/components/ui/DropdownMenu.tsx", { items: [{ id: "disabled", label: "Недоступно", href: "/test", disabled: true }] });
    assert.match(menu, /<details/); assert.match(menu, /aria-disabled="true"/); assert.doesNotMatch(menu, /href="\/test"/);
  });
  await test("new page CSS has no literal colors or arbitrary spacing; JSX has no inline styles", () => {
    for (const folder of ["src/components/page", "src/components/management/overview"]) {
      for (const file of fs.readdirSync(path.join(root, folder))) {
        const content = fs.readFileSync(path.join(root, folder, file), "utf8");
        if (file.endsWith(".tsx")) assert.doesNotMatch(content, /\bstyle\s*=/, file);
        if (file.endsWith(".css")) {
          assert.doesNotMatch(content, /#[a-f\d]{3,8}\b|\b(?:rgb|hsl)a?\(/i, file);
          for (const match of content.matchAll(/(?:^|[;{])\s*((?:padding|margin|gap|row-gap|column-gap)[\w-]*)\s*:\s*([^;{}]+)/g)) {
            assert.doesNotMatch(match[2], /\d+(?:px|rem|em)\b/, file + " " + match[1]);
          }
        }
      }
    }
  });
  await test("reference page preserves streaming and no global loading screen is introduced", () => {
    const page = fs.readFileSync(path.join(root, "src/app/dashboard/page.tsx"), "utf8");
    assert.match(page, /getSession\(\{ live: true \}\)/); assert.match(page, /canAccessManagement\(user\)/);
    assert.match(page, /<Suspense fallback=\{<PageSkeleton/); assert.match(page, /<PageContainer/);
    assert.equal(fs.existsSync(path.join(root, "src/app/loading.tsx")), false);
  });
  console.log(`[check-page-foundation] ${passed}/${passed} passed`);
})().catch(error => { console.error(error); process.exit(1); });
