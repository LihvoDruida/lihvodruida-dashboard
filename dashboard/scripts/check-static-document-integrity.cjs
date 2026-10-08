/** Independent document and lifecycle checks. Transpile the production TS/TSX and execute key exported functions. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const base = path.resolve(__dirname, '..');
const repo = path.resolve(base, '..');
// Detect Docker integration regressions rather than merely passing on the host,
// where docs/content/ is always present in the checked-out repository.
const dockerfile = fs.readFileSync(path.join(repo, 'dashboard/Dockerfile'), 'utf8');
const dockerignore = fs.readFileSync(path.join(repo, '.dockerignore'), 'utf8');
assert.match(dockerfile, /^COPY docs\/content\/static-rules\.md \/repo\/docs\/content\/static-rules\.md$/m,
  'builder must copy the canonical static rules document for build:ci');
assert.match(dockerignore, /^!docs\/content\/$/m,
  'build context must include the Markdown parent directory');
assert.match(dockerignore, /^!docs\/content\/static-rules\.md$/m,
  'build context must include the canonical static rules document');
const md = fs.readFileSync(path.join(repo, 'docs/content/static-rules.md'), 'utf8').trimEnd();
const read = relative => fs.readFileSync(path.join(base, 'src', relative), 'utf8');
let count = 0;
function test(label, fn) { const result = fn(); count++; console.log(`PASS ${label}`); return result; }
function compile(src, fileName) {
  const transpiled = ts.transpileModule(src, {fileName, reportDiagnostics: true, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX}});
  const errors = (transpiled.diagnostics||[]).filter(x=>x.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${fileName} compilation syntax`);
  return transpiled.outputText;
}
function moduleFor(source, filename, requires) {
  const module = {exports:{}};
  vm.runInNewContext(compile(source, filename), {module, exports:module.exports, require(name) {if (!(name in requires)) throw Error(`Unexpected dependency ${name}`);return requires[name]}, process, Buffer, console, Date}, {filename});
  return module.exports;
}
const template = moduleFor(read('lib/staticRulesDefault.ts'), 'staticRulesDefault.ts',{}).DEFAULT_STATIC_RULES_MARKDOWN;
test('default compiled template is byte identical to project Markdown', () => assert.equal(template, md));
test('five original sections are retained', () => assert.deepEqual([...md.matchAll(/^## ([1-5])\. /gm)].map(x=>Number(x[1])), [1,2,3,4,5]));
test('all original 34 numbered rules are present in their original order', () => {
  const found=[...md.matchAll(/^\*\*((?:\d+\.)+)\*\*/gm)].map(x=>x[1]);
  assert.equal(found.length,34);
  assert.equal(new Set(found).size,34);
  assert(found.indexOf('3.1.1.1.') > found.indexOf('3.1.1.'));
});
test('basic schedule and obligations preserved', () => {
  for(const part of ['Yoku (Богдан)','3 години','середа і субота','1-2 години','2 і більше разів','двох повідомлень поспіль','ЙОБ\\*НА БЛ\\*ТЬ'])assert(md.includes(part),`missing: ${part}`);
});
test('five internal links have matching destinations', () => {
 for (let i=1;i<=5;i++) assert(md.includes(`](#section-${i})`));
});
test('template stays under API hard limit of 20,000 characters',()=>assert(md.length < 20000));
const store = new Map();
function doc(table,id){return {get:async()=>({data:()=>store.get(`${table}/${id}`)}),set:async value=>{store.set(`${table}/${id}`,value)}};}
const db = {collection: table=>({doc: id=>doc(table,id)})};
const staticRules = moduleFor(read('lib/staticRules.ts'),'staticRules.ts', {
  'server-only':{},'node:crypto':require('node:crypto'),
  '@/lib/firebaseAdmin':{getFirebaseAdminDb:()=>db},
  '@/lib/discordAdmin':{},
  '@/lib/permissions':{isDashboardAdmin:()=>false},
  '@/lib/staticRulesDefault':{DEFAULT_STATIC_RULES_MARKDOWN:template}
});
async function asyncChecks(){
  store.clear();
  await staticRules.getStaticSettings().then(s=>test('first install shows source document without manual importing',()=>{assert.equal(s.text,md); assert.equal(s.version,1)}));
  store.set('staticRulesConfig/main',{text:'## Опублікована редакція РЛ',version:7,updatedAt:'2026-10-01T00:00:00Z'});
  await staticRules.getStaticSettings().then(s=>test('existing author-edited text remains authoritative',()=>{assert.equal(s.text,'## Опублікована редакція РЛ');assert.equal(s.version,7)}));
  const res=await staticRules.saveStaticSettings({text:md},'123456789012345678');
  test('explicit template publication bumps existing rule version',()=>{assert.equal(res.version,8); assert.equal(store.get('staticRulesConfig/main').text,md)});
  const again=await staticRules.saveStaticSettings({text:md},'123456789012345678');
  test('unchanged publication does not bump rules version',()=>assert.equal(again.version,8));
  const jsx=(tag,props)=>({tag,props:props||{}});
  const renderer=moduleFor(read('components/static/StaticMarkdown.tsx'),'StaticMarkdown.tsx', {'react/jsx-runtime':{jsx,jsxs:jsx}}).StaticMarkdown;
  const flattened=(root)=>{const all=[];const walk=n=>{if(Array.isArray(n))n.forEach(walk);else if (typeof n==='object' && n!==null && 'tag' in n) {all.push(n);walk(n.props.children);}};walk(root);return all;};
  const nodes=flattened(renderer({value:md}));
  test('actual renderer creates five anchored chapter headings',()=>{
   const ids=nodes.filter(x=>/^h[2-4]$/.test(x.tag)&&x.props.id).map(x=>x.props.id);
   assert.deepEqual(ids,['section-1','section-2','section-3','section-4','section-5']);
  });
  test('actual renderer creates working five local in-document links',()=>{
   const urls=nodes.filter(x=>x.tag==='a').map(x=>x.props.href);
   assert.deepEqual(urls,['#section-1','#section-2','#section-3','#section-4','#section-5']);
  });
  test('renderer disallows JavaScript link injection even in template',()=>{
   assert(!flattened(renderer({value:'[test](javascript:alert(1))'})).some(x=>x.tag==='a'));
  });
  const route=moduleFor(read('app/api/static/rules/route.ts'),'rules/route.ts', {
    'next/server':{NextResponse:{json:(data,opt)=>({data,status:opt?.status||200})}},
    '@/lib/auth':{getSession:async()=>({id:'123456789012345678',provider:'discord'})},
    '@/lib/staticRules':{staticPermission:async()=>({view:true,edit:false}),getStaticSettings:async()=>({text:md,version:1})},
    '@/lib/staticRulesDefault':{DEFAULT_STATIC_RULES_MARKDOWN:template},
    '@/lib/security':{assertRequestBodySize:()=>null,checkRateLimit:()=>({ok:true}),verifyTrustedOrigin:()=>true,noStoreHeaders:()=>({})},
  });
  const view=await route.GET();
  test('non-editor API response never exposes template editing control',()=>assert.equal(view.data.template,undefined));
  // Build the same real GET handler with edit permission and assert the canonical text is available only then.
  const editorRoute = moduleFor(read('app/api/static/rules/route.ts'),'rules-editor/route.ts', {
    'next/server':{NextResponse:{json:(data,opt)=>({data,status:opt?.status||200})}},
    '@/lib/auth':{getSession:async()=>({id:'123456789012345678',provider:'discord'})},
    '@/lib/staticRules':{staticPermission:async()=>({view:true,edit:true}),getStaticSettings:async()=>({text:'custom',version:9})},
    '@/lib/staticRulesDefault':{DEFAULT_STATIC_RULES_MARKDOWN:template},
    '@/lib/security':{assertRequestBodySize:()=>null,checkRateLimit:()=>({ok:true}),verifyTrustedOrigin:()=>true,noStoreHeaders:()=>({})},
  });
  const editor = await editorRoute.GET();
  test('authorized editor receives the original document as a restore option',()=>assert.equal(editor.data.template,md));
  console.log(`Independent document/template/renderer checks passed: ${count}/${count}`);
}
asyncChecks().catch(error=>{console.error(error);process.exitCode=1;});
