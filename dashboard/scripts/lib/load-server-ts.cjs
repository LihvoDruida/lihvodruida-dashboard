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
  const autoModules=new Map();
  const context = {
    module: mod, exports: mod.exports,
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(modules, name)) return modules[name];
      if(autoModules.has(name))return autoModules.get(name);
      const auto=(file,deps={})=>{const exports=module.exports(file,deps,globals).exports;autoModules.set(name,exports);return exports;};
      if(name==='@/lib/httpBody')return auto('src/lib/httpBody.ts');
      if(name==='@/lib/apiHttp')return auto('src/lib/apiHttp.ts',{'@/lib/httpBody':context.require('@/lib/httpBody')});
      if(name==='@/lib/providerCooldown')return auto('src/lib/providerCooldown.ts',{'@/lib/db/pgPool':modules['@/lib/db/pgPool']||{hasPostgresConfig:()=>false},'@/lib/apiHttp':context.require('@/lib/apiHttp')});
      if(name==='@/lib/providerHttp'&&modules['@/lib/apiHttp'])return {...modules['@/lib/apiHttp'],providerFetchJson:modules['@/lib/apiHttp'].apiFetchJson,providerFetch:globals.fetch||fetch};
      if(name==='@/lib/providerHttp')return auto('src/lib/providerHttp.ts',{'@/lib/apiHttp':context.require('@/lib/apiHttp'),'@/lib/providerCooldown':context.require('@/lib/providerCooldown')});
      if(name==='./message')return auto('src/lib/streamers/message.ts',{'./contract':modules['./contract']||module.exports('src/lib/streamers/contract.ts',{},globals).exports});
      if (name === "@/lib/guildRosterViewState") return module.exports("src/lib/guildRosterViewState.ts", {}, globals).exports;
      if (name === "@/lib/automationTaskCatalog") return module.exports("src/lib/automationTaskCatalog.ts", {}, globals).exports;
      if (name === "@/lib/automationTaskRuns") return module.exports("src/lib/automationTaskRuns.ts", { '@/lib/documentDb': { hasDocumentDbConfig: () => false } }, globals).exports;
      if (name === "@/lib/stableUiText") return module.exports("src/lib/stableUiText.ts", {}, globals).exports;
      if (name === "@/lib/logPrivacy") return module.exports("src/lib/logPrivacy.ts", {}, globals).exports;
      if (name === "@mistblossom/discord-contract") return require(path.resolve(__dirname, "../../../shared/index.mjs"));
      if (name.startsWith("node:")) return require(name);
      throw new Error("Unexpected test dependency: " + name);
    },
    process: { env: {} },
    console, Date, Promise, Map, Set, Buffer, Error, setTimeout, clearTimeout,
    TextDecoder,Headers,Request,Response,URL,URLSearchParams,AbortController,AbortSignal,fetch,FormData,
    ...globals,
  };
  vm.runInNewContext(compiled, context, { filename: file });
  return { exports: mod.exports, context };
};
