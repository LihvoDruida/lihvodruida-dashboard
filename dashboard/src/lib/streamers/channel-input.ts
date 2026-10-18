import {channelIdentity,type StreamPlatform} from './contract';
import {StreamerInputError} from './problems';
const tabs=new Set(['videos','streams','shorts','featured','playlists','community','about','courses','podcasts']);
const youtubeHandle=/^@[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}_.·-]{0,28}[\p{L}\p{N}\p{M}])?$/u;
const legacyName=/^[\p{L}\p{N}][\p{L}\p{N}\p{M}_.-]{0,99}$/u;
export function streamerChannelInput(platform:StreamPlatform,input:string):{handle:string;channelUrl:string}{
 let value=String(input||'').normalize('NFC').trim();if(!value||value.length>2048)throw new StreamerInputError('channel_invalid',platform);
 if(/^(?:(?:www|m)\.)?(?:youtube\.com|twitch\.tv|tiktok\.com)\//i.test(value))value='https://'+value;
 if(/^https?:/i.test(value)){
  let url:URL;try{url=new URL(value);}catch{throw new StreamerInputError('channel_invalid',platform);}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new StreamerInputError('channel_invalid',platform);
  const host=url.hostname.toLowerCase().replace(/^www\./,'');let parts:string[];
  try{parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);}catch{throw new StreamerInputError('channel_invalid',platform);}
  if(parts.some(p=>/[\\/?#\u0000-\u001f]/.test(p)))throw new StreamerInputError('channel_invalid',platform);
  if(platform==='youtube'){
   if(host==='youtu.be'||['youtube.com','m.youtube.com'].includes(host)&&['watch','shorts','live','playlist'].includes(parts[0]))throw new StreamerInputError('channel_video_url',platform);
   if(!['youtube.com','m.youtube.com'].includes(host))throw new StreamerInputError('channel_invalid',platform);
   if(parts.length>1&&tabs.has(parts.at(-1)!))parts.pop();
   if(parts.length===1&&parts[0].startsWith('@'))value=parts[0];
   else if(parts.length===2&&parts[0]==='channel')value=parts[1];
   else if(parts.length===2&&['user','c'].includes(parts[0]))value=(parts[0]==='user'?'user:':'custom:')+parts[1];
   else throw new StreamerInputError('channel_invalid',platform);
  }else if(platform==='twitch'&&['twitch.tv','m.twitch.tv'].includes(host)&&parts.length>=1&&parts.length<=2&&(parts.length===1||['videos','about','schedule'].includes(parts[1]))){value=parts[0];}
  else if(platform==='tiktok'&&host==='tiktok.com'&&(parts.length===1||parts.length===2&&parts[1]==='live'))value=parts[0];
  else throw new StreamerInputError('channel_invalid',platform);
 }
 if(platform==='youtube'){
  if(/^UC[a-zA-Z0-9_-]{22}$/.test(value))return {handle:value,channelUrl:'https://www.youtube.com/channel/'+value};
  const old=/^(user|custom):(.+)$/.exec(value);if(old&&legacyName.test(old[2]))return {handle:value,channelUrl:'https://www.youtube.com/'+(old[1]==='user'?'user/':'c/')+encodeURIComponent(old[2])};
  if(!value.startsWith('@'))value='@'+value;
  if(youtubeHandle.test(value))return {handle:value,channelUrl:'https://www.youtube.com/'+encodeURI(value)};
  throw new StreamerInputError('channel_invalid',platform);
 }
 try{return channelIdentity(platform,value);}catch{throw new StreamerInputError('channel_invalid',platform);}
}
