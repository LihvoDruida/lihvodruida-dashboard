export const STREAMER_SCHEMA='mistblossom.public-streamers.v1';
export type StreamPlatform='twitch'|'youtube'|'tiktok';
export type StreamMedia={id:string;title:string;url:string;publishedAt:string;thumbnailUrl?:string;game?:string;viewers?:number};
export type PublicStream={id:string;memberName:string;platform:StreamPlatform;channelUrl:string;live:StreamMedia;expiresAt:string};
export type PublicStreamers={schema:typeof STREAMER_SCHEMA;checked_at:string;items:PublicStream[]};
export const STREAMER_LIMIT=30;
export function canManageStreamers(user:{role?:string;isServerOwner?:boolean}|null|undefined){return !!user&&(user.isServerOwner===true||user.role==='admin');}
export function channelIdentity(platform:StreamPlatform,input:string){
 let value=String(input||'').normalize('NFC').trim();
 if(value.length>200)throw Error('Посилання на канал завелике.');
 if(/^https?:/i.test(value)){
  const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)throw Error('Вкажи звичайне HTTPS-посилання на канал без параметрів.');
  const host=url.hostname.toLowerCase().replace(/^www\./,'');const parts=url.pathname.split('/').filter(Boolean);
  if(platform==='twitch'&&host==='twitch.tv'&&parts.length===1)value=parts[0];
  else if(platform==='youtube'&&host==='youtube.com'&&parts.length===2&&parts[0]==='channel')value=parts[1];
  else if(platform==='youtube'&&host==='youtube.com'&&parts.length===1&&parts[0].startsWith('@'))value=parts[0];
  else if(platform==='tiktok'&&host==='tiktok.com'&&parts.length===1&&parts[0].startsWith('@'))value=parts[0];
  else throw Error('Це не посилання на канал вибраної платформи.');
 }
 if(platform==='twitch'&&/^[a-zA-Z0-9_]{2,25}$/.test(value))return {handle:value.toLowerCase(),channelUrl:`https://www.twitch.tv/${value.toLowerCase()}`};
 if(platform==='youtube'&&/^(?:UC[a-zA-Z0-9_-]{22}|@[\p{L}\p{N}_.-]{3,30})$/u.test(value))return {handle:value,channelUrl:`https://www.youtube.com/${value.startsWith('@')?value:'channel/'+value}`};
 if(platform==='tiktok'&&/^@?[a-zA-Z0-9_.]{2,24}$/.test(value)){value=value.replace(/^@/,'').toLowerCase();return {handle:value,channelUrl:`https://www.tiktok.com/@${value}`};}
 throw Error('Перевір нік або посилання. YouTube: @handle або UC… ID каналу.');
}
export function validMedia(platform:StreamPlatform,media:StreamMedia){
 if(!media||typeof media.id!=='string'||typeof media.title!=='string'||!media.title||media.title.length>300||!Number.isFinite(Date.parse(media.publishedAt)))return false;
 if(platform==='twitch')return /^\d{1,30}$/.test(media.id)&&/^https:\/\/(?:www\.)?twitch\.tv\/(?:[a-z0-9_]{2,25}|videos\/\d{1,30})$/.test(media.url);
 if(platform==='youtube')return /^[a-zA-Z0-9_-]{11}$/.test(media.id)&&media.url===`https://www.youtube.com/watch?v=${media.id}`;
 return /^\d{10,30}$/.test(media.id)&&/^https:\/\/www\.tiktok\.com\/@[a-z0-9_.]{2,24}\/video\/\d{10,30}$/.test(media.url);
}
export function isPublicStreamers(x:unknown):x is PublicStreamers{
 if(!x||typeof x!=='object')return false;const d=x as PublicStreamers;
 return d.schema===STREAMER_SCHEMA&&Number.isFinite(Date.parse(d.checked_at))&&Array.isArray(d.items)&&d.items.length<=STREAMER_LIMIT&&d.items.every(i=>{
  try{return typeof i.id==='string'&&i.id.length<100&&typeof i.memberName==='string'&&i.memberName.length<=80&&['twitch','youtube'].includes(i.platform)&&channelIdentity(i.platform,i.channelUrl).channelUrl===i.channelUrl&&validMedia(i.platform,i.live)&&Number.isFinite(Date.parse(i.expiresAt));}catch{return false;}
 });
}

/** Only provider CDN images; never fetch an arbitrary supplied URL on our server. */
export function safeMediaImage(platform:StreamPlatform,value:unknown):string|undefined{
 if(typeof value!=='string'||value.length>2048)return;try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port)return;
 const h=u.hostname.toLowerCase();const suffix=(s:string)=>h===s||h.endsWith('.'+s);
 if(platform==='twitch'?suffix('jtvnw.net'):platform==='youtube'?suffix('ytimg.com'):['tiktokcdn.com','tiktokcdn-us.com','tiktokcdn-eu.com','byteoversea.com','ibytedtos.com','tiktokv.com'].some(suffix))return u.href;
 }catch{}return;
}
