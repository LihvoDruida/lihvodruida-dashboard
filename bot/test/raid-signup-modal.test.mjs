import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generateKeyPairSync,sign} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {decodeRaidSignupMenuId,raidSignupModalFor,interactionDomainFor} from '../../shared/index.mjs';
const guild='1977770001112223001',draft='a'.repeat(32),form=`mbv1:raid-form:${draft}:3:healer:0:going`;
test('raid form has native selectors and optional checkbox restoring false',()=>{
 const modal=raidSignupModalFor(form);assert.equal(modal.type,9);assert.equal(modal.data.components.length,3);assert.equal(modal.data.components[2].component.type,23);assert.equal(modal.data.components[2].component.default,false);assert.equal(modal.data.components[2].component.required,undefined);assert.equal(modal.data.components[1].component.options.find(x=>x.default).value,'healer');
 for(const id of [form,modal.data.custom_id,`mbv1:raid-menu:fixture00`,`mbv1:raid-draft:${draft}:3:manual`]){assert.equal(interactionDomainFor(id),'raid');assert.ok(id.length<=100)}
 for(const id of [form.replace(':healer:',':owner:'),form.replace(':3:',':999999999:'),'mbv1:raid-save:wrong:1'])assert.equal(decodeRaidSignupMenuId(id),null);
});
test('signed modal opens immediately and submission persists before ACK',async()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');let receipts=0,lastBody;
 const dashboard=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;res.setHeader('content-type','application/json');if(req.url==='/api/internal/discord/interaction-ingress'&&req.method==='POST'){receipts++;lastBody=JSON.parse(text);res.end(JSON.stringify({ok:true,created:true}));}else res.end(JSON.stringify({ok:true,jobs:[]}));});dashboard.listen(0,'127.0.0.1');await once(dashboard,'listening');
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn(process.execPath,[new URL('../src/server.mjs',import.meta.url).pathname],{stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DASHBOARD_INTERNAL_URL:`http://127.0.0.1:${dashboard.address().port}`,INTERNAL_API_TOKEN:'fixture-internal-token-'+'x'.repeat(40),DISCORD_PUBLIC_KEY:publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),DISCORD_GUILD_ID:guild,DISCORD_APPLICATION_ID:'1977770001112223000',DISCORD_GATEWAY_ENABLED:'0',BOT_LOG_SINK_LEVEL:'error'}});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 async function send(body){const raw=JSON.stringify(body),timestamp=String(Math.floor(Date.now()/1000)),signature=sign(null,Buffer.from(timestamp+raw),privateKey).toString('hex');return fetch(`http://127.0.0.1:${port}/discord/interactions`,{method:'POST',headers:{'content-type':'application/json','x-signature-ed25519':signature,'x-signature-timestamp':timestamp},body:raw,signal:AbortSignal.timeout(5000)})}
 try{
  let ready=false;for(let i=0;i<100;i++){if((await fetch(`http://127.0.0.1:${port}/healthz`).catch(()=>null))?.ok){ready=true;break}await wait(20)}assert.ok(ready,output);
  const click={id:'1977770001112224401',type:3,guild_id:guild,token:'fixture-token',message:{flags:64},data:{custom_id:form}};
  const start=performance.now(),r=await send(click);assert.equal(r.status,200);const modal=await r.json();assert.equal(modal.type,9);assert.ok(performance.now()-start<1800);assert.equal(receipts,0);
  const rejected=await send({...click,id:'1977770001112224402',message:{flags:0}});assert.equal((await rejected.json()).type,4);assert.equal(receipts,0);
  const submitted={...click,id:'1977770001112224403',type:5,data:{custom_id:modal.data.custom_id,components:[{type:18,component:{type:23,custom_id:'raid_reminder',value:false}}]}};
  const ack=await send(submitted);assert.equal(ack.status,200);assert.equal((await ack.json()).type,6);assert.equal(receipts,1);assert.equal(JSON.parse(lastBody.rawBody).type,5);assert.equal(JSON.parse(lastBody.rawBody).data.components[0].component.value,false);
  const unknown=await send({...submitted,id:'1977770001112224404',data:{custom_id:'unrelated-modal'}});assert.equal((await unknown.json()).type,4);assert.equal(receipts,1);
 }finally{const exit=once(child,'exit');child.kill('SIGTERM');await exit;await new Promise(r=>dashboard.close(r))}
});

test('signed raid-modal click fetches personalized native modal without ingress or public message edit',async()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');let renders=0,ingress=0;
 const dashboard=createServer(async(req,res)=>{
  for await(const _chunk of req){};
  res.setHeader('content-type','application/json');
  if(req.url==='/api/internal/discord/raid-modal'){
   renders++;
   res.end(JSON.stringify({type:9,data:{custom_id:`mbv1:raid-save:${draft}:0:character:0`,title:'Запис у рейд',components:[{type:18,label:'Персонаж',component:{type:3,custom_id:'raid_character',options:[{label:'Fixture',value:'0'}]}}]}}));
  }else{if(req.url==='/api/internal/discord/interaction-ingress'&&req.method==='POST')ingress++;res.end(JSON.stringify({ok:true,jobs:[]}));}
 });dashboard.listen(0,'127.0.0.1');await once(dashboard,'listening');
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn(process.execPath,[new URL('../src/server.mjs',import.meta.url).pathname],{stdio:'ignore',env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DASHBOARD_INTERNAL_URL:`http://127.0.0.1:${dashboard.address().port}`,INTERNAL_API_TOKEN:'fixture-internal-token-'+'x'.repeat(40),DISCORD_PUBLIC_KEY:publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex'),DISCORD_GUILD_ID:guild,DISCORD_APPLICATION_ID:'1977770001112223000',DISCORD_GATEWAY_ENABLED:'0',BOT_LOG_SINK_LEVEL:'error'}});
 async function send(id,flags){const body=JSON.stringify({id,type:3,guild_id:guild,token:'fixture-token',message:{flags},data:{custom_id:`mbv1:raid-modal:${draft}:0:character:0`}}),timestamp=String(Math.floor(Date.now()/1000)),signature=sign(null,Buffer.from(timestamp+body),privateKey).toString('hex');return fetch(`http://127.0.0.1:${port}/discord/interactions`,{method:'POST',headers:{'content-type':'application/json','x-signature-ed25519':signature,'x-signature-timestamp':timestamp},body,signal:AbortSignal.timeout(5000)})}
 try{
  let ready=false;for(let i=0;i<100;i++){if((await fetch(`http://127.0.0.1:${port}/healthz`).catch(()=>null))?.ok){ready=true;break}await wait(20)}assert.ok(ready);
  const response=await send('1977770001112227701',64);assert.equal(response.status,200);const modal=await response.json();assert.equal(modal.type,9);assert.equal(modal.data.components[0].component.custom_id,'raid_character');assert.equal(renders,1);assert.equal(ingress,0);
  const invalid=await send('1977770001112227702',0);assert.equal((await invalid.json()).type,4);assert.equal(renders,1);
 }finally{const exit=once(child,'exit');child.kill('SIGTERM');await exit;await new Promise(r=>dashboard.close(r));}
});
