const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Compile the actual server module, not an extracted/reimplemented algorithm.
// server-only is an environment marker; all functional dependencies are explicit.
module.exports = function loadServerTs(relativePath, modules = {}, globals = {}) {
  const file = path.resolve(__dirname, "../..", relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  const context = {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(modules, name)) return modules[name];
      if (name.startsWith("node:")) return require(name);
      throw new Error("Unexpected test dependency: " + name);
    },
    process: { env: {} },
    console, Date, Promise, Map, Set, Buffer, setTimeout, clearTimeout,
    ...globals,
  };
  vm.runInNewContext(compiled, context, { filename: file });
  return { exports: mod.exports, context };
};
