// Independent renderer checks: run the real TSX through TypeScript, without snapshots of source strings.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(root, "src/components/static/StaticMarkdown.tsx"), "utf8");
const converted = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  reportDiagnostics: true,
});
const errors = (converted.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, "renderer compiles");
const sandboxModule = { exports: {} };
const jsx = (tag, props) => ({ tag, props: props || {} });
vm.runInNewContext(converted.outputText, {
  exports: sandboxModule.exports, module: sandboxModule, require: (name) => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : (() => { throw Error("unexpected dependency: " + name); })(),
}, { filename: "StaticMarkdown.cjs" });
const render = (value) => sandboxModule.exports.StaticMarkdown({ value });
const flatten = (node, result = []) => {
  if (Array.isArray(node)) for (const x of node) flatten(x, result);
  else if (node != null && typeof node === "object" && "tag" in node) { result.push(node); flatten(node.props.children, result); }
  else if (typeof node === "string") result.push(node);
  return result;
};
const elements = (markdown, tag) => flatten(render(markdown)).filter(x => x?.tag === tag);
const template = [
  "# Правила для тесту",
  "> Примітка щодо правил",
  ...[1, 2, 3, 4, 5].flatMap((section, index) => [
    `## ${section}. Тестовий розділ ${section}`,
    ...Array.from({ length: [7, 7, 10, 5, 5][index] }, (_, clause) => `**${section}.${clause + 1}.** Приклад тестового правила`),
  ]),
].join("\n\n");
assert.equal(elements(template, "h3").length, 5, "five primary rules sections render as headings");
assert.equal(elements(template, "strong").length, 34, "all 34 numbered clauses keep their explicit numbering");
assert.equal(elements("**1.2.** Текст", "strong").length, 1);
assert.equal(elements("- Перший\n- Другий", "li").length, 2);
assert.equal(elements("1. Один\n2. Два", "li").length, 2);
assert.equal(elements("> Цитата", "blockquote").length, 1);
assert.equal(elements("| Назва | Час |\n|---|---|\n| РТ | 20:00 |", "td").length, 2);
assert.equal(elements("```html\n<script>hello</script>\n```", "pre").length, 1);
assert.equal(elements("[База](https://example.org)", "a").length, 1);
assert.equal(elements("[Danger](javascript:alert(1))", "a").length, 0, "javascript URL must not be a hyperlink");
assert.equal(elements("[Data](data:text/html,alert)", "a").length, 0, "data URL must not be a hyperlink");
const raw = flatten(render("<img src=x onerror=alert(1)>"));
assert.equal(raw.filter(x => x?.tag === "img").length, 0, "raw HTML is not executed");
assert(raw.includes("<img src=x onerror=alert(1)>"), "raw HTML remains visible as text");
assert(!flatten(render("### Test")).some(x => x?.props?.dangerouslySetInnerHTML), "dangerouslySetInnerHTML is not used");
assert.equal(elements("ЙОБ\\*НА БЛ\\*ТЬ", "em").length, 0, "escaped stars are literal text");
assert(elements("~~видалено~~", "s").length === 1);
console.log("[independent-static-markdown] PASS: 15 safety/render/structure assertions; 5 headings; 34 numbered clauses.");
