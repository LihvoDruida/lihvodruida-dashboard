"use strict";
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");

// Follow actual UI/service imports after page decomposition. Do not include
// unrelated pages, libraries or test files that could satisfy an invariant.
module.exports = function readUiWorkspace(entry) {
  const visited = new Set();
  function read(file) {
    if (visited.has(file)) return "";
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    let result = source;
    for (const node of parsed.statements) {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const name = node.moduleSpecifier.text;
      if (name.endsWith(".css")) continue;
      const base = name.startsWith("@/") ? path.join(root, "src", name.slice(2))
        : name.startsWith(".") ? path.resolve(path.dirname(file), name) : null;
      if (!base || !(["components", "services"].some(folder => base.startsWith(path.join(root, "src", folder) + path.sep)) || /^.*[\\/]lib[\\/](?:raid|raidPoll|guildRoster)Presentation$/.test(base))) continue;
      const target = [base, base + ".tsx", base + ".ts"].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (target) result += "\n" + read(target);
    }
    return result;
  }
  return read(path.resolve(root, entry));
};
