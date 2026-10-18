const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const root=path.resolve(__dirname,'..'),site=path.resolve(process.env.PAIRED_SITE_ROOT||'../../lihvodruida-site');
const modules=[root,site,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||root];
const {chromium}=require(require.resolve('playwright',{paths:modules})),esbuild=require(require.resolve('esbuild',{paths:modules}));
const output=fs.mkdtempSync(path.join(os.tmpdir(),'guild-streamers-ui-'));let server,browser;
const mid='234567890123456789',cid='123456789012345678';
let view={settings:{enabled:false,siteEnabled:true,discordEnabled:false,channelId:'',revision:'initial'},accounts:[],readiness:{twitch:true,youtube:true,tiktok:true},channels:[{id:cid,name:'streams'}],events:[]},live=false,failed=false,expires=0,posts=[];
(async()=>{
 fs.writeFileSync(path.join(output,'entry.tsx'),`import React from 'react';import{createRoot}from'react-dom/client';import Panel from '${path.join(root,'src/components/streamers/StreamerSettings.tsx')}';import{LiveStreams}from '${path.join(site,'src/components/LiveStreams.tsx')}';createRoot(document.getElementById('app')).render(location.pathname==='/admin'?<main className='container admin-container'><div className='dashboard-shell content-shell admin-workspace'><Panel/></div></main>:<><main style={{height:2400,padding:24}}><h1>Головна сторінка</h1><p>Перший екран</p></main><LiveStreams/></>);`);
 await esbuild.build({entryPoints:[path.join(output,'entry.tsx')],outfile:path.join(output,'app.js'),bundle:true,platform:'browser',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],alias:{'react':path.join(root,'node_modules/react'),'react-dom':path.join(root,'node_modules/react-dom'),'@/lib/streamers/contract':path.join(root,'src/lib/streamers/contract.ts'),'@/lib/streamers-contract':path.join(site,'src/lib/streamers-contract.ts'),'@/lib/client-api':path.join(site,'src/lib/client-api.ts'),'@/lib/sync-contract':path.join(site,'src/lib/sync-contract.ts')},define:{'process.env.NODE_ENV':'"production"'}});
 const layout=fs.readFileSync(path.join(root,'src/app/layout.tsx'),'utf8');const css=[...layout.matchAll(/import \"(.+?\.css)\"/g)].map(m=>fs.readFileSync(path.resolve(root,'src/app',m[1]),'utf8')).join('\n')+fs.readFileSync(path.join(root,'src/app/dashboard/streamers/streamers.css'),'utf8');const siteCss=fs.readFileSync(path.join(site,'src/app/globals.css'),'utf8');
 server=http.createServer(async(req,res)=>{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'app.js')));}
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/dashboard/streamers'){
   if(req.method==='GET')return res.end(JSON.stringify(view));
   const chunks=[];for await(const c of req)chunks.push(c);const data=JSON.parse(Buffer.concat(chunks));posts.push(data);
   if(data.action==='settings')view.settings={...data,revision:'saved'};
   if(data.action==='save'){const a={...data,id:data.id||'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',revision:'account-saved',channelUrl:'https://www.twitch.tv/sebas',handle:'sebas',memberName:'Sebas',authorized:false,status:'ok',checkedAt:Date.now(),live:null};view.accounts=view.accounts.filter(v=>v.id!==a.id).concat(a);}
   if(data.action==='delete')view.accounts=view.accounts.filter(v=>v.id!==data.id);
   return res.end(JSON.stringify({ok:true}));
  }
  if(req.url==='/site-api/v1/streamers'){
   if(failed){res.statusCode=503;return res.end('{"error":"unavailable"}');}
   return res.end(JSON.stringify({data:{schema:'mistblossom.public-streamers.v1',checked_at:new Date().toISOString(),items:live?[{id:'one',memberName:'Sebas',platform:'twitch',channelUrl:'https://www.twitch.tv/sebas',live:{id:'123',title:'Рейд гільдії',url:'https://www.twitch.tv/sebas',publishedAt:new Date().toISOString()},expiresAt:new Date(expires).toISOString()}]:[]},sync:{source:'dashboard',stale:false,checkedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}}));
  }
  res.setHeader('Content-Type','text/html');res.end(`<html lang="uk"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${req.url==='/admin'?css:siteCss}</style></head><body style="padding:20px"><div id="app"></div><script src="/app.js"></script></body></html>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.SITE_QA_CHROMIUM,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/admin');await page.getByRole('heading',{name:'Додати канал учасника'}).waitFor();
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.locator('[name=memberId]').fill(mid);await page.locator('[name=channel]').fill('sebas');await page.getByRole('button',{name:'Додати канал',exact:true}).click();await page.getByRole('heading',{name:'Sebas · Twitch'}).waitFor();assert.equal(posts.at(-1).platform,'twitch');assert.equal(posts.at(-1).notifyLive,true);
 await page.getByRole('button',{name:'Редагувати',exact:true}).click();await page.getByRole('heading',{name:'Редагувати канал'}).waitFor();assert.equal(await page.locator('[name=memberId]').inputValue(),mid);await page.getByRole('button',{name:'Скасувати',exact:true}).click();
 await page.getByRole('combobox',{name:'Платформа',exact:true}).selectOption('tiktok');await page.getByText('TikTok: нові відео, без автоматичного LIVE.').waitFor();assert.equal(await page.locator('[name=notifyLive]').count(),0);assert.equal(await page.locator('[name=siteEnabled]').last().isDisabled(),true);assert.equal(await page.locator('[name=accessToken]').getAttribute('type'),'password');
 await page.locator('input[name=enabled]').first().check();await page.locator('input[name=discordEnabled]').check();await page.locator('select[name=channelId]').selectOption(cid);await page.getByRole('button',{name:'Зберегти налаштування'}).click();await page.waitForFunction(()=>document.querySelector('select[name=channelId]')?.value==='123456789012345678');assert.equal(posts.at(-1).discordEnabled,true);
 page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Видалити',exact:true}).click();await page.getByText('Додай перший канал учасника.').waitFor();
 if(process.env.STREAMER_QA_SCREENSHOTS){fs.mkdirSync(process.env.STREAMER_QA_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.STREAMER_QA_SCREENSHOTS,'admin-streamers.png'),fullPage:true});}
 console.log('PASS admin UI: create/edit/delete, settings/channel, TikTok capability and secret fields; 320/390/1440px');
 await page.addInitScript(()=>{const timeout=window.setTimeout,interval=window.setInterval;window.setTimeout=(fn,ms,...args)=>timeout(fn,ms>=28000&&ms<=300000?100:ms,...args);window.setInterval=(fn,ms,...args)=>interval(fn,ms===10000?100:ms,...args);});
 await page.goto(base+'/');assert.equal(await page.locator('.live-streams').count(),0);await page.evaluate(()=>scrollTo({top:600,behavior:'instant'}));const at=await page.evaluate(()=>scrollY);
 live=true;expires=Date.now()+300000;await page.getByRole('link',{name:/Sebas/}).waitFor();assert.equal(await page.evaluate(()=>scrollY),at);assert.equal(await page.locator('.live-streams a').getAttribute('target'),'_blank');
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.getByRole('button',{name:'Згорнути трансляції'}).click();assert.equal(await page.locator('#guild-live-streams').isVisible(),false);await page.getByRole('button',{name:'Показати трансляції'}).click();assert.equal(await page.locator('#guild-live-streams').isVisible(),true);
 if(process.env.STREAMER_QA_SCREENSHOTS)await page.screenshot({path:path.join(process.env.STREAMER_QA_SCREENSHOTS,'site-streamers.png')});
 failed=true;await page.getByText('Оновлення затримується. Статус показано за останньою перевіркою.').waitFor();
 failed=false;expires=Date.now()+700;await page.waitForTimeout(1400);assert.equal(await page.locator('.live-streams').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS public LIVE UI: background arrival without page jump, collapse, links, retry status and expired LIVE removal; no browser errors');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server?.close(r));fs.rmSync(output,{recursive:true,force:true});});
