const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const loader=require('./lib/load-server-ts.cjs');
const contract=require('../../shared/index.mjs');
const load=(file,mocks={},globals={})=>loader(file,mocks,{Error,URL,URLSearchParams,Request,Response,Headers,TextEncoder,ReadableStream,crypto:require('node:crypto').webcrypto,...globals}).exports;
function deps(file){const out={};const ast=ts.createSourceFile(file,fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ts.ScriptTarget.Latest,true);for(const item of ast.statements)if((ts.isImportDeclaration(item)||ts.isExportDeclaration(item))&&item.moduleSpecifier){const name=item.moduleSpecifier.text;if(!name.startsWith('node:'))out[name]=new Proxy({}, {get:(_v,k)=>()=>{throw Error('Unexpected dependency '+name+'.'+String(k))}})}return out;}
function storage(){
 const rows=new Map();let tail=Promise.resolve(),offline=false;
 const key=r=>r.collection+'/'+r.id;
 const snapshot=r=>({id:r.id,ref:r,exists:rows.has(key(r)),data:()=>structuredClone(rows.get(key(r)))});
 const ref=(collection,id)=>({collection,id,get:async()=>{if(offline)throw Error('offline');return snapshot({collection,id})},set:async(data,opts)=>rows.set(collection+'/'+id,{...(opts?.merge?rows.get(collection+'/'+id):{}),...structuredClone(data)}),delete:async()=>rows.delete(collection+'/'+id)});
 const db={collection:collection=>({doc:id=>ref(collection,id),where:()=>({limit:()=>({get:async()=>({docs:[]})})})}),runTransaction(fn){const promise=tail.then(async()=>{if(offline)throw Error('offline');let wrote=false;const writes=[];const value=await fn({get:async r=>{assert.equal(wrote,false,'Firestore transaction read after write');return snapshot(r)},set:(r,data,opts)=>{wrote=true;writes.push(()=>rows.set(key(r),{...(opts?.merge?rows.get(key(r)):{}),...structuredClone(data)}))},delete:r=>{wrote=true;writes.push(()=>rows.delete(key(r)))}});for(const write of writes)write();return value});tail=promise.catch(()=>{});return promise}};
 return {db,rows,offline:v=>offline=v};
}
const user='111111111111111111',other='222222222222222222',guild='333333333333333333',profileId='id'+'a'.repeat(24);
function fixture(){
 const store=storage();let profile=null,dm=0;
 const pref=load('src/lib/discordNotificationPreferences.ts',{'@/lib/firebaseAdmin':{getFirebaseAdminDb:()=>store.db}});
 const values=load('src/lib/values.ts'),roles=load('src/lib/wowRoles.ts'),catalog=load('src/lib/wowClassCatalog.ts'),chars=load('src/lib/wowCharacters.ts',{crypto:require('node:crypto')});
 const mocks={...deps('src/lib/raids.ts'),'@mistblossom/discord-contract':contract,'@/lib/discordNotificationPreferences':pref,'@/lib/firebaseAdmin':{getFirebaseAdminDb:()=>store.db,hasFirebaseProfileConfig:()=>true},
 '@/lib/db/firestoreCompat':{FieldValue:{serverTimestamp:()=>new Date().toISOString()}},'@/lib/values':values,'@/lib/wowRoles':roles,'@/lib/wowCharacters':chars,'@/lib/wowClassCatalog':catalog,
 '@/lib/raidCompositionAlgorithm':load('src/lib/raidCompositionAlgorithm.ts'),
 '@/lib/raidPartyShared':load('src/lib/raidPartyShared.ts',{'@/lib/raidCompositionAlgorithm':load('src/lib/raidCompositionAlgorithm.ts')}),
 '@/lib/raidThumbnailAssets':{normalizeRaidThumbnailDifficulty:v=>v||'normal',defaultRaidThumbnailPath:()=>'/raid.png',cleanRaidImageUrl:()=>null},
 '@/lib/concurrency':load('src/lib/concurrency.ts'),
 '@/lib/security':{getCanonicalDashboardOrigin:()=> 'https://guild.test'},
 '@/lib/firebaseAccess':{firebaseRead:async(_t,_k,fn)=>fn(),firebaseWrite:async(_t,_k,fn)=>fn()},
 '@/lib/runtimeResilience':{getRuntimeCachedValue:()=>null,setRuntimeCachedValue(){},clearRuntimeCachedValue(){},clearRuntimeCachedValuesByPrefix(){}},
 '@/lib/profiles':{getProfileByDiscordUserIdForInteraction:async()=>profile,getProfilePublicName:p=>p.displayName,cleanProfileGrammaticalGender:v=>v||'unspecified',profileGenderedText:(_g,_m,_f,n)=>n,getMainCharacter:p=>p?.characters?.[0]},
 '@/lib/discordInteractionStorage':{resolveDiscordInteractionDocument:async({resourceId})=>{const data=store.rows.get('dashboardRaids/'+resourceId);return data?{id:resourceId,data,source:'fixture'}:null}},
 '@/lib/discordAdmin':{getDiscordGuildId:()=>guild,fetchDiscordGuildMemberSnapshot:async()=>{throw Error('no Discord network')},parseDiscordMessageRef:()=>null,sendDiscordDirectMessage:async params=>{await params.beforeSend?.();dm++;}},
 };
 const raids=load('src/lib/raids.ts',mocks,{process:{env:{DISCORD_GUILD_ID:guild}},setTimeout:(fn,delay)=>setTimeout(fn,Math.min(delay,1))});
 const raid={id:'fixture00',title:'Fixture Raid',difficulty:'normal',date:'2099-10-15',time:'19:00',status:'published',createdByDiscordId:user,createdByName:'fixture',signups:[],composition:{tanks:2,healers:2,dps:6}};
 store.rows.set('dashboardRaids/fixture00',raid);
 function memberProfile(){return {profileId,provider:'discord',providerUserId:user,displayName:'Fixture',characters:[{key:'eu:terokkar:fixture',name:'Fixture',realmSlug:'terokkar',className:'Druid',activeSpecName:'Restoration',itemLevel:1}],grammaticalGender:'unspecified',discordRoleIds:[]};}
 const act=async(customId,values,actor=user,type=3,components)=>raids.handleRaidSignupMenuInteraction({customId,userId:actor,userName:'Fixture',guildId:guild,interaction:{id:'444444444444444444',type,data:{custom_id:customId,values,components},guild_id:guild}});
 const find=(result,kind)=>result.components.flatMap(r=>r.components).find(c=>c.custom_id?.includes(':raid-'+kind+':'));
 const chooseId=(result,kind)=>result.components.flatMap(r=>r.components).find(c=>c.custom_id?.endsWith(':'+kind)).custom_id;
 const fields=(enabled=false,role='healer',status='going')=>[{type:18,component:{type:3,custom_id:'attendance',values:[status]}},{type:18,component:{type:3,custom_id:'role',values:[role]}},{type:18,component:{type:23,custom_id:'raid_reminder',value:enabled}}];
 const profileModule=()=>load('src/lib/profiles.ts',{...deps('src/lib/profiles.ts'),'@/lib/discordNotificationPreferences':pref,'@/lib/firebaseAdmin':{getFirebaseAdminDb:()=>store.db,hasFirebaseProfileConfig:()=>true},'@/lib/db/firestoreCompat':mocks['@/lib/db/firestoreCompat'],'@/lib/firebaseAccess':mocks['@/lib/firebaseAccess'],'@/lib/runtimeResilience':mocks['@/lib/runtimeResilience'],'@/lib/permissions':{dashboardRoleRank:()=>10},'@/lib/values':values,'@/lib/wowCharacters':chars,'@/lib/wowRoles':roles});
 const ready=async(mode='manual',page=0)=>{const result=await act('mbv1:raid-menu:fixture00');const button=result.components.flatMap(r=>r.components).find(c=>c.custom_id?.endsWith(`:${mode}:${page}`));assert.ok(button,`missing modal launcher for ${mode}/${page}`);const modal=await raids.prepareRaidSignupModal({customId:button.custom_id,userId:user,guildId:guild});return {result,modal,button};};

 return {...store,pref,raids,mocks,act,find,chooseId,fields,ready,profileModule,profile:v=>profile=v,memberProfile,dm:()=>dm};
}
const watchdog=setTimeout(()=>{console.error('Raid modal checks timed out');process.exit(1)},30000);
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name)}
function fields(modal,enabled=false,attendance='going',role='healer',index){
 const data=modal.data.components;
 const selection=data[0].component;
 const selected=index??Number(selection.options[0].value);
 const items=[{type:18,component:{type:3,custom_id:selection.custom_id,values:[String(selected)]}},
  {type:18,component:{type:3,custom_id:'attendance',values:[attendance]}}];
 if(selection.custom_id==='raid_character')items.push({type:18,component:{type:3,custom_id:'role',values:[role]}});
 items.push({type:18,component:{type:23,custom_id:'raid_reminder',value:enabled}});
 return items;
}
async function submit(f,modal,enabled=false,attendance='going',role='healer',index,actor=user){return f.act(modal.data.custom_id,[],actor,5,fields(modal,enabled,attendance,role,index))}
(async()=>{
 await check('public embed exposes only the modal launcher',()=>{const f=fixture();const rows=f.raids.buildRaidAttendanceComponents('fixture00');assert.equal(rows[0].components.length,1);assert.equal(rows[0].components[0].custom_id,'mbv1:raid-menu:fixture00')});
 await check('anonymous Discord member gets manual modals without a site account',async()=>{const f=fixture();const {result,modal}=await f.ready();assert.match(result.content,/модальну форму/);assert.ok(!result.components.flatMap(r=>r.components).some(c=>c.type===3));assert.equal(modal.type,9);assert.ok(modal.data.components[0].component.options.some(o=>/Druid/.test(o.label)));assert.equal(modal.data.components.at(-1).component.default,true);assert.equal(f.rows.get('dashboardRaids/fixture00').signups.length,0)});
 await check('modal launch cannot edit someone else’s draft or choose a foreign guild',async()=>{const f=fixture();const {button}=await f.ready();await assert.rejects(f.raids.prepareRaidSignupModal({customId:button.custom_id,userId:other,guildId:guild}),/іншому/);await assert.rejects(f.raids.prepareRaidSignupModal({customId:button.custom_id,userId:user,guildId:other}),/сервер/)});
 await check('manual spec role is inferred on save and opt-out is atomic',async()=>{const f=fixture();const {modal}=await f.ready();const choice=modal.data.components[0].component.options.find(o=>o.label==='Druid · Balance');assert.ok(choice);const saved=await submit(f,modal,false,'going','healer',Number(choice.value));assert.equal(saved.ok,true,saved.content);const stored=f.rows.get('dashboardRaids/fixture00').signups[0];assert.equal(stored.manualClassKey,'druid');assert.equal(stored.manualSpecKey,'balance');assert.equal(stored.role,'dps');assert.equal((await f.pref.getRaidReminderPreference(user)).enabled,false)});
 await check('character modal shows character and explicit raid role',async()=>{const f=fixture();f.profile(f.memberProfile());const {modal}=await f.ready('character');assert.equal(modal.data.components[0].component.custom_id,'raid_character');assert.equal(modal.data.components.length,4);const saved=await submit(f,modal,true,'going','tank');assert.equal(saved.ok,true,saved.content);assert.equal(f.rows.get('dashboardRaids/fixture00').signups[0].role,'tank');assert.equal(f.rows.get('dashboardRaids/fixture00').signups[0].characterName,'Fixture')});
 await check('malformed and duplicate modal fields are rejected',async()=>{const f=fixture();const {modal}=await f.ready();const values=fields(modal,false);assert.equal(f.raids.raidSignupModalValues(values,'manual').reminderEnabled,false);assert.throws(()=>f.raids.raidSignupModalValues(values.slice(0,2),'manual'));assert.throws(()=>f.raids.raidSignupModalValues([...values,values[1]],'manual'));const invalid=fields(modal,false);invalid[0].component.values=['999'];await assert.rejects(f.act(modal.data.custom_id,[],user,5,invalid),/сторінці/)});
 await check('modal confirmation is single use',async()=>{const f=fixture();const {modal}=await f.ready();const one=await submit(f,modal,true);assert.equal(one.ok,true,one.content);await assert.rejects(submit(f,modal,false),/застаріло/);assert.equal(f.rows.get('dashboardRaids/fixture00').signups.length,1)});
 await check('stale draft cannot overwrite another signup and its reminder preference',async()=>{const f=fixture();const first=await f.ready(),second=await f.ready();assert.equal((await submit(f,first.modal,false)).ok,true);const stale=await submit(f,second.modal,true);assert.equal(stale.ok,false);assert.equal((await f.pref.getRaidReminderPreference(user)).enabled,false)});
 await check('closed raid cannot commit attendance or reminder opt-out',async()=>{const f=fixture();const {modal}=await f.ready();f.rows.get('dashboardRaids/fixture00').status='closed';const result=await submit(f,modal,false);assert.equal(result.ok,false);assert.equal((await f.pref.getRaidReminderPreference(user)).enabled,true);assert.equal(f.rows.get('dashboardRaids/fixture00').signups.length,0)});
 await check('character pagination preserves opaque index and mode selection',async()=>{const f=fixture(),p=f.memberProfile();p.characters=Array.from({length:30},(_,i)=>({...p.characters[0],key:'eu:terokkar:char'+i,name:'Char'+i}));f.profile(p);const {modal}=await f.ready('character',1);assert.equal(modal.data.components[0].component.options.length,5);const chosen=29;const result=await submit(f,modal,true,'going','healer',chosen);assert.equal(result.ok,true,result.content);assert.equal(f.rows.get('dashboardRaids/fixture00').signups[0].characterName,'Char29')});
 await check('pre-registration opt-out remains attached to Discord ID and independent of site account',async()=>{const f=fixture();await f.pref.setRaidReminderPreference(user,false);const {modal}=await f.ready();assert.equal(modal.data.components.at(-1).component.default,false);assert.equal((await f.pref.getRaidReminderPreference(other)).enabled,true)});
 await check('DM worker does not message opted-out or skipped members',async()=>{const f=fixture();await f.pref.setRaidReminderPreference(user,false);const raid={...f.rows.get('dashboardRaids/fixture00'),signups:[{discordId:user,status:'going',discordName:'Fixture'},{discordId:other,status:'tentative',discordName:'Other'},{discordId:'555555555555555555',status:'skipped',discordName:'Skip'}]};const result=await f.raids.sendRaidReminderDirectMessages(raid);assert.equal(result.sent,1);assert.equal(f.dm(),1)});
 await check('legacy Discord interactions re-open modal chooser without saving',async()=>{const f=fixture();const old=await f.act('mbv1:raid-menu:fixture00');const selectId=`mbv1:raid-draft:${contract.decodeRaidSignupMenuId(old.components[0].components[0].custom_id).draftId}:0:manual`;const migrated=await f.act(selectId);assert.ok(migrated.components[0].components[0].custom_id.includes(':raid-modal:'));assert.equal(f.rows.get('dashboardRaids/fixture00').signups.length,0)});
 console.log(`[check-raid-signup-menu] ${passed}/${passed} passed`);
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>clearTimeout(watchdog));
