// Optional real-browser suite. Requires playwright + esbuild and an installed Chromium.
// MISTBLOSSOM_QA_MODULES, MISTBLOSSOM_QA_CHROMIUM and MISTBLOSSOM_QA_OUTPUT override local tooling/output.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const moduleRoots = process.env.MISTBLOSSOM_QA_MODULES ? [process.env.MISTBLOSSOM_QA_MODULES, root] : [root];
const { chromium } = require(require.resolve('playwright', { paths: moduleRoots }));
const esbuild = require(require.resolve('esbuild', { paths: moduleRoots }));
const output = process.env.MISTBLOSSOM_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'raid-attendance-'));
fs.mkdirSync(output, { recursive: true });
const baseline = Boolean(process.env.MISTBLOSSOM_TEST_ATTENDANCE_COMPONENT);
let postCount=0;
const characters = [{key:'a',label:'Перший'},{key:'b',label:'Другий'}];
const props = {raidId:'fixture00',closed:false,full:false,viewerAlreadyActive:true,activeJoinDisabled:false,skipDisabled:false,showRequirement:false,requirementTitle:'Вхід',requirementMessage:'Увійди',loginHref:'/login',profileHref:'/profile',rulesHref:'/rules',characterOptions:characters,selectedCharacterKey:'a',selectedStatus:'going',selectedRole:'dps',manualClasses:[{key:'druid',label:'Друїд',specs:[{key:'restoration',label:'Відновлення',role:'healer',roleLabel:'Хіл'}]}]};
fs.writeFileSync(path.join(output, 'entry.tsx'), "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport Attendance from '@attendance';\nimport LiveSync from '@live-sync';\nconst root = createRoot(document.getElementById('app')!);\nconst fixture = (window as any).fixture;\n(window as any).refreshes = 0;\n(window as any).toasts = [];\n(window as any).mutations = [];\nwindow.addEventListener('dashboard:toast', (event: any) => (window as any).toasts.push(event.detail));\nwindow.addEventListener('dashboard:data-mutated', (event: any) => (window as any).mutations.push(event.detail));\nfixture.render = (patch = {}) => {\n  fixture.props = { ...fixture.props, ...patch };\n  root.render(<main className=\"container\"><LiveSync /><Attendance {...fixture.props} /><button id=\"outside\">Поза формою</button></main>);\n};\nfixture.render();\n");
fs.writeFileSync(path.join(output, 'navigation.ts'), "export const useRouter = () => ({ refresh() { (window as any).refreshes++; } });\nexport const usePathname = () => '/raids/fixture00';\n");
let passed=0; const scenarios=[], observations={};
async function check(name, fn) { await fn(); passed++; scenarios.push(name); console.log(baseline ? 'PROBE' : 'PASS',name); }
(async()=>{
 await esbuild.build({entryPoints:[path.join(output,'entry.tsx')],outfile:path.join(output,'app.js'),bundle:true,jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),alias:{'@attendance':baseline?process.env.MISTBLOSSOM_TEST_ATTENDANCE_COMPONENT:path.join(root,'src/components/RaidAttendanceClient.tsx'),'next/navigation':path.join(output,'navigation.ts'),'@live-sync':path.join(root,'src/components/DashboardLivePageSync.tsx')},nodePaths:[path.join(root,'node_modules')],define:{'process.env.NODE_ENV':'"production"'}});
 const globals=[...fs.readFileSync(path.join(root,'src/app/layout.tsx'),'utf8').matchAll(/import "\.\/styles\/([^\"]+\.css)";/g)].map(m=>fs.readFileSync(path.join(root,'src/app/styles',m[1]),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');return res.end(fs.readFileSync(path.join(output,'app.js')))}if(req.url==='/global.css'){res.setHeader('content-type','text/css');return res.end(globals)}res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><body><div id="app"></div><script>window.fixture={props:'+JSON.stringify(props)+'};</script><script src="/app.js"></script></body></html>')});
 server.unref();server.listen(0,'127.0.0.1');await once(server,'listening');
 const browser=await chromium.launch({executablePath:process.env.MISTBLOSSOM_QA_CHROMIUM || undefined,args:['--no-sandbox','--disable-gpu','--no-zygote','--disable-dev-shm-usage'],headless:true});
 const errors=[]; let page;
 async function setup(preference='ok',submit='ok') {
  if(page)await page.close(); postCount=0; page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message)); await page.clock.install();
  await page.route('**/api/raids/reminder-preference',async route=>{if(preference==='hang')return; if(preference==='fail')return route.fulfill({status:503,json:{error:'unavailable'}}); return route.fulfill({json:{enabled:false}})});
  await page.route('**/api/raids/fixture00/attendance',async route=>{postCount++;if(submit==='hang')return;if(submit==='html')return route.fulfill({contentType:'text/html',body:'<html>Login</html>'});if(submit==='fail')return route.fulfill({status:409,json:{ok:false,toast:{tone:'warning',title:'Запис змінився',message:'Перевір склад.'}}});return route.fulfill({json:{ok:true,revision:'revision2',toast:{title:'Запис оновлено'}}})});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'✎ Змінити запис',exact:true}).click(); await page.locator('dialog[open]').waitFor(); if(preference!=='hang')await page.getByRole('checkbox').waitFor({state:'visible'});
 }
 async function ready(){await page.getByRole('button',{name:'Зберегти зміни',exact:true}).waitFor();await assert.doesNotReject(()=>page.waitForFunction(()=>!document.querySelector('button[type="submit"]').disabled))}
 try{
  await setup();await ready();
  await check('saved reminder opt-out is loaded before a submission',async()=>assert.equal(await page.getByRole('checkbox').isChecked(),false));
  await check('prop refresh preserves the local character draft',async()=>{await page.getByLabel(/^Персонаж/).selectOption('b');await page.evaluate(()=>window.fixture.render({characterOptions:structuredClone(window.fixture.props.characterOptions)})); await page.waitForTimeout(30); observations.characterAfterProps=await page.getByLabel(/^Персонаж/).inputValue();if(!baseline)assert.equal(observations.characterAfterProps,'b')});
  await check('open signup pauses global live page refresh after focus leaves selects',async()=>{await page.getByText('50/50',{exact:true}).click();await page.locator('dialog h2').click();await page.evaluate(()=>{document.activeElement.blur();window.dispatchEvent(new CustomEvent('dashboard:data-mutated'))});await page.clock.fastForward(800);observations.refreshesWhileOpen=await page.evaluate(()=>window.refreshes);if(!baseline)assert.equal(observations.refreshesWhileOpen,0)});
  await setup('ok','html');await ready();
  await check('HTTP 200 HTML never confirms or closes the signup',async()=>{await page.getByRole('button',{name:'Зберегти зміни',exact:true}).click();await page.waitForTimeout(70);observations.htmlClosed=await page.locator('dialog[open]').count()===0;observations.htmlMutationCount=await page.evaluate(()=>window.mutations.length);if(!baseline){assert.equal(observations.htmlClosed,false);assert.equal(observations.htmlMutationCount,0);await page.getByRole('alert').last().waitFor()}});
  await setup('hang');await page.clock.fastForward(13_000);await page.waitForTimeout(20);
  await check('preference request has a deadline and a retry within the open form',async()=>{observations.preferenceError=await page.getByRole('alert').count()>0;if(!baseline){assert.equal(observations.preferenceError,true);await page.unroute('**/api/raids/reminder-preference');await page.route('**/api/raids/reminder-preference',route=>route.fulfill({json:{enabled:false}}));await page.getByRole('button',{name:'Повторити завантаження'}).click();await ready();assert.equal(await page.getByRole('checkbox').isChecked(),false)}});
  await setup('ok','hang');await ready();await page.getByRole('button',{name:'Зберегти зміни',exact:true}).click();await page.clock.fastForward(26_000);await page.waitForTimeout(20);
  await check('lost submit response releases controls and preserves the draft without retrying POST',async()=>{observations.submitStillBusy=await page.getByRole('button',{name:'Зберігаємо…'}).count()>0;if(!baseline){assert.equal(observations.submitStillBusy,false);assert.equal(postCount,1);await page.getByRole('alert').last().waitFor();assert.equal(await page.getByLabel(/^Персонаж/).inputValue(),'a');await page.getByRole('button',{name:'Скасувати',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0)}});
  if(!baseline){
   await check('live refresh resumes after the form closes',async()=>{await page.evaluate(()=>window.dispatchEvent(new CustomEvent('dashboard:data-mutated')));await page.clock.fastForward(800);assert.equal(await page.evaluate(()=>window.refreshes),1)});
   await setup('ok','fail');await ready();await page.getByLabel(/^Персонаж/).selectOption('b');await page.getByRole('button',{name:'Зберегти зміни',exact:true}).click();
   await check('server rejection remains visible and retains selections',async()=>{await page.getByRole('alert').filter({hasText:'Перевір склад.'}).waitFor();assert.equal(await page.getByLabel(/^Персонаж/).inputValue(),'b');assert.equal(await page.evaluate(()=>window.mutations.length),0)});
   await check('reopening initializes the latest saved attendance and character',async()=>{await page.getByRole('button',{name:'Скасувати',exact:true}).click();await page.evaluate(()=>window.fixture.render({selectedCharacterKey:'b',selectedStatus:'late',selectedRole:'healer'}));await page.getByRole('button',{name:'✎ Змінити запис',exact:true}).click();await ready();assert.equal(await page.getByRole('radio',{name:/Затримаюсь/}).isChecked(),true);assert.equal(await page.getByLabel(/^Роль у рейді/).inputValue(),'healer')});
   await setup();await ready();
   await check('confirmed write closes once and publishes one live mutation',async()=>{await page.getByRole('button',{name:'Зберегти зміни',exact:true}).click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.mutations.length),1)});
   await setup();await ready();
   await check('manual class and spec commit together without a character key',async()=>{await page.getByRole('button',{name:'Клас і спеціалізація',exact:true}).click();await page.getByLabel(/^Клас/).selectOption('druid');await page.getByLabel(/^Спеціалізація/).selectOption('restoration');const request=page.waitForRequest('**/attendance');await page.getByRole('button',{name:'Зберегти зміни',exact:true}).click();const body=(await request).postData();assert.ok(body.includes('name="classKey"'));assert.ok(body.includes('name="specKey"'));assert.ok(!body.includes('name="characterKey"'));await page.locator('dialog').waitFor({state:'detached'});assert.equal(postCount,1)});
   await setup();await ready();
   await check('two same-tick submits send only one write',async()=>{await page.evaluate(()=>{const form=document.querySelector('dialog form');form.requestSubmit();form.requestSubmit()});await page.locator('dialog').waitFor({state:'detached'});assert.equal(postCount,1);assert.equal(await page.evaluate(()=>window.mutations.length),1)});
   await setup();await ready();
   await check('cancel does not save reminder changes',async()=>{await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Скасувати',exact:true}).click();assert.equal(postCount,0);assert.equal(await page.evaluate(()=>window.mutations.length),0)});
   await setup();await ready();
   await check('modal fits nine mobile and desktop widths',async()=>{for(const width of [320,360,390,520,760,1024,1280,1600,1920]){await page.setViewportSize({width,height:900});assert.ok(await page.locator('dialog').evaluate(el=>el.getBoundingClientRect().width<=innerWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}await page.setViewportSize({width:390,height:900});await page.screenshot({path:path.join(output,'mobile-390.png')})});
   await check('no browser runtime errors',async()=>assert.deepEqual(errors,[]));
  }
  fs.writeFileSync(path.join(output,baseline?'baseline.json':'results.json'),JSON.stringify({baseline,passed,failed:0,scenarios,observations,browser:await browser.version(),errors},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1});
