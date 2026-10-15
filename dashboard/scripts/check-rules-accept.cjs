const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const load = require('./lib/load-server-ts.cjs');
const read = file => fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const role='111111111111111111', user='222222222222222222', guild='333333333333333333';
const tokens = load('src/lib/rulesOnboarding.ts', {
 crypto, '@/lib/db/firestoreCompat':{}, '@/lib/oauth':{getDashboardUrl:()=> 'https://guild.test'},
 '@/lib/firebaseAdmin':{}, '@/lib/firebaseAccess':{}, '@/lib/profiles':{}, '@/lib/wowRoles':{},
}, {process:{env:{NODE_ENV:'production',DASHBOARD_RULES_TOKEN_SECRET:'fixture-rules-key-with-at-least-32-characters'}}}).exports;
const expiredPayload=Buffer.from(JSON.stringify({v:2,aud:'mistblossom-rules-onboarding',iat:Math.floor(Date.now()/1000)-3600,exp:Math.floor(Date.now()/1000)-60,r:[role],u:user,g:guild})).toString('base64url');
const expiredToken=expiredPayload+'.'+crypto.createHmac('sha256','fixture-rules-key-with-at-least-32-characters').update(expiredPayload).digest('base64url');
const token=options=>tokens.createRulesRoleToken([role],{discordUserId:user,discordGuildId:guild,...options});
const message={id:'444444444444444444',rulesType:'guild',roleIds:[role],content:'Будьмо ввічливими.',embed:{title:'Правила',description:'## Повага\nПоважай інших.',fields:[{name:'Спілкування',value:'Без образ.'}]}};
let messages=[message];
const docs=load('src/lib/guildRulesDocument.ts',{
 '@/lib/discordAdmin':{listRulesEmbedMessages:async()=>messages},
 '@/lib/discordGuildLinks':{MISTBLOSSOM_DISCORD_CHANNELS:{rules:{id:'555555555555555555'}}},
 '@/lib/rulesAcceptanceSettings':{getPublicRulesMessageUrl:async()=>null},
}).exports;
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS',name);}
function rig(options={}){
 const calls=[];
 const route=load('src/app/api/rules/accept/complete/route.ts',{
  'next/server':{NextResponse:{redirect:(url,status)=>({status,location:String(url),headers:new Headers()})}},
  '@/lib/apiRoute':{appBaseUrl:()=> 'https://guild.test'},
  '@/lib/rulesOnboarding':tokens,
  '@/lib/guildRulesDocument':{getGuildRulesDocument:async()=>options.noDocument?null:options.documentFailure?Promise.reject(Error('offline')):docs.getGuildRulesDocument([role])},
  '@/lib/discordRulesRolePolicy':{tokenRulesRolesAreCurrentlyAllowed:async()=>{if(options.policyFailure)throw Error('offline');return !options.revoked;}},
  '@/lib/discordAdmin':{
   getDiscordGuildId:()=>guild,
   fetchDiscordRoles:async()=> options.deletedRole?[]:[{id:role}],
   fetchDiscordGuildMemberSnapshot:async id=>{calls.push(['member',id]);if(options.memberMissing)throw Error('Discord API 404 Unknown Member 10007');if(options.memberFailure)throw Error('Discord API 503');return {roleIds:options.already?[role]:[],displayName:'Fixture'};},
   addGuildMemberRoles:async value=>{calls.push(['grant',value]);if(options.grantFailure)throw Error('Discord API 403');},
  },
  '@/lib/discordNicknameWarnings':{processNewcomerNicknameRoleGrant:async()=>calls.push(['nickname'])},
  '@/lib/discordNewcomerOnboarding':{markDiscordNewcomerRulesAccepted:async()=>calls.push(['onboarding'])},
  '@/lib/geoAccessPolicy':{checkGeoAccess:async()=>({blocked:Boolean(options.geo)})},
  '@/lib/discordRulesStats':{recordRulesDecision:async value=>calls.push(['record',value])},
  '@/lib/security':{verifyTrustedOrigin:()=>!options.csrf,forbiddenResponse:()=>({status:403}),assertRequestBodySize:()=>options.large?{}:null,checkRateLimit:()=>({ok:!options.rate}),getClientIp:()=> '127.0.0.1',logDashboardEvent(){},safeErrorMessage:error=>error.message,applyNoStoreHeaders:response=>response.headers.set('cache-control','no-store')},
 },{URL,Headers,FormData}).exports;
 return {calls,async post(values={}){const revision=docs.guildRulesDocumentFromMessages(messages,[role])?.revision;const fields=new Map(Object.entries({rt:token(),agree:'yes',revision,...values}));return route.POST({url:'http://internal:3000/api/rules/accept/complete',headers:new Headers(),formData:async()=>fields});}};
}
(async()=>{
 await check('published editor description, content and fields form the website document',()=>{const doc=docs.guildRulesDocumentFromMessages(messages,[role]);assert.ok(doc.markdown.includes('Без образ.'));assert.ok(doc.markdown.includes('Будьмо ввічливими.'));assert.equal(doc.title,'Правила');});
 await check('raid rules and unrelated role publications cannot become guild rules',()=>{assert.equal(docs.guildRulesDocumentFromMessages([{...message,rulesType:'raid'}],[role]),null);assert.equal(docs.guildRulesDocumentFromMessages(messages,['999999999999999999']),null);});
 await check('editor changes immediately alter both website text and acceptance revision',async()=>{const before=await docs.getGuildRulesDocument([role]);messages=[{...message,embed:{...message.embed,description:'Оновлені правила'}}];const after=await docs.getGuildRulesDocument([role]);assert.notEqual(before.revision,after.revision);assert.ok(after.markdown.includes('Оновлені'));messages=[message];});
 await check('valid personal token accepts without session or profile dependencies',async()=>{const x=rig(),r=await x.post();assert.equal(new URL(r.location).searchParams.get('status'),'completed_public');assert.equal(r.status,303);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(x.calls.find(v=>v[0]==='grant')[1].userId,user);assert.equal(x.calls.find(v=>v[0]==='record')[1].scope,'guild');});
 for(const [name,options,fields,status] of [
  ['explicit checkbox required',{}, {agree:''},'agreement_required'],
  ['missing token rejected',{}, {rt:''},'missing_role_token'],
  ['tampered token rejected',{}, {rt:token()+'x'},'missing_role_token'],
  ['expired signed token rejected',{}, {rt:expiredToken},'missing_role_token'],
  ['other guild rejected',{}, {rt:token({discordGuildId:'666666666666666666'})},'discord_guild_mismatch'],
  ['generic token never falls through to a website account',{}, {rt:token({discordUserId:''})},'discord_user_missing'],
  ['revoked role rejected',{revoked:true},{},'discord_role_not_allowed'],
  ['role policy outage fails closed',{policyFailure:true},{},'discord_role_not_allowed'],
  ['deleted Discord role rejected',{deletedRole:true},{},'discord_role_missing'],
  ['missing Discord member rejected',{memberMissing:true},{},'discord_member_missing'],
  ['transient member outage remains retryable',{memberFailure:true},{},'failed'],
  ['missing document cannot grant',{noDocument:true},{},'rules_unavailable'],
  ['document outage cannot grant',{documentFailure:true},{},'rules_unavailable'],
  ['stale displayed revision cannot grant',{}, {revision:'old'},'rules_changed'],
  ['rate limit prevents grants',{rate:true},{},'rate_limit'],
  ['region policy still enforced',{geo:true},{},'geo_blocked'],
  ['oversized body prevented',{large:true},{},'request_too_large'],
 ]) await check(name,async()=>{const x=rig(options),r=await x.post(fields);assert.equal(new URL(r.location).searchParams.get('status'),status);assert.equal(x.calls.some(v=>v[0]==='grant'),false);});
 await check('untrusted origin blocked before processing',async()=>{const x=rig({csrf:true});assert.equal((await x.post()).status,403);assert.equal(x.calls.length,0);});
 await check('repeated acceptance skips existing role grants',async()=>{const x=rig({already:true});assert.equal(new URL((await x.post()).location).searchParams.get('status'),'completed_public');assert.equal(x.calls.some(v=>v[0]==='grant'),false);});
 await check('role grant failure never records successful acceptance',async()=>{const x=rig({grantFailure:true});assert.equal(new URL((await x.post()).location).searchParams.get('status'),'failed');assert.equal(x.calls.some(v=>v[0]==='record'),false);});
 await check('page has no registration or profile editor and keeps the shared background',()=>{const page=read('src/app/rules/accept/page.tsx');assert.ok(page.includes('<LoginBackground />'));assert.ok(page.includes('<StaticMarkdown'));assert.ok(!page.includes('getSession')&&!page.includes('getProfileById'));const form=read('src/components/GuildRulesAcceptForm.tsx');assert.ok(form.includes('name="agree"')&&form.includes('required')&&form.includes('disabled={!checked || pending}'));});
 await check('posted identity fields cannot replace the signed Discord recipient',async()=>{const x=rig();await x.post({discordUserId:'999999999999999999',roleIds:'999999999999999999'});const grant=x.calls.find(value=>value[0]==='grant')[1];assert.equal(grant.userId,user);assert.deepEqual(Array.from(grant.roleIds),[role]);});
 await check('canonical publication is read directly even outside the old default channel',async()=>{let refSeen;const source=load('src/lib/guildRulesDocument.ts',{
  '@/lib/discordAdmin':{parseDiscordMessageRef:()=>({channelId:'777777777777777777',messageId:message.id}),fetchDiscordEditableMessage:async ref=>{refSeen=ref;return message;},listRulesEmbedMessages:()=>{throw Error('Unexpected history fallback');}},
  '@/lib/rulesAcceptanceSettings':{getPublicRulesMessageUrl:async()=> 'https://discord.com/channels/'+guild+'/777777777777777777/'+message.id},
  '@/lib/discordGuildLinks':{MISTBLOSSOM_DISCORD_CHANNELS:{rules:{id:'555555555555555555'}}},
 }).exports;assert.equal((await source.getGuildRulesDocument([role])).title,'Правила');assert.equal(refSeen.channelId,'777777777777777777');});
 await check('saving the current publication preserves the test setting and invalidates role cache',async()=>{let data={allowRepeatedAcceptForTesting:true},saved;const source=load('src/lib/rulesAcceptanceSettings.ts',{
  '@/lib/db/firestoreCompat':{FieldValue:{serverTimestamp:()=> 'fixture-time'}},
  '@/lib/firebaseAdmin':{hasFirebaseProfileConfig:()=>true,getFirebaseAdminDb:()=>({collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>data}),set:async value=>{saved=value;data={...data,...value};}})})})},
  '@/lib/firebaseAccess':{firebaseWrite:async(scope,key,run)=>run()},
  '@/lib/runtimeResilience':{resilientRead:async(key,run)=>run(),withTimeout:async value=>value},'@/lib/values':{timestampToIso:()=>null},
 });source.context.__mistblossomConfiguredRulesRoleIdsCache={roleIds:[role],cachedAt:Date.now()};const url='https://discord.com/channels/'+guild+'/777777777777777777/'+message.id;await source.exports.setPublicRulesMessage(url,{id:'fixture-admin'});assert.equal(saved.publicRulesMessageUrl,url);assert.equal((await source.exports.getRulesAcceptanceSettings()).allowRepeatedAcceptForTesting,true);assert.equal(source.context.__mistblossomConfiguredRulesRoleIdsCache,undefined);});
 await check('publication storage outage cannot use a stale cached binding',async()=>{const source=load('src/lib/rulesAcceptanceSettings.ts',{
  '@/lib/db/firestoreCompat':{},
  '@/lib/firebaseAdmin':{hasFirebaseProfileConfig:()=>true,getFirebaseAdminDb:()=>({collection:()=>({doc:()=>({get:async()=>{throw Error('Publication storage offline');}})})})},
  '@/lib/firebaseAccess':{},'@/lib/runtimeResilience':{withTimeout:async value=>value},'@/lib/values':{},
 });source.context.__mistblossomRulesAcceptanceSettingsCache={settings:{publicRulesMessageUrl:'https://discord.com/channels/'+guild+'/777777777777777777/'+message.id},cachedAt:Date.now()};await assert.rejects(()=>source.exports.getPublicRulesMessageUrl(),/Publication storage offline/);});
 await check('public rules publisher updates the canonical document reference',()=>{const source=read('src/app/api/discord/embeds/publish/route.ts');assert.ok(source.includes('await setPublicRulesMessage'));assert.ok(source.includes('canManageRulesEmbeds(session)'));});
 console.log(`[check-rules-accept] OK — ${passed} separate acceptance / signature / editor checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
