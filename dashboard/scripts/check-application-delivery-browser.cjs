const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const setup=require('./lib/application-delivery-fixture.cjs');
const root=path.resolve(__dirname,'..');
const esbuild=require(process.env.APPLICATION_QA_ESBUILD||'esbuild');
const {chromium}=require(process.env.APPLICATION_QA_PLAYWRIGHT||require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||root]}));
(async()=>{
 const f=await setup(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'application-delivery-browser-'));let server,browser,failRead=false,posts=0;
 try{
  const uncertain=await f.create();f.mode('lost');await f.worker.processApplicationDelivery(uncertain.item.number);const message=[...f.messages.values()].at(-1);f.mode('no-history');const pending=await f.create();
  const link=`https://discord.com/channels/333333333333333333/${message.channel_id}/${message.id}`;
  fs.writeFileSync(path.join(temp,'entry.tsx'),`import React from 'react';import {createRoot} from ${JSON.stringify(require.resolve('react-dom/client'))};import Delivery from ${JSON.stringify(path.join(root,'src/components/ApplicationDelivery.tsx'))};import ${JSON.stringify(path.join(root,'src/app/styles/tokens.css'))};import ${JSON.stringify(path.join(root,'src/app/styles/base.css'))};import ${JSON.stringify(path.join(root,'src/app/styles/components.css'))};import ${JSON.stringify(path.join(root,'src/app/styles/applications.css'))};createRoot(document.getElementById('root')).render(<Delivery number={window.__NUMBER}/>);`);
  await esbuild.build({entryPoints:[path.join(temp,'entry.tsx')],bundle:true,outfile:path.join(temp,'app.js'),jsx:'automatic',nodePaths:[path.join(root,'node_modules')],alias:{'@':path.join(root,'src')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
  server=http.createServer(async(req,res)=>{
   try{
    const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(req.url,origin);f.origin(origin);
    if(url.pathname==='/app.js'||url.pathname==='/app.css'){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css');return res.end(fs.readFileSync(path.join(temp,path.basename(url.pathname))));}
    const match=url.pathname.match(/^\/api\/applications\/(\d+)\/delivery$/);
    if(match){
     if(req.method==='POST')posts++;
     if(failRead&&req.method==='GET'){res.writeHead(503,{'Content-Type':'application/json'});return res.end('{"error":"Temporary failure"}');}
     const chunks=[];for await(const chunk of req)chunks.push(chunk);
     const request=new Request(url,{method:req.method,headers:req.headers,body:req.method==='GET'?undefined:Buffer.concat(chunks)});
     const response=await f.deliveryRoute[req.method](request,{params:Promise.resolve({number:match[1]})});res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    const number=url.searchParams.has('pending')?pending.item.number:uncertain.item.number;res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="uk"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><main id="root" style="max-width:420px;padding:16px;margin:auto"></main><script>window.__NUMBER=${number}</script><script src="/app.js"></script></html>`);
   }catch{res.writeHead(500);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.APPLICATION_QA_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin);await page.getByText('Потрібна звірка з Discord',{exact:true}).waitFor();assert.equal(posts,0);await page.evaluate(()=>window.__marker='preserved');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));console.log('PASS mobile delivery state loads independently without writes or overflow');
  await page.getByLabel('Посилання на вже створене повідомлення').fill('https://evil.test/not-discord');await page.getByRole('button',{name:'Звірити з Discord'}).click();await page.getByText('Потрібне повне HTTPS-посилання',{exact:false}).waitFor();assert.equal(await page.getByLabel('Посилання на вже створене повідомлення').inputValue(),'https://evil.test/not-discord');assert.equal(f.posts(),1);console.log('PASS invalid recovery link preserves the input and cannot create another Discord message');
  await page.getByLabel('Посилання на вже створене повідомлення').fill(link);await page.getByRole('button',{name:'Звірити з Discord'}).click();await page.getByText('Доставлено в Discord',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Відкрити повідомлення'}).getAttribute('href'),link);assert.equal(f.posts(),1);assert.equal(await page.evaluate(()=>window.__marker),'preserved');console.log('PASS manual recovery uses the real handler, receipt and PostgreSQL worker without navigation or another CREATE');
  failRead=true;await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?pending=1');await page.getByText('Стан доставки тимчасово недоступний.',{exact:false}).waitFor();failRead=false;await page.getByRole('button',{name:'Перевірити стан'}).click();await page.getByText('Очікує доставки',{exact:true}).waitFor();
  const before=posts;await page.getByRole('button',{name:'Повторити доставку'}).dblclick();await page.getByText('Доставлено в Discord',{exact:true}).waitFor();assert.equal(posts,before+1);assert.equal(f.posts(),2);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log('PASS desktop cold read outage recovers and a double click delivers once');
  console.log('[check-application-delivery-browser] OK — 4/4; real component, routes, PostgreSQL WASM and controlled Discord; no external messages');
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await f.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1)});
