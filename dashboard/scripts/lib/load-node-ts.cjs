const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
// Node 24+ executes real server/helper modules without npm test dependencies.
module.exports = function loadNodeTs(relativePath, modules = {}, globals = {}) {
  const filename = path.resolve(__dirname, "../..", relativePath);
  let js = stripTypeScriptTypes(fs.readFileSync(filename, "utf8"), { mode: "transform" });
  const names = [...js.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)].map((m) => m[1]);
  js = js.replace(/import\s*["']server-only["'];?/g, "")
    .replace(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["'];?/g,
      (_, bindings, name) => `const {${bindings.replace(/\s+as\s+/g, ": ")}} = require(${JSON.stringify(name)});`)
    .replace(/export\s*\{[^}]+\}\s*from\s*["'][^"']+["'];?/g, "")
    .replace(/export\s+(?=(?:async\s+)?function|class|const|let)/g, "");
  return vm.runInNewContext(`(() => {${js}\nreturn {${names.join(",")}};})()`, {
    require(name) {
      if (Object.hasOwn(modules, name)) return modules[name];
      if(name==='@/lib/httpBody')return module.exports('src/lib/httpBody.ts',{},globals);
      if (name === "@/lib/logPrivacy") return module.exports("src/lib/logPrivacy.ts", {}, globals);
      if (name === "@mistblossom/discord-contract") return require(path.resolve(__dirname, "../../../shared/index.mjs"));
      if (name.startsWith("node:")) return require(name);
      throw Error("Unexpected test import: " + name);
    },
    process: { env: {} }, console, Buffer, Response, Request, Headers, URL,
    AbortSignal, AbortController, TextEncoder, TextDecoder, FormData, Blob,
    setTimeout, clearTimeout, setImmediate, clearImmediate, ...globals,
  }, { filename });
};
