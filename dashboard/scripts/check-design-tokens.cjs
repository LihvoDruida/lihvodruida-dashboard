"use strict";
// Regression guard for one shared design system, including CSS Modules.
// No dependencies: can run when Next/npm dependencies are unavailable.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const src = path.join(root, "src");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const all = walk(src);
const cssFiles = all.filter((file) => file.endsWith(".css"));
const runtime = all.filter((file) => /\.(?:tsx?|jsx?)$/.test(file))
  .map((file) => fs.readFileSync(file, "utf8")).join("\n");
const defs = new Set();
const refs = [];
const errors = [];
function validateBraces(content, file) {
  // Ignore quoted text, comments and escaped braces (including data:image SVGs).
  let level = 0, quote = "", comment = false, escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i], next = content[i+1];
    if (comment) { if (ch === "*" && next === "/") { comment = false; i++; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "*") { comment = true; i++; continue; }
    if (ch === "\"" || ch === "'") { quote = ch; continue; }
    if (ch === "{") level++;
    if (ch === "}") { level--; if (level < 0) break; }
  }
  if (level !== 0 || quote || comment) errors.push(`${file}: CSS structure is unbalanced`);
}
for (const file of cssFiles) {
  const relative = path.relative(root, file);
  const raw = fs.readFileSync(file, "utf8");
  validateBraces(raw, relative);
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const m of source.matchAll(/(?:^|[^\w-])(--[\w-]+)\s*:/g)) defs.add(m[1]);
  for (const m of source.matchAll(/var\(\s*(--[\w-]+)/g)) refs.push([m[1], relative]);
}
const dynamic = new Set(["--font-guild-display", "--font-guild-heading", "--font-guild-masthead"]);
// CSS Modules receive per-character colors from explicit inline styles.
if (/\"--guild-class-color\"\s*:/.test(runtime)) dynamic.add("--guild-class-color");
const undefinedVars = [...new Set(refs.filter(([name]) => !defs.has(name) && !dynamic.has(name))
  .map(([name, file]) => `${name} (${file})`))];
if (undefinedVars.length) errors.push(...undefinedVars.map((s) => `undefined token: ${s}`));
const layout = fs.readFileSync(path.join(src, "app/layout.tsx"), "utf8");
const index = (file) => layout.lastIndexOf(`import "./styles/${file}.css"`);
if (index("desktop") <= index("roster") ||
    index("desktop") >= index("guild-banner") ||
    index("guild-banner") >= index("management")) {
  errors.push("CSS cascade order must be: domain styles → desktop → guild banner → integration overrides");
}
const legacyTokens = ["--muted", "--text-primary", "--panel-bg"];
for (const name of legacyTokens) if (refs.some(([token]) => token === name)) errors.push(`legacy token reference: ${name}`);
for (const error of errors) console.error(`✗ ${error}`);
if (errors.length) process.exit(1);
console.log(`STYLE TOKEN AUDIT OK: ${cssFiles.length} CSS files, ${defs.size} defined custom properties, ${refs.length} references, no unresolved tokens or invalid braces.`);
