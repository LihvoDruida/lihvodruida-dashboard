const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const modules = [process.env.MISTBLOSSOM_QA_MODULES || root, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || root];
const { chromium } = require(require.resolve('playwright', { paths: modules }));
const esbuild = require(require.resolve('esbuild', { paths: modules }));
const output = process.env.MISTBLOSSOM_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'static-role-settings-'));
const baseline = process.env.MISTBLOSSOM_TEST_STATIC_ROLE_SOURCE;
fs.mkdirSync(output, { recursive: true });
const ids = ['111111111111111111','222222222222222222','333333333333333333'];
const saved = { memberRoleId: ids[0], managerRoleId: ids[1] };
const role = (id, name, manageable = true) => ({ id, name, manageable, color: 0, position: 1, blockedReason: manageable ? null : 'hierarchy' });
const roles = [role(ids[0], 'Статик'), role(ids[1], 'РЛ', false), role(ids[2], 'Резерв')];
const overview = (settings = saved, warning = null, list = roles) => ({ ok: true, settings, roles: list, warning, botCanManageRoles: !warning, guildName: 'Test guild' });
fs.writeFileSync(path.join(output, 'link.tsx'), "import React from 'react';export default function Link(props){return <a {...props}/>}");
fs.writeFileSync(path.join(output, 'entry.tsx'), "import React from 'react';import{createRoot}from'react-dom/client';import Panel from '@panel';const root=createRoot(document.getElementById('app'));window.unmount=()=>root.unmount();root.render(<main className='container'><button id='before'>Before</button><Panel/><button id='after'>After</button></main>);");
let passed = 0, failed = 0, page, release, mode, reads = 0, posts = 0;
const observations = {}, scenarios = [], errors = [];
async function check(name, run) { try { await run(); passed++; scenarios.push(name); console.log(baseline ? 'PROBE' : 'PASS', name); } catch (error) { failed++; throw error; } }
(async () => {
 await esbuild.build({ entryPoints: [path.join(output,'entry.tsx')], outfile: path.join(output,'app.js'), bundle: true, jsx:'automatic', tsconfig:path.join(root,'tsconfig.json'), alias:{'@panel':baseline ? path.join(baseline,'StaticRoleSettingsClient.tsx') : path.join(root,'src/components/static/StaticRoleSettingsClient.tsx'),'next/link':path.join(output,'link.tsx')},nodePaths:[path.join(root,'node_modules')],define:{'process.env.NODE_ENV':'"production"'} });
 const css=[...fs.readFileSync(path.join(root,'src/app/layout.tsx'),'utf8').matchAll(/import "\.\/styles\/([^\"]+\.css)";/g)].map(m=>fs.readFileSync(path.join(root,'src/app/styles',m[1]),'utf8')).join('\n');
 const server=http.createServer((req,res)=>{ if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');return res.end(fs.readFileSync(path.join(output,'app.js')));}if(req.url==='/style.css'){res.setHeader('content-type','text/css');return res.end(css+'\n'+fs.readFileSync(path.join(output,'app.css'),'utf8'));}res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="app"></div><script src="/app.js"></script></body></html>');});server.unref();server.listen(0,'127.0.0.1');await once(server,'listening');
 const browser=await chromium.launch({executablePath:process.env.MISTBLOSSOM_QA_CHROMIUM||undefined,args:['--no-sandbox','--disable-gpu','--no-zygote','--disable-dev-shm-usage'],headless:true});
 async function setup(nextMode='ok'){
  if(page)await page.close();page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));mode=nextMode;reads=0;posts=0;release=null;let current={...saved};
  await page.addInitScript(fast=>{window.inFlight=0;window.abortedPosts=0;const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,fast&&ms===20000?150:ms,...args);const fetch=window.fetch.bind(window);window.fetch=(...args)=>{window.inFlight++;if(args[1]?.method==='POST')args[1].signal?.addEventListener('abort',()=>window.abortedPosts++,{once:true});return fetch(...args).finally(()=>window.inFlight--);};},nextMode==='timeout');
  await page.route('**/api/dashboard/static-roles',async route=>{
   if(route.request().method()==='POST'){
    posts++;const input=route.request().postDataJSON();
    if(mode==='false')return route.fulfill({json:{ok:false,settings:input}});
    if(mode==='truthy')return route.fulfill({json:{ok:'true',settings:input}});
    if(mode==='missing')return route.fulfill({json:{ok:true}});
    if(mode==='mismatch')return route.fulfill({json:{ok:true,settings:saved}});
    if(mode==='html')return route.fulfill({contentType:'text/html',body:'<html>login</html>'});
    if(mode==='badrequest')return route.fulfill({status:400,json:{error:'Active members prevent role migration'}});
    if(mode==='denied')return route.fulfill({status:403,json:{error:'Access denied'}});
    if(mode==='lost'||mode==='bothfail')return route.fulfill({status:503,json:{error:'lost'}});
    if(mode==='appliedlost'){current=input;return route.fulfill({status:503,json:{error:'lost'}});}
    if(mode==='badrequestapplied'){current=input;return route.fulfill({status:400,json:{error:'audit failed after write'}});}
    if(mode==='delay'||mode==='timeout')await new Promise(resolve=>release=resolve);
    current=input;return route.fulfill({json:{ok:true,settings:current}});
   }
   reads++;
   if(mode==='badread')return route.fulfill({json:{ok:false,settings:saved,roles:[],botCanManageRoles:true,warning:null,guildName:'Test'}});
   if(mode==='bothfail'&&posts)return route.fulfill({status:503,json:{error:'offline'}});
   if(mode==='readfail'&&reads>1)return route.fulfill({status:503,json:{error:'offline'}});
   if(mode==='warning')return route.fulfill({json:overview(current,'offline')});
   if(mode==='deleted')return route.fulfill({json:overview(current,null,roles.filter(r=>r.id!==ids[0]))});
   if(mode==='large')return route.fulfill({json:overview(current,null,[...roles,...Array.from({length:247},(_,i)=>role(String(400000000000000000n+BigInt(i)),i===246?'ШИНКАР — Офіцер':'Role '+i))])});
   return route.fulfill({json:overview(current)});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await idle();
 }
 async function idle(){await page.waitForFunction(()=>window.inFlight===0);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
 const select=()=>page.locator('select').first();
 const save=()=>page.getByRole('button',{name:'Зберегти Discord-ролі',exact:true});
 const refresh=()=>page.getByRole('button',{name:'Оновити ролі',exact:true});
 const resultFocus=()=>page.evaluate(()=>document.activeElement.hasAttribute('data-action-result'));
 try{
  await setup('false');
  await check('false mutation acknowledgement never confirms a save or replays POST',async()=>{await select().selectOption(ids[2]);await save().click();await idle();observations.falseSuccess=await page.getByText('Discord-ролі Статика оновлено.',{exact:true}).count();if(baseline)assert.equal(observations.falseSuccess,1);else assert.equal(observations.falseSuccess,0);assert.equal(posts,1);});
  await setup('badread');
  await check('unconfirmed initial read cannot expose a valid configuration',async()=>{observations.badReadForm=await page.locator('select').count();if(baseline)assert.equal(observations.badReadForm,2);else assert.equal(observations.badReadForm,0);});
  await setup();
  await check('successful save focuses its persistent result after disabling the button',async()=>{await select().selectOption(ids[2]);await save().focus();await page.keyboard.press('Enter');await idle();observations.resultFocus=await resultFocus();if(!baseline)assert.equal(observations.resultFocus,true);else assert.equal(observations.resultFocus,false);});
  await setup();
  await check('dirty settings participate in shared live-refresh guards',async()=>{await select().selectOption(ids[2]);observations.dirty=await page.locator('form[data-dirty="true"]').count();assert.equal(observations.dirty,baseline?0:1);assert.equal(posts,0);});
  await setup('warning');
  await check('Discord warning has a GET-only refresh without reloading the page',async()=>{observations.refresh=await refresh().count();if(baseline)assert.equal(observations.refresh,0);else{assert.equal(observations.refresh,1);mode='ok';await refresh().click();await idle();assert.equal(await page.getByText(/Discord API: offline/).count(),0);assert.equal(posts,0);}});
  await setup('bothfail');
  await check('failed save recovery stops claiming it is still reading',async()=>{await select().selectOption(ids[2]);await save().click();await idle();observations.stuckRecovery=await page.getByText(/Відповідь не отримано. Перевіряємо збережені ролі/).count();assert.equal(observations.stuckRecovery,baseline?1:0);assert.equal(await select().inputValue(),ids[2]);assert.equal(posts,1);});
  await setup('deleted');
  await check('a deleted saved role stays explicitly visible as unavailable',async()=>{observations.missingRole=await select().locator('option').filter({hasText:/недоступна/}).count();assert.equal(observations.missingRole,baseline?0:1);});
  if(!baseline){
   await setup();
   await check('manual role refresh preserves the draft and sends no POST',async()=>{await select().selectOption(ids[2]);await refresh().click();await idle();assert.equal(await select().inputValue(),ids[2]);assert.equal(await page.locator('form[data-dirty="true"]').count(),1);assert.equal(posts,0);});
   await setup('readfail');
   await check('a failed refresh retains choices and successful retry clears only its error',async()=>{await select().selectOption(ids[2]);await refresh().click();await idle();assert.equal(await select().inputValue(),ids[2]);assert.equal(await page.getByRole('alert').count(),1);mode='ok';await refresh().click();await idle();assert.equal(await page.getByRole('alert').count(),0);assert.equal(await select().inputValue(),ids[2]);});
   await check('invalid or mismatched save confirmations reconcile by GET once',async()=>{for(const state of ['truthy','missing','mismatch','html']){await setup(state);await select().selectOption(ids[2]);await save().click();await idle();assert.equal(posts,1);assert.equal(reads,2);assert.equal(await page.getByText('Discord-ролі Статика оновлено.',{exact:true}).count(),0);assert.equal(await select().inputValue(),ids[2]);}});
   await setup('appliedlost');
   await check('lost response reconciles an applied setting without repeating POST',async()=>{await select().selectOption(ids[2]);await save().click();await idle();assert.equal(posts,1);assert.equal(reads,2);assert.equal(await page.locator('form[data-dirty="true"]').count(),0);await page.getByText('Збережені ролі відповідають вибраним. Повторне збереження не потрібне.',{exact:true}).waitFor();});
   await setup('delay');
   await check('save locks refresh and editing and preserves manually moved focus',async()=>{await select().selectOption(ids[2]);await save().click();await page.waitForFunction(()=>window.inFlight>0);assert.equal(await select().isDisabled(),true);assert.equal(await refresh().isDisabled(),true);assert.equal(await page.locator('[aria-busy="true"]').count()>0,true);await page.locator('#after').focus();release();await idle();assert.equal(await page.locator('#after').evaluate(el=>el===document.activeElement),true);assert.equal(posts,1);});
   await setup('timeout');
   await check('a timed-out POST aborts once and recovers through GET without replay',async()=>{await select().selectOption(ids[2]);await save().click();await page.waitForFunction(()=>window.abortedPosts===1);await idle();assert.equal(posts,1);assert.equal(reads,2);assert.equal(await select().isDisabled(),false);assert.equal(await select().inputValue(),ids[2]);release();});
   await setup('delay');
   await check('unmount cancels an outstanding POST and never starts recovery',async()=>{await select().selectOption(ids[2]);await save().click();await page.waitForFunction(()=>window.inFlight>0);await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>window.abortedPosts===1&&window.inFlight===0);assert.equal(posts,1);assert.equal(reads,1);release();});
   await setup('badrequest');
   await check('a rejected role migration retains the server reason after reconciliation',async()=>{await select().selectOption(ids[2]);await save().click();await idle();assert.equal(posts,1);assert.equal(reads,2);await page.getByText(/Active members prevent role migration/).waitFor();assert.equal(await select().inputValue(),ids[2]);});
   await setup('badrequestapplied');
   await check('HTTP 400 after an applied setting is reconciled without a second write',async()=>{await select().selectOption(ids[2]);await save().click();await idle();assert.equal(posts,1);assert.equal(reads,2);assert.equal(await page.locator('form[data-dirty="true"]').count(),0);await page.getByText('Збережені ролі відповідають вибраним. Повторне збереження не потрібне.',{exact:true}).waitFor();});
   await setup();
   await check('duplicate role choices cannot be submitted and hierarchy stays enforced',async()=>{await page.locator('select').nth(1).selectOption(ids[0]);assert.equal(await save().isDisabled(),true);await page.locator('select').nth(1).focus();await page.keyboard.press('Enter');await idle();assert.equal(posts,0);assert.equal(await select().locator('option[value="'+ids[1]+'"]').evaluate(el=>el.disabled),true);});
   await setup('denied');
   await check('a GET refresh never erases a rejected save result',async()=>{await select().selectOption(ids[2]);await save().click();await idle();await page.getByText('Access denied',{exact:true}).waitFor();mode='ok';await refresh().click();await idle();await page.getByText('Access denied',{exact:true}).waitFor();assert.equal(posts,1);});
   await setup();
   await check('Enter in local role search never submits dirty permissions',async()=>{await select().selectOption(ids[2]);await page.getByRole('searchbox',{name:'Пошук Discord-ролей'}).fill('Резерв');await page.keyboard.press('Enter');await idle();assert.equal(posts,0);assert.equal(await page.locator('form[data-dirty="true"]').count(),1);});
   await setup('large');
   await check('250-role local search supports Ukrainian and IDs and retains selected roles',async()=>{const before=reads;observations.unfilteredOptions=await page.locator('select option').count();assert.equal(observations.unfilteredOptions,502);const search=page.getByRole('searchbox',{name:'Пошук Discord-ролей'});await search.fill('шинкар');await idle();assert.equal(reads,before);assert.equal(posts,0);await select().locator('option').filter({hasText:'ШИНКАР'}).waitFor({state:'attached'});assert.equal(await select().inputValue(),ids[0]);observations.filteredOptions=await page.locator('select option').count();assert.ok(observations.filteredOptions<12);await search.fill(ids[2]);await idle();assert.equal(await select().locator('option[value="'+ids[2]+'"]').count(),1);await search.fill('nothingmatches');assert.equal(await select().inputValue(),ids[0]);await page.getByText('За пошуком ролей не знайдено.',{exact:true}).waitFor();});
   await setup();
   await check('responsive form fits nine widths without runtime errors',async()=>{for(const width of [320,360,390,480,640,768,1024,1440,1920]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'overflow '+width);}assert.deepEqual(errors,[]);});
  }
 }finally{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({baseline:Boolean(baseline),passed,failed,scenarios,observations,errors,browser:browser.version()},null,2));await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
